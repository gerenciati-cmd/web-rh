import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { Device, type DeviceId } from '../../domain/device';
import type { DeviceRepository } from '../../domain/device.repository';
import {
  DeviceAlreadyRegisteredError,
  InactiveSiteError,
  SiteNotFoundError,
} from '../../domain/errors';
import type { SiteDirectory } from '../ports/site-directory';

export interface RegisterDeviceInput {
  serialNumber: string;
  name: string;
  siteId: string;
}

interface Deps {
  deviceRepository: DeviceRepository;
  deviceSiteDirectory: SiteDirectory;
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

    const site = await this.deps.deviceSiteDirectory.find(input.siteId);
    if (!site) return err<DomainError>(new SiteNotFoundError(input.siteId));
    if (!site.active) return err<DomainError>(new InactiveSiteError(input.siteId));

    const device = Device.register({
      id: this.deps.idGenerator.next() as DeviceId,
      serialNumber,
      name: input.name,
      siteId: site.id,
      timeZone: site.timeZone,
      now: this.deps.clock.now(),
    });
    if (!device.ok) return device;

    const saved = await this.deps.deviceRepository.save(device.value);
    if (!saved.ok) return saved;
    await this.deps.eventBus.publish(device.value.pullEvents());

    return ok({ id: device.value.id });
  }
}
