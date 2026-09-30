import {
  asClass,
  asFunction,
  asValue,
  createContainer,
  InjectionMode,
  type AwilixContainer,
} from 'awilix';
import type { Logger as PinoLogger } from 'pino';

import type { Env } from './config/env';
import { DatabaseHealthCheck } from './infrastructure/database/database-health-check';
import { PrismaDatabase } from './infrastructure/database/prisma-database';
import { PrismaTransactionRunner } from './infrastructure/database/prisma-transaction-runner';
import { SmtpEmailSender } from './infrastructure/email/smtp-email-sender';
import { InMemoryEventBus } from './infrastructure/events/in-memory-event-bus';
import { BullMqJobQueue } from './infrastructure/queue/bullmq-job-queue';
import { SystemClock } from './infrastructure/system/system-clock';
import { UuidV7Generator } from './infrastructure/system/uuid-v7-generator';
import { attendanceModule, type AttendanceCradle } from './modules/attendance';
import { employeesModule, type EmployeesCradle } from './modules/employees';
import { identityModule, type IdentityCradle } from './modules/identity';
import { organizationModule, type OrganizationCradle } from './modules/organization';
import type { EmailSender } from './shared/application/email';
import type { JobQueue } from './shared/application/jobs';
import type {
  Clock,
  EventBus,
  HealthCheck,
  IdGenerator,
  TransactionRunner,
} from './shared/application/ports';

/**
 * COMPOSITION ROOT: el único lugar que conoce todas las implementaciones concretas
 * y las conecta con sus puertos. Nada fuera de aquí (y de `main/`) hace `new` de adaptadores.
 */

/** Módulos de negocio activos. Agregar un módulo = agregarlo aquí y en `Cradle`. */
export const modules = [
  identityModule,
  organizationModule,
  employeesModule,
  attendanceModule,
] as const;

export interface SharedCradle {
  env: Env;
  logger: PinoLogger;
  databaseUrl: string;
  redisUrl: string;
  database: PrismaDatabase;
  transactionRunner: TransactionRunner;
  eventBus: EventBus;
  jobQueue: JobQueue;
  emailSender: EmailSender;
  clock: Clock;
  idGenerator: IdGenerator;
  healthChecks: HealthCheck[];
}

export type Cradle = SharedCradle &
  IdentityCradle &
  OrganizationCradle &
  EmployeesCradle &
  AttendanceCradle;
export type AppContainer = AwilixContainer<Cradle>;

export function buildContainer(env: Env, logger: PinoLogger): AppContainer {
  // PROXY: cada clase recibe un objeto `deps` y desestructura solo lo que usa.
  // strict: detecta dependencias con ciclo de vida incompatible.
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.PROXY, strict: true });

  container.register({
    env: asValue(env),
    logger: asValue(logger),
    databaseUrl: asValue(env.DATABASE_URL),
    redisUrl: asValue(env.REDIS_URL),
    database: asClass(PrismaDatabase)
      .singleton()
      .disposer((db) => db.disconnect()),
    transactionRunner: asClass(PrismaTransactionRunner).singleton(),
    eventBus: asClass(InMemoryEventBus).singleton(),
    jobQueue: asClass(BullMqJobQueue)
      .singleton()
      .disposer((queue) => queue.close()),
    emailSender: asClass(SmtpEmailSender)
      .singleton()
      .disposer((sender) => {
        sender.close();
      }),
    clock: asClass(SystemClock).singleton(),
    idGenerator: asClass(UuidV7Generator).singleton(),
    healthChecks: asFunction(({ database }: Cradle) => [
      new DatabaseHealthCheck({ database }),
    ]).singleton(),
  });

  for (const module of modules) container.register(module.registrations);

  return container;
}

/** Conecta las suscripciones a eventos declaradas por cada módulo. */
export function wireSubscriptions(container: AppContainer): void {
  for (const module of modules) {
    module.subscribe?.(container.cradle);
  }
}
