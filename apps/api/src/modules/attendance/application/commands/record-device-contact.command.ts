import { err, ok } from '@rrhh/domain';

import type { Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

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
  allowedDeviceSerials: readonly string[];
}

/**
 * Sonda: registra en el log cada contacto de un equipo que no trae datos (handshake, consulta de
 * comandos, resultado de comando o ruta desconocida). No persiste nada (decisión 2 del README).
 */
export class RecordDeviceContact implements Command<
  RecordDeviceContactInput,
  undefined,
  DeviceNotAllowedError
> {
  constructor(private readonly deps: Deps) {}

  execute(input: RecordDeviceContactInput) {
    const { logger, allowedDeviceSerials } = this.deps;
    const { serialNumber, ...contact } = input;

    if (!allowedDeviceSerials.includes(serialNumber)) {
      logger.warn({ serialNumber, ...contact }, 'zkteco: dispositivo no autorizado');
      return Promise.resolve(err(new DeviceNotAllowedError(serialNumber)));
    }

    // El equipo consulta comandos cada pocos segundos: a nivel info inundaría el log.
    if (contact.kind === 'poll') logger.debug(input, 'zkteco: contacto del dispositivo');
    else logger.info(input, 'zkteco: contacto del dispositivo');

    return Promise.resolve(ok(undefined));
  }
}
