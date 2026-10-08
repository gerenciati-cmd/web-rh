import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '@/modules/attendance/domain/device';
import { DeviceCommand, type DeviceCommandId } from '@/modules/attendance/domain/device-command';
import { PrismaDeviceCommandRepository } from '@/modules/attendance/infrastructure/prisma-device-command.repository';
import { PrismaDeviceUserRepository } from '@/modules/attendance/infrastructure/prisma-device-user.repository';
import { PrismaDeviceRepository } from '@/modules/attendance/infrastructure/prisma-device.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

/**
 * Plan attendance-marcaciones/007: registro `device_users`, `listActiveBySite`, `lastQueuedForPin` y
 * `queued_by` nulo (migración `create_device_users`).
 */
const database = useTestDatabase([
  'attendance.device_users',
  'attendance.device_commands',
  'attendance.devices',
]);
const devices = new PrismaDeviceRepository({ database });
const commands = new PrismaDeviceCommandRepository({ database });
const users = new PrismaDeviceUserRepository({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-10-08T12:00:00Z');
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000a2';
const EMPLOYEE_1 = '00000000-0000-4000-8000-0000000000e1';
const EMPLOYEE_2 = '00000000-0000-4000-8000-0000000000e2';
const PIN = 'GOMA850101AB1';
const UPDATE_TEXT = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';

async function savedDevice(
  serialNumber: string,
  options: { siteId?: string; name?: string; active?: boolean } = {},
): Promise<Device> {
  const created = Device.register({
    id: ids.next() as DeviceId,
    serialNumber,
    name: options.name ?? `Equipo ${serialNumber}`,
    siteId: options.siteId ?? SITE_A,
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await devices.add(created.value);
  if (!saved.ok) throw saved.error;
  if (options.active === false) {
    // No hay caso de uso que desactive un equipo: se rehidrata inactivo con las mismas columnas.
    await database.client.$executeRaw`
      UPDATE attendance.devices SET active = false WHERE id = ${created.value.id}::uuid`;
  }
  return created.value;
}

async function queue(
  device: Device,
  text: string,
  queuedBy: string | null,
  at: Date = NOW,
): Promise<DeviceCommand> {
  const created = DeviceCommand.queue({
    id: ids.next() as DeviceCommandId,
    deviceId: device.id,
    number: await commands.nextNumber(),
    command: text,
    queuedBy,
    now: at,
  });
  if (!created.ok) throw created.error;
  await commands.save(created.value);
  return created.value;
}

describe('migración create_device_users', () => {
  it('crea attendance.device_users con clave (device_id, pin) y pin VARCHAR(32)', async () => {
    const columns = await database.client.$queryRaw<
      { column_name: string; data_type: string; is_nullable: string; len: number | null }[]
    >`SELECT column_name, data_type, is_nullable, character_maximum_length AS len
      FROM information_schema.columns
      WHERE table_schema = 'attendance' AND table_name = 'device_users'
      ORDER BY column_name`;

    expect(columns).toEqual([
      { column_name: 'device_id', data_type: 'uuid', is_nullable: 'NO', len: null },
      { column_name: 'employee_id', data_type: 'uuid', is_nullable: 'NO', len: null },
      { column_name: 'pin', data_type: 'character varying', is_nullable: 'NO', len: 32 },
      {
        column_name: 'synced_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'NO',
        len: null,
      },
    ]);
  });

  it('queued_by de device_commands admite NULL', async () => {
    const [column] = await database.client.$queryRaw<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'attendance' AND table_name = 'device_commands'
        AND column_name = 'queued_by'`;

    expect(column?.is_nullable).toBe('YES');
  });

  it('device_users no tiene FK hacia employees (ADR 0010): solo hacia devices', async () => {
    const foreignKeys = await database.client.$queryRaw<{ foreign_table: string }[]>`
      SELECT ccu.table_name AS foreign_table
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'attendance' AND tc.table_name = 'device_users'
        AND tc.constraint_type = 'FOREIGN KEY'`;

    expect(foreignKeys).toEqual([{ foreign_table: 'devices' }]);
  });
});

describe('PrismaDeviceUserRepository', () => {
  it('put inserta y rehidrata el registro con todos sus campos', async () => {
    const device = await savedDevice('TESTSN001');

    await users.put({
      deviceId: device.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });

    expect(await users.listByDevice(device.id)).toEqual([
      { deviceId: device.id, pin: 'GOMA850101AB1', employeeId: EMPLOYEE_1, syncedAt: NOW },
    ]);
  });

  it('put sobre la misma (deviceId, pin) reemplaza en lugar de duplicar', async () => {
    const device = await savedDevice('TESTSN001');
    const later = new Date('2026-10-09T12:00:00Z');
    await users.put({
      deviceId: device.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });

    await users.put({
      deviceId: device.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_2,
      syncedAt: later,
    });

    expect(await users.listByDevice(device.id)).toEqual([
      { deviceId: device.id, pin: 'GOMA850101AB1', employeeId: EMPLOYEE_2, syncedAt: later },
    ]);
  });

  it('el mismo PIN en dos equipos son dos filas independientes', async () => {
    const one = await savedDevice('TESTSN001');
    const two = await savedDevice('TESTSN002');
    await users.put({
      deviceId: one.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: two.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });

    expect(await users.listByDevice(one.id)).toHaveLength(1);
    expect(await users.listByDevice(two.id)).toHaveLength(1);
  });

  it('listByDevice ordena por PIN y solo trae el equipo pedido', async () => {
    const one = await savedDevice('TESTSN001');
    const two = await savedDevice('TESTSN002');
    await users.put({
      deviceId: one.id,
      pin: 'PEXL900215AB2',
      employeeId: EMPLOYEE_2,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: one.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: two.id,
      pin: 'ROSA010305AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });

    expect((await users.listByDevice(one.id)).map((row) => row.pin)).toEqual([
      'GOMA850101AB1',
      'PEXL900215AB2',
    ]);
  });

  it('listByEmployee trae las filas de ese colaborador en todos los equipos y ninguna de otro', async () => {
    const one = await savedDevice('TESTSN001');
    const two = await savedDevice('TESTSN002');
    await users.put({
      deviceId: one.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: two.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: one.id,
      pin: 'PEXL900215AB2',
      employeeId: EMPLOYEE_2,
      syncedAt: NOW,
    });

    const rows = await users.listByEmployee(EMPLOYEE_1);

    expect(rows.map((row) => row.deviceId).sort()).toEqual([one.id, two.id].sort());
    expect(rows.every((row) => row.employeeId === EMPLOYEE_1)).toBe(true);
    expect(await users.listByEmployee('00000000-0000-4000-8000-0000000000ff')).toEqual([]);
  });

  it('remove borra solo esa (deviceId, pin) y no falla si ya no existe', async () => {
    const one = await savedDevice('TESTSN001');
    const two = await savedDevice('TESTSN002');
    await users.put({
      deviceId: one.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });
    await users.put({
      deviceId: two.id,
      pin: 'GOMA850101AB1',
      employeeId: EMPLOYEE_1,
      syncedAt: NOW,
    });

    await users.remove(one.id, 'GOMA850101AB1');
    await users.remove(one.id, 'GOMA850101AB1');

    expect(await users.listByDevice(one.id)).toEqual([]);
    expect(await users.listByDevice(two.id)).toHaveLength(1);
  });

  it('la FK rechaza una fila de un equipo que no existe', async () => {
    await expect(
      users.put({
        deviceId: '00000000-0000-4000-8000-0000000000ff' as DeviceId,
        pin: 'GOMA850101AB1',
        employeeId: EMPLOYEE_1,
        syncedAt: NOW,
      }),
    ).rejects.toThrow();
  });
});

describe('PrismaDeviceRepository.listActiveBySite', () => {
  it('trae solo los equipos activos de la sede, ordenados por nombre', async () => {
    await savedDevice('SN3', { name: 'Zeta' });
    await savedDevice('SN1', { name: 'Alfa' });
    await savedDevice('SN2', { name: 'Medio', siteId: SITE_B });
    await savedDevice('SN4', { name: 'Baja', active: false });

    const listed = await devices.listActiveBySite(SITE_A);

    expect(listed.map((device) => device.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('una sede sin equipos devuelve lista vacía', async () => {
    expect(await devices.listActiveBySite(SITE_B)).toEqual([]);
  });
});

describe('PrismaDeviceCommandRepository: lastQueuedForPin y queued_by nulo', () => {
  it('queuedBy null se guarda y se rehidrata como null', async () => {
    const device = await savedDevice('TESTSN001');
    await queue(device, UPDATE_TEXT, null);

    const next = await commands.nextQueued(device.id);

    expect(next?.queuedBy).toBeNull();
  });

  it('lastQueuedForPin es verdadero para un comando idéntico en cola de ese equipo', async () => {
    const device = await savedDevice('TESTSN001');
    await queue(device, UPDATE_TEXT, null);

    expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(UPDATE_TEXT);
  });

  it('lastQueuedForPin es falso para otro texto, otro equipo o un comando que ya salió de la cola', async () => {
    const one = await savedDevice('TESTSN001');
    const two = await savedDevice('TESTSN002');
    const sent = await queue(one, UPDATE_TEXT, null);

    expect(await commands.lastQueuedForPin(one.id, 'OTRO000000XX0')).toBeNull();
    expect(await commands.lastQueuedForPin(two.id, PIN)).toBeNull();

    sent.markSent(NOW);
    expect(await commands.claim(sent)).toBe(true);
    expect(await commands.lastQueuedForPin(one.id, PIN)).toBeNull();
  });

  describe('lastQueuedForPin: el último comando en cola del PIN decide', () => {
    const DELETE_TEXT = `DATA DELETE USERINFO PIN=${PIN}`;
    const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

    it('devuelve el más reciente por fecha de encolado, sea alta o baja', async () => {
      const device = await savedDevice('TESTSN001');
      await queue(device, UPDATE_TEXT, null, later(0));
      await queue(device, DELETE_TEXT, null, later(5));
      expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(DELETE_TEXT);

      await queue(device, UPDATE_TEXT, null, later(10));
      expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(UPDATE_TEXT);
    });

    it('con la misma fecha de encolado desempata el id mayor', async () => {
      const device = await savedDevice('TESTSN001');
      await queue(device, UPDATE_TEXT, null);
      await queue(device, DELETE_TEXT, null);

      expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(DELETE_TEXT);
    });

    it('ignora otro PIN (también uno que contiene al PIN como prefijo) y comandos que no son alta ni baja', async () => {
      const device = await savedDevice('TESTSN001');
      await queue(device, UPDATE_TEXT, null, later(0));
      await queue(device, `DATA UPDATE USERINFO PIN=${PIN}X\tName=Otra Persona`, null, later(5));
      await queue(device, 'DATA DELETE USERINFO PIN=PEXL900215AB2', null, later(5));
      await queue(device, `DATA QUERY USERINFO PIN=${PIN}`, null, later(5));

      expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(UPDATE_TEXT);
    });

    it('un comando que ya salió de la cola no cuenta: vuelve a mandar el anterior', async () => {
      const device = await savedDevice('TESTSN001');
      await queue(device, UPDATE_TEXT, null, later(0));
      const sent = await queue(device, DELETE_TEXT, null, later(5));
      sent.markSent(later(6));
      expect(await commands.claim(sent)).toBe(true);

      expect(await commands.lastQueuedForPin(device.id, PIN)).toBe(UPDATE_TEXT);
    });
  });
});
