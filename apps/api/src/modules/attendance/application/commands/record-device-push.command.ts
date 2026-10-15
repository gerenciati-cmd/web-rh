import { err, ok } from '@rrhh/domain';

import type { JobQueue } from '@/shared/application/jobs';
import type { Clock, IdGenerator, Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { Device } from '../../domain/device';
import type { DevicePushRecord } from '../../domain/device-record';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotAllowedError } from '../../domain/errors';
import { addDays } from '../../domain/local-date';
import { Punch, type PunchId } from '../../domain/punch';
import type { PunchRepository } from '../../domain/punch.repository';
import { utcDate } from '../../domain/workday-recalculation';
import { enqueueWorkdayRecalculation } from '../jobs/recalculate-workdays.job';

export interface RecordDevicePushInput {
  serialNumber: string;
  table: string;
  /**
   * Registros ya interpretados; los `entry` llegan con sus campos redactados. Se lee solo después
   * de autorizar, así el llamador puede pasarlo como getter y no parsear bodies ajenos.
   */
  readonly records: readonly DevicePushRecord[];
  /** IP de origen del request (ya resuelta según `TRUST_PROXY`); null si no se conoce. */
  sourceIp: string | null;
}

interface Deps {
  logger: Logger;
  deviceRepository: DeviceRepository;
  punchRepository: PunchRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  jobQueue: JobQueue;
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
    const { serialNumber, table, sourceIp } = input;

    const device = await deviceRepository.findBySerialNumber(serialNumber);
    if (!device?.active) {
      logger.warn({ serialNumber, table, sourceIp }, 'zkteco: dispositivo no autorizado');
      return err(new DeviceNotAllowedError(serialNumber));
    }
    // Misma respuesta que un serial desconocido: desde afuera no se distingue el motivo.
    if (!device.acceptsAddress(sourceIp)) {
      logger.warn({ serialNumber, table, sourceIp }, 'zkteco: IP no permitida');
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

      // Una línea ya guardada es un reenvío del historial (handshake con Stamp=None), no tiempo real.
      offsetRecorded = inserted === 1 && this.measureClockOffset(device, valid, receivedAt);
      await this.enqueueRecalculations(serialNumber, valid, inserted, receivedAt);
    }

    const seen = device.markSeen(clock.now(), sourceIp);
    // Solo columnas del equipo: un cambio de sede hecho durante este envío no se pisa.
    if (seen || offsetRecorded) await deviceRepository.saveContact(device);

    // `accepted` cuenta todo lo procesado, también lo rechazado: el equipo no debe reenviar esas líneas.
    return ok({ accepted: records.length });
  }

  /**
   * Un recálculo por PIN, de la fecha UTC de su primera marcación − 1 (la salida de un turno
   * nocturno pertenece al día anterior; México va detrás de UTC) a la de la última (decisión 20).
   * Un lote sin líneas nuevas no encola nada; el repositorio no dice cuáles eran nuevas, así que
   * con al menos una se usa todo el lote. Si encolar falla solo se registra: el equipo no debe
   * reenviar marcaciones que ya se guardaron.
   */
  private async enqueueRecalculations(
    serialNumber: string,
    punches: readonly Punch[],
    inserted: number,
    receivedAt: Date,
  ): Promise<void> {
    if (inserted === 0) return;
    const spans = new Map<string, { min: Date; max: Date }>();
    for (const punch of punches) {
      const span = spans.get(punch.pin);
      if (!span) {
        spans.set(punch.pin, { min: punch.occurredAt, max: punch.occurredAt });
        continue;
      }
      if (punch.occurredAt < span.min) span.min = punch.occurredAt;
      if (punch.occurredAt > span.max) span.max = punch.occurredAt;
    }

    const today = utcDate(receivedAt);
    for (const [pin, { min, max }] of spans) {
      try {
        await enqueueWorkdayRecalculation(
          this.deps.jobQueue,
          { pin },
          addDays(utcDate(min), -1),
          utcDate(max),
          today,
        );
      } catch (error) {
        this.deps.logger.error(
          { err: error, serialNumber, pin },
          'asistencia: no se pudo encolar el recálculo',
        );
      }
    }
  }

  /** Solo un envío en tiempo real (una línea válida y nueva) es comparable con la hora de recepción. */
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
