import { err, ok } from '@rrhh/domain';

import type { Clock, Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

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
  undefined,
  DeviceNotAllowedError
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RecordDeviceContactInput) {
    const { logger, deviceRepository, clock } = this.deps;
    const { serialNumber, ...contact } = input;

    const device = await deviceRepository.findBySerialNumber(serialNumber);
    if (!device?.active) {
      logger.warn({ serialNumber, ...contact }, 'zkteco: dispositivo no autorizado');
      return err(new DeviceNotAllowedError(serialNumber));
    }

    // `lastSeenAt` es estado informativo: markSeen limita la escritura a una por minuto.
    if (device.markSeen(clock.now())) await deviceRepository.save(device);

    // El equipo consulta comandos cada pocos segundos: a nivel info inundaría el log.
    if (contact.kind === 'poll') logger.debug(input, 'zkteco: contacto del dispositivo');
    else logger.info(input, 'zkteco: contacto del dispositivo');

    return ok(undefined);
  }
}
