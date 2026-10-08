import { describe, expect, it } from 'vitest';

import type { DeviceId } from '../../domain/device';

import {
  InMemoryAttendanceStore,
  InMemoryDeviceUserRepository,
} from './in-memory-attendance.store';

const DEVICE_1 = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const DEVICE_2 = '00000000-0000-4000-8000-0000000000d2' as DeviceId;
const EMPLOYEE_1 = '00000000-0000-4000-8000-0000000000e1';
const EMPLOYEE_2 = '00000000-0000-4000-8000-0000000000e2';
const NOW = new Date('2026-10-08T12:00:00Z');

const user = (deviceId: DeviceId, pin: string, employeeId: string) => ({
  deviceId,
  pin,
  employeeId,
  syncedAt: NOW,
});

// Mismo contrato que `PrismaDeviceUserRepository` (ver prisma-device-user.int.test.ts).
describe('InMemoryDeviceUserRepository', () => {
  it('put reemplaza por (deviceId, pin) y el mismo PIN en otro equipo es otra fila', async () => {
    const repository = new InMemoryDeviceUserRepository(new InMemoryAttendanceStore());
    await repository.put(user(DEVICE_1, 'GOMA850101AB1', EMPLOYEE_1));
    await repository.put(user(DEVICE_1, 'GOMA850101AB1', EMPLOYEE_2));
    await repository.put(user(DEVICE_2, 'GOMA850101AB1', EMPLOYEE_1));

    expect(await repository.listByDevice(DEVICE_1)).toEqual([
      user(DEVICE_1, 'GOMA850101AB1', EMPLOYEE_2),
    ]);
    expect(await repository.listByDevice(DEVICE_2)).toHaveLength(1);
  });

  it('listByEmployee trae las filas del colaborador en todos los equipos', async () => {
    const repository = new InMemoryDeviceUserRepository(new InMemoryAttendanceStore());
    await repository.put(user(DEVICE_1, 'GOMA850101AB1', EMPLOYEE_1));
    await repository.put(user(DEVICE_2, 'GOMA850101AB1', EMPLOYEE_1));
    await repository.put(user(DEVICE_1, 'PEXL900215AB2', EMPLOYEE_2));

    expect((await repository.listByEmployee(EMPLOYEE_1)).map((row) => row.deviceId).sort()).toEqual(
      [DEVICE_1, DEVICE_2],
    );
  });

  it('remove borra solo esa fila y no falla si ya no existe', async () => {
    const repository = new InMemoryDeviceUserRepository(new InMemoryAttendanceStore());
    await repository.put(user(DEVICE_1, 'GOMA850101AB1', EMPLOYEE_1));
    await repository.put(user(DEVICE_2, 'GOMA850101AB1', EMPLOYEE_1));

    await repository.remove(DEVICE_1, 'GOMA850101AB1');
    await repository.remove(DEVICE_1, 'GOMA850101AB1');

    expect(await repository.listByDevice(DEVICE_1)).toEqual([]);
    expect(await repository.listByDevice(DEVICE_2)).toHaveLength(1);
  });
});
