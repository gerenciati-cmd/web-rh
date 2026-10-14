import { err, ok, type DomainError } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { RecordingJobQueue, RecordingLogger } from '@/shared/testing/fakes';

import { EmployeeWithoutRfcError } from '../../domain/errors';
import type {
  RecalculateWorkdays,
  RecalculateWorkdaysInput,
} from '../commands/recalculate-workdays.command';
import type { PunchOwner } from '../ports/punch-owner-directory';
import type { WorkdayEmployee } from '../ports/workday-employee-directory';

import {
  enqueueWorkdayRecalculation,
  RECALCULATE_WORKDAYS,
  RecalculateWorkdaysJob,
} from './recalculate-workdays.job';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const PIN = 'GOMA850101AB1';
const TODAY = '2026-10-14';

describe('enqueueWorkdayRecalculation', () => {
  it('encola el job con el objetivo y el rango acotado a hoy', async () => {
    const queue = new RecordingJobQueue();

    await enqueueWorkdayRecalculation(
      queue,
      { employeeId: EMPLOYEE },
      '2026-10-10',
      '2026-12-01',
      TODAY,
    );

    expect(queue.jobs).toEqual([
      {
        name: RECALCULATE_WORKDAYS,
        data: { employeeId: EMPLOYEE, from: '2026-10-10', to: TODAY },
        options: undefined,
      },
    ]);
  });

  it('con un PIN como objetivo, el payload lleva pin y no employeeId', async () => {
    const queue = new RecordingJobQueue();

    await enqueueWorkdayRecalculation(queue, { pin: PIN }, '2026-10-12', '2026-10-13', TODAY);

    expect(queue.jobs.map((job) => job.data)).toEqual([
      { pin: PIN, from: '2026-10-12', to: '2026-10-13' },
    ]);
  });

  it('no encola nada si el rango queda vacío tras acotarlo', async () => {
    const queue = new RecordingJobQueue();

    await enqueueWorkdayRecalculation(
      queue,
      { employeeId: EMPLOYEE },
      '2026-10-15',
      '2026-10-20',
      TODAY,
    );
    await enqueueWorkdayRecalculation(
      queue,
      { employeeId: EMPLOYEE },
      '2026-01-01',
      '2026-02-01',
      TODAY,
    );

    expect(queue.jobs).toEqual([]);
  });
});

type ExecuteResult = Awaited<ReturnType<RecalculateWorkdays['execute']>>;

function setUp(
  options: {
    employee?: WorkdayEmployee | null;
    owner?: PunchOwner | null;
    result?: ExecuteResult | Error;
  } = {},
) {
  const logger = new RecordingLogger();
  const calls: RecalculateWorkdaysInput[] = [];
  const employee: WorkdayEmployee | null =
    options.employee === undefined
      ? {
          id: EMPLOYEE,
          companyId: COMPANY,
          active: true,
          rfc: PIN,
          siteId: null,
          hireDate: '2026-01-10',
          terminationDate: null,
        }
      : options.employee;
  const owner: PunchOwner | null =
    options.owner === undefined
      ? { employeeId: EMPLOYEE, companyId: COMPANY, fullName: 'Ana Rojas' }
      : options.owner;
  const result: ExecuteResult | Error =
    options.result ?? ok({ recalculatedDates: 3, storedWorkdays: 2, pendingDates: ['2026-10-14'] });

  // Doble del caso de uso: lo que se prueba aquí es el job (resolver, registrar, propagar), no el cálculo.
  const recalculateWorkdays = {
    execute: (input: RecalculateWorkdaysInput) => {
      calls.push(input);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  } as unknown as RecalculateWorkdays;
  const ownerLookups: (readonly string[])[] = [];
  const directoryLookups: string[] = [];

  const job = new RecalculateWorkdaysJob({
    recalculateWorkdays,
    workdayEmployeeDirectory: {
      find: (id) => {
        directoryLookups.push(id);
        return Promise.resolve(employee);
      },
    },
    punchOwnerDirectory: {
      ownersOf: (pins) => {
        ownerLookups.push(pins);
        return Promise.resolve(new Map(owner ? pins.map((pin) => [pin, owner]) : []));
      },
      pinsOfCompanies: () => Promise.resolve([]),
    },
    logger,
  });
  return { job, logger, calls, ownerLookups, directoryLookups };
}

describe('RecalculateWorkdaysJob', () => {
  const range = { from: '2026-10-12', to: '2026-10-14' };

  it('se llama como el job que encolan los disparadores', () => {
    expect(setUp().job.name).toBe('attendance.recalculate-workdays');
  });

  it('con employeeId resuelve el colaborador en el directorio y recalcula su empresa y rango', async () => {
    const { job, calls, ownerLookups, directoryLookups } = setUp();

    await job.handle({ employeeId: EMPLOYEE, ...range });

    expect(directoryLookups).toEqual([EMPLOYEE]);
    expect(ownerLookups).toEqual([]);
    expect(calls).toEqual([{ companyId: COMPANY, employeeId: EMPLOYEE, ...range }]);
  });

  it('con pin resuelve al dueño de la marcación y recalcula', async () => {
    const { job, calls, ownerLookups, directoryLookups } = setUp();

    await job.handle({ pin: PIN, ...range });

    expect(ownerLookups).toEqual([[PIN]]);
    expect(directoryLookups).toEqual([]);
    expect(calls).toEqual([{ companyId: COMPANY, employeeId: EMPLOYEE, ...range }]);
  });

  it('un PIN sin colaborador termina con un log debug, sin recalcular ni avisar', async () => {
    const { job, calls, logger } = setUp({ owner: null });

    await job.handle({ pin: 'DESCONOCIDO', ...range });

    expect(calls).toEqual([]);
    expect(logger.entries).toEqual([
      { level: 'debug', obj: { pin: 'DESCONOCIDO' }, msg: 'asistencia: PIN sin colaborador' },
    ]);
  });

  it('un employeeId que ya no existe termina con un aviso, sin recalcular', async () => {
    const { job, calls, logger } = setUp({ employee: null });

    await job.handle({ employeeId: EMPLOYEE, ...range });

    expect(calls).toEqual([]);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { employeeId: EMPLOYEE },
        msg: 'asistencia: colaborador no encontrado',
      },
    ]);
  });

  it('un payload sin employeeId ni pin avisa y no llama al caso de uso', async () => {
    const { job, calls, logger } = setUp();

    await job.handle({ ...range });

    expect(calls).toEqual([]);
    expect(logger.entries.map((entry) => [entry.level, entry.msg])).toEqual([
      ['warn', 'asistencia: job de recálculo sin colaborador'],
    ]);
  });

  it('un err del caso de uso se registra como aviso con su code y el job termina sin lanzar', async () => {
    const { job, logger } = setUp({
      result: err<DomainError>(new EmployeeWithoutRfcError(EMPLOYEE)),
    });

    await expect(job.handle({ employeeId: EMPLOYEE, ...range })).resolves.toBeUndefined();

    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { employeeId: EMPLOYEE, code: 'EMPLOYEE_WITHOUT_RFC' },
        msg: 'asistencia: recálculo omitido',
      },
    ]);
  });

  it('un recálculo correcto registra los conteos a nivel info', async () => {
    const { job, logger } = setUp();

    await job.handle({ employeeId: EMPLOYEE, ...range });

    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: {
          employeeId: EMPLOYEE,
          ...range,
          recalculatedDates: 3,
          storedWorkdays: 2,
          pendingDates: 1,
        },
        msg: 'asistencia: jornadas recalculadas',
      },
    ]);
  });

  it('una excepción inesperada se propaga para que BullMQ reintente', async () => {
    const { job } = setUp({ result: new Error('Postgres caído') });

    await expect(job.handle({ employeeId: EMPLOYEE, ...range })).rejects.toThrow('Postgres caído');
  });
});
