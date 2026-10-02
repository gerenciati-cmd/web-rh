import {
  AggregateRoot,
  createEvent,
  err,
  InvalidValueError,
  isSiteTimeZone,
  ok,
  type CountryCode,
  type Id,
  type Result,
} from '@rrhh/domain';

export type SiteId = Id<'Site'>;

export interface SiteProps {
  name: string;
  country: CountryCode;
  timeZone: string;
  active: boolean;
  createdAt: Date;
}

export const SITE_CREATED = 'organization.site.created';

/**
 * Clave de unicidad del nombre: sin espacios extremos, en NFC y en minúsculas. NFC porque
 * "Cancún" pegado con el acento como carácter aparte (NFD) se ve igual y debe chocar.
 */
export const siteNameKey = (name: string): string => name.trim().normalize('NFC').toLowerCase();

/**
 * Agregado Site (sede del holding). Su zona horaria sale de una lista cerrada por país:
 * una zona válida pero equivocada desplazaría todas las marcaciones de la sede.
 */
export class Site extends AggregateRoot<SiteId> {
  private constructor(
    id: SiteId,
    private props: SiteProps,
  ) {
    super(id);
  }

  /** Alta de una sede nueva: valida y registra el evento de dominio. */
  static create(input: {
    id: SiteId;
    name: string;
    country: CountryCode;
    timeZone: string;
    now: Date;
  }): Result<Site, InvalidValueError> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 100) {
      return err(new InvalidValueError('El nombre de la sede debe tener entre 2 y 100 caracteres'));
    }
    if (!isSiteTimeZone(input.country, input.timeZone)) {
      return err(new InvalidValueError('Zona horaria no permitida para el país de la sede'));
    }

    const site = new Site(input.id, {
      name,
      country: input.country,
      timeZone: input.timeZone,
      active: true,
      createdAt: input.now,
    });
    site.record(createEvent(SITE_CREATED, { siteId: input.id, country: input.country }, input.now));
    return ok(site);
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse; no emite eventos. */
  static restore(id: SiteId, props: SiteProps): Site {
    return new Site(id, props);
  }

  get name(): string {
    return this.props.name;
  }

  get country(): CountryCode {
    return this.props.country;
  }

  get timeZone(): string {
    return this.props.timeZone;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
