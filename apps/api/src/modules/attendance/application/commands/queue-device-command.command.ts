import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, IdGenerator, Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../../domain/device-command';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNetworkUnrestrictedError, DeviceNotFoundError } from '../../domain/errors';

export interface QueueDeviceCommandInput {
  deviceId: string;
  command: string;
  queuedBy: string;
}

interface Deps {
  deviceRepository: DeviceRepository;
  deviceCommandRepository: DeviceCommandRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}

/** Encola un comando USERINFO que el checador recibirá en su próximo sondeo. */
export class QueueDeviceCommand implements Command<QueueDeviceCommandInput, { id: string }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: QueueDeviceCommandInput) {
    const { deviceRepository, deviceCommandRepository, idGenerator, clock, logger } = this.deps;

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device) return err<DomainError>(new DeviceNotFoundError(input.deviceId));
    // Sin barrera de red, cualquiera con el serial se llevaría el RFC y el nombre (decisión 16).
    if (!device.receivesCommands) {
      return err<DomainError>(new DeviceNetworkUnrestrictedError(device.id));
    }

    const command = DeviceCommand.queue({
      id: idGenerator.next() as DeviceCommandId,
      deviceId: device.id,
      number: await deviceCommandRepository.nextNumber(),
      command: input.command,
      queuedBy: input.queuedBy,
      now: clock.now(),
    });
    if (!command.ok) return command;

    await deviceCommandRepository.save(command.value);
    // El texto del comando puede llevar un PIN o un nombre: no se registra.
    logger.info(
      {
        serialNumber: device.serialNumber,
        commandId: command.value.id,
        number: command.value.number,
      },
      'zkteco: comando encolado',
    );
    return ok({ id: command.value.id });
  }
}
