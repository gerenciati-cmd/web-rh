import { API_ERRORS, type ApiErrorBody } from '@rrhh/contracts';
import { BusinessRuleViolationError, DomainError, InvalidValueError } from '@rrhh/domain';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '@/http/error-handler';
import { AuthenticationRequiredError, PermissionDeniedError } from '@/http/request-context';
import { RequestValidationError } from '@/http/request-validation-error';
import * as attendanceErrors from '@/modules/attendance/domain/errors';
import * as employeesErrors from '@/modules/employees/domain/errors';
import * as identityErrors from '@/modules/identity/domain/errors';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@/modules/identity/domain/password-policy';
import * as organizationErrors from '@/modules/organization/domain/errors';
import { RecordingLogger } from '@/shared/testing/fakes';

/**
 * El catálogo `API_ERRORS` (contracts) es documentación escrita a mano: este test lo ata a lo que
 * el API REALMENTE responde. Se instancia cada clase de error exportada por los `errors.ts` de los
 * módulos (más las bases de `@rrhh/domain` y los errores de la capa HTTP), se pasa por el
 * `errorHandler` real y se compara status, code, message y claves de `details` con el catálogo.
 * Un error nuevo sin documentar (o con otro status) falla aquí en vez de mentir en la referencia.
 */

/** Argumentos por clase: la mayoría recibe ids/cadenas; estas dos reciben números. */
const ARGS_BY_CLASS: Readonly<Record<string, readonly unknown[]>> = {
  LoginTemporarilyBlockedError: [300],
  WeakPasswordError: [PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH],
};

/** Variante del catálogo que corresponde a una clase cuyo código lo comparten varios módulos. */
const VARIANT_BY_CLASS: Readonly<Record<string, string>> = {
  'identity/AssignmentCompanyInactiveError': 'role_assignment',
  'identity/EmployeeNotFoundError': 'identity',
};

interface Produced {
  readonly label: string;
  readonly status: number;
  readonly body: ApiErrorBody;
  readonly headers: Readonly<Record<string, string>>;
  /** `false` en las bases genéricas: su `message` lo pone quien las lanza. */
  readonly fixedMessage: boolean;
  readonly variant: string;
}

/** Corre `error` por el errorHandler real con un `res` mínimo. */
function respond(error: unknown): {
  status: number;
  body: ApiErrorBody;
  headers: Record<string, string>;
} {
  const captured: { status: number; body: ApiErrorBody | undefined } = {
    status: 0,
    body: undefined,
  };
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: ApiErrorBody) {
      captured.body = body;
      return res;
    },
    set(name: string, value: string) {
      headers[name] = value;
      return res;
    },
  };
  const next: NextFunction = () => {
    throw new Error('next no debe llamarse');
  };
  errorHandler(new RecordingLogger())(error, {} as Request, res as unknown as Response, next);
  if (!captured.body) throw new Error('el errorHandler no respondió');
  return { status: captured.status, body: captured.body, headers };
}

type ErrorClass = new (...args: never[]) => DomainError;

const isErrorClass = (value: unknown): value is ErrorClass =>
  typeof value === 'function' && value.prototype instanceof DomainError;

const moduleNamespaces: Readonly<Record<string, Record<string, unknown>>> = {
  attendance: attendanceErrors,
  employees: employeesErrors,
  identity: identityErrors,
  organization: organizationErrors,
};

const produced: Produced[] = [];

for (const [moduleName, namespace] of Object.entries(moduleNamespaces)) {
  for (const [name, exported] of Object.entries(namespace)) {
    if (!isErrorClass(exported)) continue;
    const args = ARGS_BY_CLASS[name] ?? ['a', 'b', 'c'];
    const instance = new (exported as unknown as new (...a: unknown[]) => DomainError)(...args);
    const { status, body, headers } = respond(instance);
    const label = `${moduleName}/${name}`;
    produced.push({
      label,
      status,
      body,
      headers,
      fixedMessage: true,
      variant: VARIANT_BY_CLASS[label] ?? 'default',
    });
  }
}

const generic = (label: string, error: unknown, fixedMessage: boolean): void => {
  const { status, body, headers } = respond(error);
  produced.push({ label, status, body, headers, fixedMessage, variant: 'default' });
};

generic('domain/InvalidValueError', new InvalidValueError('cualquier regla'), false);
generic(
  'domain/BusinessRuleViolationError',
  new BusinessRuleViolationError('cualquier regla'),
  false,
);
generic('http/RequestValidationError', new RequestValidationError('body', []), false);
generic('http/AuthenticationRequiredError', new AuthenticationRequiredError(), true);
generic('http/PermissionDeniedError', new PermissionDeniedError(), true);
generic('http/error inesperado', new Error('detalle interno'), true);

const keysOf = (details: unknown): string[] =>
  Object.keys((details as object | undefined) ?? {}).sort();

type Catalog = Record<string, { status: number; examples: Record<string, ApiErrorBody> }>;
const catalog: Catalog = API_ERRORS;

describe('Catálogo de errores de la API (API_ERRORS) contra el errorHandler real', () => {
  it('encuentra las clases que instancia (guarda contra un test que no verifica nada)', () => {
    expect(produced.filter((p) => p.fixedMessage).length).toBeGreaterThan(30);
    for (const module of Object.keys(moduleNamespaces)) {
      expect(produced.some((p) => p.label.startsWith(`${module}/`))).toBe(true);
    }
  });

  it('cada error que el API puede devolver está documentado con su status y su code', () => {
    for (const p of produced) {
      const documented = catalog[p.body.code];
      expect(documented, `${p.label} (${p.body.code}) no está en API_ERRORS`).toBeDefined();
      expect(p.status, `${p.label} (${p.body.code}): status distinto al del catálogo`).toBe(
        documented?.status,
      );
    }
  });

  it('el ejemplo (o su variante) coincide en message y en las claves de details', () => {
    for (const p of produced) {
      const example = catalog[p.body.code]?.examples[p.variant];
      expect(
        example,
        `${p.label}: falta el ejemplo "${p.variant}" de ${p.body.code}`,
      ).toBeDefined();
      if (!example) continue;
      expect(example.code, p.label).toBe(p.body.code);
      if (p.fixedMessage) {
        expect(example.message, `${p.label}: message distinto al real`).toBe(p.body.message);
      }
      expect(keysOf(example.details), `${p.label}: claves de details distintas`).toEqual(
        keysOf(p.body.details),
      );
    }
  });

  it('no documenta códigos que ninguna clase devuelve', () => {
    const emitted = new Set(produced.map((p) => p.body.code));
    // ROUTE_NOT_FOUND sale de notFoundHandler (no del errorHandler): lo cubre error-examples.test.ts.
    emitted.add('ROUTE_NOT_FOUND');
    for (const code of Object.keys(API_ERRORS)) {
      expect(emitted.has(code), `${code} está en API_ERRORS pero ninguna clase lo emite`).toBe(
        true,
      );
    }
  });

  it('no documenta variantes que ninguna clase usa', () => {
    const used = new Set(produced.map((p) => `${p.body.code}/${p.variant}`));
    for (const [code, doc] of Object.entries(catalog)) {
      if (code === 'ROUTE_NOT_FOUND') continue;
      for (const variant of Object.keys(doc.examples)) {
        expect(used.has(`${code}/${variant}`), `${code}/${variant} no lo usa ninguna clase`).toBe(
          true,
        );
      }
    }
  });

  it('las bases genéricas conservan su código y 429 envía Retry-After', () => {
    expect(produced.find((p) => p.label === 'domain/InvalidValueError')?.body.code).toBe(
      'INVALID_VALUE',
    );
    expect(produced.find((p) => p.label === 'domain/BusinessRuleViolationError')?.body.code).toBe(
      'BUSINESS_RULE_VIOLATION',
    );
    const blocked = produced.find((p) => p.label === 'identity/LoginTemporarilyBlockedError');
    expect(blocked?.headers['Retry-After']).toBe('300');
  });

  it('los ejemplos usan el mismo code que su entrada', () => {
    for (const [code, doc] of Object.entries(catalog)) {
      for (const [variant, example] of Object.entries(doc.examples)) {
        expect(example.code, `${code}/${variant}`).toBe(code);
      }
    }
  });
});
