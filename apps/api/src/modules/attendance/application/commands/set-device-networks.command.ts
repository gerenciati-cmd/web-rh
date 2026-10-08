import { err, ok, type DomainError } from '@rrhh/domain';

import type { Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotFoundError } from '../../domain/errors';

export interface SetDeviceNetworksInput {
  deviceId: string;
  allowedNetworks: readonly string[];
}

interface Deps {
  deviceRepository: DeviceRepository;
  logger: Logger;
}

/**
 * Define las redes IPv4 desde las que un checador puede conectarse a `/iclock` (ADR 0015). Una
 * lista vacía quita la restricción, y con ella la entrega de comandos.
 */
export class SetDeviceNetworks implements Command<SetDeviceNetworksInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetDeviceNetworksInput) {
    const { deviceRepository, logger } = this.deps;

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device) return err<DomainError>(new DeviceNotFoundError(input.deviceId));

    const set = device.setAllowedNetworks(input.allowedNetworks);
    if (!set.ok) return set;

    await deviceRepository.saveAllowedNetworks(device);
    logger.info(
      { serialNumber: device.serialNumber, allowedNetworks: device.allowedNetworks },
      'zkteco: redes del equipo actualizadas',
    );
    return ok(undefined);
  }
}
