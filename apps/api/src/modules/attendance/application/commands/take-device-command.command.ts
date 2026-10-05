import type { Clock, Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';
import type { DeviceRepository } from '../../domain/device.repository';

interface Deps {
  deviceRepository: DeviceRepository;
  deviceCommandRepository: DeviceCommandRepository;
  clock: Clock;
  logger: Logger;
}

/**
 * Entrega el comando en cola más antiguo del equipo (una sola vez) cuando éste consulta
 * `getrequest`; devuelve su texto, o `null` si no hay ninguno. Un equipo sin redes permitidas no
 * recibe comandos: los pendientes siguen en cola (decisión 12 del README).
 */
export class TakeDeviceCommand implements UseCase<{ deviceId: string }, string | null> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { deviceId: string }): Promise<string | null> {
    const { deviceRepository, deviceCommandRepository, clock, logger } = this.deps;

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device?.receivesCommands) return null;

    const command = await deviceCommandRepository.nextQueued(device.id);
    if (!command) return null;

    command.markSent(clock.now());
    await deviceCommandRepository.save(command);
    logger.info({ deviceId: input.deviceId, commandId: command.id }, 'zkteco: comando entregado');
    return command.command;
  }
}
