import { err, ok } from '@rrhh/domain';

import type { Clock, IdGenerator, Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { Device } from '../../domain/device';
import type { DevicePushRecord } from '../../domain/device-record';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotAllowedError } from '../../domain/errors';
import { Punch, type PunchId } from '../../domain/punch';
import type { PunchRepository } from '../../domain/punch.repository';

export interface RecordDevicePushInput {
  serialNumber: string;
  table: string;
  /**
   * Registros ya interpretados; los `entry` llegan con sus campos redactados. Se lee solo después
   * de autorizar, así el llamador puede pasarlo como getter y no parsear bodies ajenos.
   */
  readonly records: readonly DevicePushRecord[];
}

interface Deps {
  logger: Logger;
  deviceRepository: DeviceRepository;
  punchRepository: PunchRepository;
  idGenerator: IdGenerator;
  clock: Clock;
}

/**
 * Procesa los datos que empuja un equipo registrado y activo. Un resumen va al log a nivel info y
 * cada registro a nivel debug. Solo la tabla `ATTLOG` se persiste (marcaciones, sin duplicados);
 * OPLOG, USER, BIODATA y demás siguen solo en el log (decisión 6 del README de la iniciativa).
 *
 * Desfase de reloj: con `Realtime=1` el equipo envía cada marcación al ocurrir, así que un envío
 * ATTLOG de exactamente una línea válida mide `recepción − marcación`. Los reenvíos de historial
 * (varias líneas) no se miden: sus marcaciones viejas parecerían un desfase enorme. Limitación: una
 * marcación retrasada por una caída de red y enviada sola también parece desfasada.
 */
export class RecordDevicePush implements Command<
  RecordDevicePushInput,
  { accepted: number },
  DeviceNotAllowedError
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RecordDevicePushInput) {
    const { logger, deviceRepository, punchRepository, idGenerator, clock } = this.deps;
    const { serialNumber, table } = input;

    const device = await deviceRepository.findBySerialNumber(serialNumber);
    if (!device?.active) {
      logger.warn({ serialNumber, table }, 'zkteco: dispositivo no autorizado');
      return err(new DeviceNotAllowedError(serialNumber));
    }

    const { records } = input;
    logger.info(
      { serialNumber, table, total: records.length, byKind: countByKind(records) },
      'zkteco: datos recibidos',
    );
    for (const record of records) {
      logger.debug({ serialNumber, table, record }, 'zkteco: registro');
    }

    let offsetRecorded = false;
    if (table.toUpperCase() === 'ATTLOG') {
      const receivedAt = clock.now();
      const valid: Punch[] = [];
      let rejected = 0;
      let received = 0;
      for (const record of records) {
        if (record.kind !== 'attendance') continue;
        received += 1;
        const punch = Punch.fromDevice({
          id: idGenerator.next() as PunchId,
          deviceId: device.id,
          timeZone: device.timeZone,
          pin: record.pin,
          deviceTime: record.deviceTime,
          status: record.status,
          verifyMode: record.verifyMode,
          receivedAt,
        });
        if (punch.ok) {
          valid.push(punch.value);
        } else {
          rejected += 1;
          logger.warn(
            {
              serialNumber,
              pin: record.pin,
              deviceTime: record.deviceTime,
              reason: punch.error.message,
            },
            'zkteco: marcación rechazada',
          );
        }
      }

      const { inserted } = await punchRepository.saveNew(valid);
      logger.info(
        { serialNumber, received, inserted, duplicates: valid.length - inserted, rejected },
        'zkteco: marcaciones guardadas',
      );

      offsetRecorded = this.measureClockOffset(device, valid, receivedAt);
    }

    const seen = device.markSeen(clock.now());
    if (seen || offsetRecorded) await deviceRepository.save(device);

    // `accepted` cuenta todo lo procesado, también lo rechazado: el equipo no debe reenviar esas líneas.
    return ok({ accepted: records.length });
  }

  /** Solo un envío en tiempo real (una línea válida) es comparable con la hora de recepción. */
  private measureClockOffset(device: Device, valid: readonly Punch[], receivedAt: Date): boolean {
    const [only] = valid;
    if (valid.length !== 1 || !only) return false;
    const seconds = Math.round((receivedAt.getTime() - only.occurredAt.getTime()) / 1000);
    device.recordClockOffset(seconds, receivedAt);
    if (device.clockSuspect) {
      this.deps.logger.warn(
        { serialNumber: device.serialNumber, offsetSeconds: seconds },
        'zkteco: desfase de reloj',
      );
    }
    return true;
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
