import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '@/modules/attendance/domain/device';
import { DeviceCommand, type DeviceCommandId } from '@/modules/attendance/domain/device-command';
import { PrismaAttendanceQueries } from '@/modules/attendance/infrastructure/prisma-attendance.queries';
import { PrismaDeviceCommandRepository } from '@/modules/attendance/infrastructure/prisma-device-command.repository';
import { PrismaDeviceRepository } from '@/modules/attendance/infrastructure/prisma-device.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

// El TRUNCATE ... CASCADE de support.ts vaciaría device_commands al vaciar devices; se listan ambas.
const database = useTestDatabase(['attendance.device_commands', 'attendance.devices']);
const devices = new PrismaDeviceRepository({ database });
const commands = new PrismaDeviceCommandRepository({ database });
const queries = new PrismaAttendanceQueries({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-10-02T12:00:00Z');
const USER = '00000000-0000-4000-8000-0000000000a1';

async function savedDevice(serialNumber: string): Promise<Device> {
  const created = Device.register({
    id: ids.next() as DeviceId,
    serialNumber,
    name: `Equipo ${serialNumber}`,
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await devices.add(created.value);
  if (!saved.ok) throw saved.error;
  return created.value;
}

async function savedCommand(
  device: Device,
  text: string,
  queuedAt: Date,
  id = ids.next() as DeviceCommandId,
): Promise<DeviceCommand> {
  const created = DeviceCommand.queue({
    id,
    deviceId: device.id,
    command: text,
    queuedBy: USER,
    now: queuedAt,
  });
  if (!created.ok) throw created.error;
  await commands.save(created.value);
  return created.value;
}

describe('PrismaDeviceCommandRepository', () => {
  it('guarda y rehidrata el comando con todos sus campos, incluida la tabulación', async () => {
    const device = await savedDevice('TESTSN001');
    const text = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';
    const saved = await savedCommand(device, text, NOW);

    const next = await commands.nextQueued(device.id);

    expect(next?.id).toBe(saved.id);
    expect(next?.deviceId).toBe(device.id);
    expect(next?.command).toBe(text);
    expect(next?.status).toBe('QUEUED');
    expect(next?.queuedAt).toEqual(NOW);
    expect(next?.sentAt).toBeNull();
    expect(next?.queuedBy).toBe(USER);
  });

  it('nextQueued devuelve el más antiguo y null sin comandos en cola', async () => {
    const device = await savedDevice('TESTSN001');
    expect(await commands.nextQueued(device.id)).toBeNull();
    await savedCommand(device, 'DATA QUERY USERINFO PIN=2', new Date('2026-10-02T12:05:00Z'));
    const older = await savedCommand(
      device,
      'DATA QUERY USERINFO PIN=1',
      new Date('2026-10-02T12:00:00Z'),
    );

    const next = await commands.nextQueued(device.id);

    expect(next?.id).toBe(older.id);
  });

  it('con el mismo queuedAt desempata por id', async () => {
    const device = await savedDevice('TESTSN001');
    const second = await savedCommand(
      device,
      'DATA QUERY USERINFO PIN=2',
      NOW,
      '00000000-0000-4000-8000-0000000002b2' as DeviceCommandId,
    );
    const first = await savedCommand(
      device,
      'DATA QUERY USERINFO PIN=1',
      NOW,
      '00000000-0000-4000-8000-0000000002a1' as DeviceCommandId,
    );

    const next = await commands.nextQueued(device.id);

    expect(next?.id).toBe(first.id);
    expect(next?.id).not.toBe(second.id);
  });

  it('un comando guardado como SENT (upsert) ya no sale en nextQueued y conserva sentAt', async () => {
    const device = await savedDevice('TESTSN001');
    const command = await savedCommand(device, 'DATA QUERY USERINFO PIN=1', NOW);
    const sentAt = new Date('2026-10-02T12:00:10Z');
    command.markSent(sentAt);

    await commands.save(command);

    expect(await commands.nextQueued(device.id)).toBeNull();
    const page = await queries.listDeviceCommands(device.id, { page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: command.id,
      status: 'SENT',
      sentAt: sentAt.toISOString(),
    });
  });

  it('nextQueued solo mira los comandos del equipo pedido', async () => {
    const a = await savedDevice('TESTSN001');
    const b = await savedDevice('TESTSN002');
    const forB = await savedCommand(b, 'DATA QUERY USERINFO PIN=1', NOW);

    expect(await commands.nextQueued(a.id)).toBeNull();
    expect((await commands.nextQueued(b.id))?.id).toBe(forB.id);
  });
});

describe('PrismaAttendanceQueries.listDeviceCommands', () => {
  it('lista el más nuevo primero, pagina y filtra por equipo', async () => {
    const a = await savedDevice('TESTSN001');
    const b = await savedDevice('TESTSN002');
    await savedCommand(a, 'DATA QUERY USERINFO PIN=1', new Date('2026-10-02T12:00:00Z'));
    await savedCommand(a, 'DATA QUERY USERINFO PIN=2', new Date('2026-10-02T12:01:00Z'));
    await savedCommand(a, 'DATA QUERY USERINFO PIN=3', new Date('2026-10-02T12:02:00Z'));
    await savedCommand(b, 'DATA QUERY USERINFO PIN=9', new Date('2026-10-02T12:03:00Z'));

    const first = await queries.listDeviceCommands(a.id, { page: 1, pageSize: 2 });
    const second = await queries.listDeviceCommands(a.id, { page: 2, pageSize: 2 });

    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.command)).toEqual([
      'DATA QUERY USERINFO PIN=3',
      'DATA QUERY USERINFO PIN=2',
    ]);
    expect(second.items.map((item) => item.command)).toEqual(['DATA QUERY USERINFO PIN=1']);
    expect(first.items[0]).toEqual({
      id: expect.any(String),
      command: 'DATA QUERY USERINFO PIN=3',
      status: 'QUEUED',
      queuedAt: '2026-10-02T12:02:00.000Z',
      sentAt: null,
      queuedBy: USER,
    });
  });
});
