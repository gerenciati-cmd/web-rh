import { err, ok } from '@rrhh/domain';

import type { Clock, Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import { parseCommandResult, redactDeviceFields } from '../../domain/device-record';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotAllowedError } from '../../domain/errors';

export type DeviceContactKind = 'handshake' | 'poll' | 'command-result' | 'unknown';

export interface RecordDeviceContactInput {
  serialNumber: string;
  kind: DeviceContactKind;
  method: string;
  path: string;
  query: Readonly<Record<string, string>>;
  bodyLength: number;
  body: string;
  /** IP de origen del request (ya resuelta según `TRUST_PROXY`); null si no se conoce. */
  sourceIp: string | null;
}

interface Deps {
  logger: Logger;
  deviceRepository: DeviceRepository;
  clock: Clock;
}

/**
 * Registra el contacto de un equipo que no trae datos (handshake, consulta de comandos, resultado
 * de comando o ruta desconocida): lo deja en el log y anota su último contacto (`lastSeenAt`).
 * Solo atiende equipos registrados y activos.
 */
export class RecordDeviceContact implements Command<
  RecordDeviceContactInput,
  { deviceId: DeviceId },
  DeviceNotAllowedError
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RecordDeviceContactInput) {
    const { logger, deviceRepository, clock } = this.deps;
    // El cuerpo nunca va al log tal cual: solo su largo y, en resultados de comando, campos
    // redactados.
    const { serialNumber, body, sourceIp, ...contact } = input;

    const device = await deviceRepository.findBySerialNumber(serialNumber);
    if (!device?.active) {
      logger.warn({ serialNumber, sourceIp, ...contact }, 'zkteco: dispositivo no autorizado');
      return err(new DeviceNotAllowedError(serialNumber));
    }
    // Misma respuesta que un serial desconocido: desde afuera no se distingue el motivo.
    if (!device.acceptsAddress(sourceIp)) {
      logger.warn({ serialNumber, sourceIp, ...contact }, 'zkteco: IP no permitida');
      return err(new DeviceNotAllowedError(serialNumber));
    }

    // `lastSeenAt` es estado informativo: markSeen limita la escritura a una por minuto.
    if (device.markSeen(clock.now(), sourceIp)) await deviceRepository.saveContact(device);

    const logged = { serialNumber, sourceIp, ...contact };
    // El equipo consulta comandos cada pocos segundos: a nivel info inundaría el log.
    if (contact.kind === 'poll') logger.debug(logged, 'zkteco: contacto del dispositivo');
    else logger.info(logged, 'zkteco: contacto del dispositivo');

    if (contact.kind === 'command-result') {
      logger.info(
        { serialNumber, fields: redactDeviceFields(parseCommandResult(body)) },
        'zkteco: resultado de comando',
      );
    }

    return ok({ deviceId: device.id });
  }
}
