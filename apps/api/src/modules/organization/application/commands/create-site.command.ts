import { err, ok, type CountryCode, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { SiteAlreadyExistsError } from '../../domain/errors';
import { Site, type SiteId } from '../../domain/site';
import type { SiteRepository } from '../../domain/site.repository';

export interface CreateSiteInput {
  name: string;
  country: CountryCode;
  timeZone: string;
}

interface Deps {
  siteRepository: SiteRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

export class CreateSite implements Command<CreateSiteInput, { id: SiteId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateSiteInput) {
    const name = input.name.trim();
    if (await this.deps.siteRepository.existsByName(name)) {
      return err<DomainError>(new SiteAlreadyExistsError(name));
    }

    const site = Site.create({
      id: this.deps.idGenerator.next() as SiteId,
      name,
      country: input.country,
      timeZone: input.timeZone,
      now: this.deps.clock.now(),
    });
    if (!site.ok) return site;

    const saved = await this.deps.siteRepository.save(site.value);
    if (!saved.ok) return saved;
    await this.deps.eventBus.publish(site.value.pullEvents());

    return ok({ id: site.value.id });
  }
}
