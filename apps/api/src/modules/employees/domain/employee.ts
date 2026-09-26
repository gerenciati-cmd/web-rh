import {
  AggregateRoot,
  BusinessRuleViolationError,
  createEvent,
  err,
  InvalidValueError,
  ok,
  type Email,
  type Id,
  type NationalId,
  type Result,
} from '@rrhh/domain';

export type EmployeeId = Id<'Employee'>;
export type EmployeeStatus = 'ACTIVE' | 'TERMINATED';

export interface EmployeeProps {
  companyId: string;
  nationalId: NationalId;
  firstName: string;
  lastName: string;
  email: Email;
  positionTitle: string | null;
  hireDate: Date;
  status: EmployeeStatus;
}

export const EmployeeHired = 'employees.employee.hired';
export const EmployeeTerminated = 'employees.employee.terminated';

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

    const employee = new Employee(input.id, {
      companyId: input.companyId,
      nationalId: input.nationalId,
      firstName,
      lastName,
      email: input.email,
      positionTitle: input.positionTitle?.trim() ?? null,
      hireDate: input.hireDate,
      status: 'ACTIVE',
    });
    employee.record(
      createEvent(EmployeeHired, { employeeId: input.id, companyId: input.companyId }, input.now),
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
    this.record(createEvent(EmployeeTerminated, { employeeId: this.id, terminationDate }, now));
    return ok(undefined);
  }

  get snapshot(): Readonly<EmployeeProps> {
    return this.props;
  }
}
