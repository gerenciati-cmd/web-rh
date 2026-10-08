import type { Clock, Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';
import { parseCommandResults } from '../../domain/device-record';

interface Deps {
  deviceCommandRepository: DeviceCommandRepository;
  clock: Clock;
  logger: Logger;
}

// El `ID` es el número `C:<n>:` que asignó el API (columna INT): uno más largo no es nuestro.
const COMMAND_NUMBER_PATTERN = /^\d{1,9}$/;

/**
 * Cierra los comandos que el equipo responde en `devicecmd`: cada resultado con `ID` y `Return`
 * deja su comando DONE (`Return=0`) o FAILED. Nunca registra el texto del comando.
 */
export class CompleteDeviceCommands implements UseCase<{ deviceId: string; body: string }, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { deviceId: string; body: string }): Promise<void> {
    const { deviceCommandRepository, clock, logger } = this.deps;
    const deviceId = input.deviceId as DeviceId;

    for (const result of parseCommandResults(input.body)) {
      const id = result.ID;
      const returnCode = result.Return;
      if (id === undefined || returnCode === undefined || !COMMAND_NUMBER_PATTERN.test(id)) {
        continue;
      }

      const number = Number(id);
      const command = await deviceCommandRepository.findByNumber(deviceId, number);
      if (!command) {
        logger.warn({ deviceId, number }, 'zkteco: resultado sin comando');
        continue;
      }
      if (!command.complete(returnCode, clock.now())) continue;

      await deviceCommandRepository.save(command);
      const logged = {
        deviceId,
        commandId: command.id,
        number,
        status: command.status,
        returnCode: command.returnCode,
      };
      if (command.status === 'FAILED') logger.warn(logged, 'zkteco: comando completado');
      else logger.info(logged, 'zkteco: comando completado');
    }
  }
}
