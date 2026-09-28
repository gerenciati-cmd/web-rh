import { asClass, asFunction } from 'awilix';

import type { Env } from '@/config/env';
import type { AppModule } from '@/shared/app-module';

import { RecordDeviceContact } from './application/commands/record-device-contact.command';
import { RecordDevicePush } from './application/commands/record-device-push.command';
import { createZktecoAdmsRouter } from './http/zkteco-adms.router';

export interface AttendanceCradle {
  allowedDeviceSerials: readonly string[];
  recordDeviceContact: RecordDeviceContact;
  recordDevicePush: RecordDevicePush;
}

export const attendanceModule: AppModule<AttendanceCradle> = {
  name: 'attendance',
  registrations: {
    // Registro propio (no `env` directo) para que los tests lo reemplacen con `asValue`.
    allowedDeviceSerials: asFunction(
      ({ env }: { env: Env }) => env.ZKTECO_ALLOWED_SERIALS,
    ).singleton(),
    // Casos de uso
    recordDeviceContact: asClass(RecordDeviceContact).singleton(),
    recordDevicePush: asClass(RecordDevicePush).singleton(),
  },
  deviceRouter: createZktecoAdmsRouter,
};
