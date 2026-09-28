import {
  AggregateRoot,
  createEvent,
  err,
  InvalidValueError,
  ok,
  type Id,
  type NationalId,
  type Result,
} from '@rrhh/domain';

export type CompanyId = Id<'Company'>;

export interface CompanyProps {
  legalName: string;
  taxId: NationalId;
  active: boolean;
  createdAt: Date;
}

export const COMPANY_CREATED = 'organization.company.created';

/**
 * Agregado Company. Sus invariantes solo se pueden romper desde aquí:
 * el estado es privado y cambia únicamente a través de métodos con intención de negocio.
 */
export class Company extends AggregateRoot<CompanyId> {
  private constructor(
    id: CompanyId,
    private props: CompanyProps,
  ) {
    super(id);
  }

  /** Alta de una empresa nueva: valida y registra el evento de dominio. */
  static create(input: {
    id: CompanyId;
    legalName: string;
    taxId: NationalId;
    now: Date;
  }): Result<Company, InvalidValueError> {
    const legalName = input.legalName.trim();
    if (legalName.length < 2) {
      return err(new InvalidValueError('La razón social es demasiado corta'));
    }

    const company = new Company(input.id, {
      legalName,
      taxId: input.taxId,
      active: true,
      createdAt: input.now,
    });
    company.record(
      createEvent(
        COMPANY_CREATED,
        { companyId: input.id, country: input.taxId.country },
        input.now,
      ),
    );
    return ok(company);
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse; no emite eventos. */
  static restore(id: CompanyId, props: CompanyProps): Company {
    return new Company(id, props);
  }

  get legalName(): string {
    return this.props.legalName;
  }

  get taxId(): NationalId {
    return this.props.taxId;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  deactivate(): void {
    this.props = { ...this.props, active: false };
  }
}
