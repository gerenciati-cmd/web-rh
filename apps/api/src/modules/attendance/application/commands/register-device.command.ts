import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { Device, type DeviceId } from '../../domain/device';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceAlreadyRegisteredError } from '../../domain/errors';

export interface RegisterDeviceInput {
  serialNumber: string;
  name: string;
  timeZone: string;
}

interface Deps {
  deviceRepository: DeviceRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

/** Autoriza un checador: solo los equipos registrados pueden empujar marcaciones. */
export class RegisterDevice implements Command<RegisterDeviceInput, { id: DeviceId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RegisterDeviceInput) {
    const serialNumber = input.serialNumber.trim();
    if (await this.deps.deviceRepository.findBySerialNumber(serialNumber)) {
      return err<DomainError>(new DeviceAlreadyRegisteredError(serialNumber));
    }

    const device = Device.register({
      id: this.deps.idGenerator.next() as DeviceId,
      serialNumber,
      name: input.name,
      timeZone: input.timeZone,
      now: this.deps.clock.now(),
    });
    if (!device.ok) return device;

    const saved = await this.deps.deviceRepository.save(device.value);
    if (!saved.ok) return saved;
    await this.deps.eventBus.publish(device.value.pullEvents());

    return ok({ id: device.value.id });
  }
}
