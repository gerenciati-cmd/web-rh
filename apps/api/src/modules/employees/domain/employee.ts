import {
  AggregateRoot,
  BusinessRuleViolationError,
  createEvent,
  err,
  InvalidValueError,
  ok,
  type Email,
  type EmployeeStatus,
  type Id,
  type NationalId,
  type PersonalRfc,
  type Result,
} from '@rrhh/domain';

import { RfcNotApplicableError } from './errors';

export type EmployeeId = Id<'Employee'>;
export type { EmployeeStatus } from '@rrhh/domain';

export interface EmployeeProps {
  companyId: string;
  nationalId: NationalId;
  /** RFC de persona física: obligatorio al contratar en México; nulo en filas anteriores al campo. */
  rfc: PersonalRfc | null;
  firstName: string;
  lastName: string;
  email: Email;
  positionTitle: string | null;
  hireDate: Date;
  status: EmployeeStatus;
}

export const EMPLOYEE_HIRED = 'employees.employee.hired';
export const EMPLOYEE_TERMINATED = 'employees.employee.terminated';

/** Máximo de anticipación para registrar una contratación futura. */
const MAX_DAYS_HIRE_IN_ADVANCE = 90;
const DAY_MS = 86_400_000;

export class Employee extends AggregateRoot<EmployeeId> {
  private constructor(
    id: EmployeeId,
    private props: EmployeeProps,
  ) {
    super(id);
  }

  static hire(input: {
    id: EmployeeId;
    companyId: string;
    nationalId: NationalId;
    firstName: string;
    lastName: string;
    email: Email;
    rfc?: PersonalRfc | undefined;
    positionTitle?: string | undefined;
    hireDate: Date;
    now: Date;
  }): Result<Employee, InvalidValueError | BusinessRuleViolationError> {
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    if (!firstName || !lastName) {
      return err(new InvalidValueError('Nombre y apellido son obligatorios'));
    }

    const daysInAdvance = (input.hireDate.getTime() - input.now.getTime()) / DAY_MS;
    if (daysInAdvance > MAX_DAYS_HIRE_IN_ADVANCE) {
      return err(
        new BusinessRuleViolationError(
          `No se puede registrar una contratación con más de ${MAX_DAYS_HIRE_IN_ADVANCE} días de anticipación`,
        ),
      );
    }

    if (input.nationalId.country === 'MX' && !input.rfc) {
      return err(new InvalidValueError('El RFC es obligatorio para colaboradores de México'));
    }
    if (input.nationalId.country !== 'MX' && input.rfc) {
      return err(new InvalidValueError('El RFC solo aplica a colaboradores de México'));
    }

    const employee = new Employee(input.id, {
      companyId: input.companyId,
      nationalId: input.nationalId,
      rfc: input.rfc ?? null,
      firstName,
      lastName,
      email: input.email,
      positionTitle: input.positionTitle?.trim() ?? null,
      hireDate: input.hireDate,
      status: 'ACTIVE',
    });
    employee.record(
      createEvent(EMPLOYEE_HIRED, { employeeId: input.id, companyId: input.companyId }, input.now),
    );
    return ok(employee);
  }

  static restore(id: EmployeeId, props: EmployeeProps): Employee {
    return new Employee(id, props);
  }

  /** Desvinculación. Las reglas de finiquito vivirán aquí (o en un servicio de dominio). */
  terminate(terminationDate: Date, now: Date): Result<void, BusinessRuleViolationError> {
    if (this.props.status === 'TERMINATED') {
      return err(new BusinessRuleViolationError('El colaborador ya está desvinculado'));
    }
    if (terminationDate < this.props.hireDate) {
      return err(
        new BusinessRuleViolationError('La fecha de término es anterior a la contratación'),
      );
    }
    this.props = { ...this.props, status: 'TERMINATED' };
    this.record(createEvent(EMPLOYEE_TERMINATED, { employeeId: this.id, terminationDate }, now));
    return ok(undefined);
  }

  /** Captura o corrige el RFC; la unicidad en el holding la verifica el caso de uso. */
  assignRfc(rfc: PersonalRfc): Result<void, BusinessRuleViolationError> {
    if (this.props.nationalId.country !== 'MX') return err(new RfcNotApplicableError());
    this.props = { ...this.props, rfc };
    return ok(undefined);
  }

  get snapshot(): Readonly<EmployeeProps> {
    return this.props;
  }
}
