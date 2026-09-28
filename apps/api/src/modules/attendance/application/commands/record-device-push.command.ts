import { err, ok } from '@rrhh/domain';

import type { Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DevicePushRecord } from '../../domain/device-record';
import { DeviceNotAllowedError } from '../../domain/errors';

export interface RecordDevicePushInput {
  serialNumber: string;
  table: string;
  /** Registros ya interpretados; los `entry` llegan con sus campos redactados. */
  records: readonly DevicePushRecord[];
}

interface Deps {
  logger: Logger;
  allowedDeviceSerials: readonly string[];
}

/**
 * Sonda: registra en el log los datos que empuja un equipo (marcaciones, operaciones, usuarios,
 * biometría). Un resumen a nivel info y cada registro a nivel debug. No persiste nada.
 */
export class RecordDevicePush implements Command<
  RecordDevicePushInput,
  { accepted: number },
  DeviceNotAllowedError
> {
  constructor(private readonly deps: Deps) {}

  execute(input: RecordDevicePushInput) {
    const { logger, allowedDeviceSerials } = this.deps;
    const { serialNumber, table, records } = input;

    if (!allowedDeviceSerials.includes(serialNumber)) {
      logger.warn({ serialNumber, table }, 'zkteco: dispositivo no autorizado');
      return Promise.resolve(err(new DeviceNotAllowedError(serialNumber)));
    }

    logger.info(
      { serialNumber, table, total: records.length, byKind: countByKind(records) },
      'zkteco: datos recibidos',
    );
    for (const record of records) {
      logger.debug({ serialNumber, table, record }, 'zkteco: registro');
    }

    return Promise.resolve(ok({ accepted: records.length }));
  }
}

/** Los `entry` se cuentan por prefijo (`USER`, `BIODATA`…), que es lo que distingue su tipo. */
function countByKind(records: readonly DevicePushRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const key = record.kind === 'entry' ? record.prefix : record.kind;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
