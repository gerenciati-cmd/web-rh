import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotFoundError, InactiveSiteError, SiteNotFoundError } from '../../domain/errors';
import type { SiteDirectory } from '../ports/site-directory';

export interface AssignDeviceSiteInput {
  deviceId: string;
  siteId: string;
}

interface Deps {
  deviceRepository: DeviceRepository;
  deviceSiteDirectory: SiteDirectory;
  eventBus: EventBus;
  clock: Clock;
}

/** Asigna la sede de un checador; su zona horaria se copia de la sede. */
export class AssignDeviceSite implements Command<AssignDeviceSiteInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: AssignDeviceSiteInput) {
    const { deviceRepository, deviceSiteDirectory, eventBus, clock } = this.deps;

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device) return err<DomainError>(new DeviceNotFoundError(input.deviceId));

    const site = await deviceSiteDirectory.find(input.siteId);
    if (!site) return err<DomainError>(new SiteNotFoundError(input.siteId));
    if (!site.active) return err<DomainError>(new InactiveSiteError(input.siteId));

    device.assignSite(site.id, site.timeZone, clock.now());
    await deviceRepository.saveSite(device);
    await eventBus.publish(device.pullEvents());
    return ok(undefined);
  }
}
