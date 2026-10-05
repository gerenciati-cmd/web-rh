import type { Clock, Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';

interface Deps {
  deviceCommandRepository: DeviceCommandRepository;
  clock: Clock;
  logger: Logger;
}

/**
 * Entrega el comando en cola más antiguo del equipo (una sola vez) cuando éste consulta
 * `getrequest`; devuelve su texto, o `null` si no hay ninguno.
 */
export class TakeDeviceCommand implements UseCase<{ deviceId: string }, string | null> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { deviceId: string }): Promise<string | null> {
    const { deviceCommandRepository, clock, logger } = this.deps;

    const command = await deviceCommandRepository.nextQueued(input.deviceId as DeviceId);
    if (!command) return null;

    command.markSent(clock.now());
    await deviceCommandRepository.save(command);
    logger.info({ deviceId: input.deviceId, commandId: command.id }, 'zkteco: comando entregado');
    return command.command;
  }
}
