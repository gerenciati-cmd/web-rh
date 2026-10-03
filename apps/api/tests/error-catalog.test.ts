import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { API_ERRORS } from '@rrhh/contracts';
import { describe, expect, it } from 'vitest';

/**
 * El catálogo `API_ERRORS` (contracts) es documentación escrita a mano: este test lo ata a lo que
 * el código REALMENTE puede devolver, leyendo los fuentes. Si agregas un error y no lo documentas
 * (o lo documentas con otro status), falla aquí en vez de mentir en la referencia de la API.
 */
const SRC = join(import.meta.dirname, '..', 'src');

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8');

const moduleErrorFiles = readdirSync(join(SRC, 'modules'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join('modules', entry.name, 'domain', 'errors.ts'))
  .filter((path) => {
    try {
      read(path);
      return true;
    } catch {
      return false;
    }
  });

const httpFiles = [
  join('http', 'request-context.ts'),
  join('http', 'request-validation-error.ts'),
  join('http', 'error-handler.ts'),
];

/** Mismo mapa categoría → status que `http/error-handler.ts`. */
const STATUS_BY_CATEGORY: Readonly<Record<string, number>> = {
  NotFoundError: 404,
  ConflictError: 409,
  BusinessRuleViolationError: 422,
  InvalidValueError: 422,
  AuthenticationError: 401,
  TooManyRequestsError: 429,
};

const CODE_LITERAL = /\bcode(?:\s*:\s*string)?\s*(?:=|:)\s*'([A-Z][A-Z_]+)'/g;

const literalsOf = (path: string): string[] =>
  [...read(path).matchAll(CODE_LITERAL)].flatMap((match) => (match[1] ? [match[1]] : []));

describe('Catálogo de errores de la API (API_ERRORS)', () => {
  it('encuentra los fuentes que lee (guarda contra un test que no verifica nada)', () => {
    expect(moduleErrorFiles.length).toBeGreaterThanOrEqual(4);
    expect(httpFiles.flatMap(literalsOf).length).toBeGreaterThanOrEqual(4);
  });

  it('documenta cada código de los errors.ts de módulo y de la capa HTTP', () => {
    const found = [...moduleErrorFiles, ...httpFiles].flatMap((path) =>
      literalsOf(path).map((code) => ({ code, path })),
    );
    for (const { code, path } of found) {
      expect(API_ERRORS, `${code} (${path}) no está en API_ERRORS`).toHaveProperty([code]);
    }
  });

  it('no documenta códigos que el código ya no devuelve', () => {
    const inSources = new Set(
      [...moduleErrorFiles, ...httpFiles]
        .flatMap(literalsOf)
        .concat('INVALID_VALUE', 'BUSINESS_RULE_VIOLATION'),
    );
    // INVALID_VALUE y BUSINESS_RULE_VIOLATION viven en packages/domain (códigos por defecto de las clases base).
    for (const code of Object.keys(API_ERRORS)) {
      expect(inSources.has(code), `${code} está en API_ERRORS pero ningún fuente lo emite`).toBe(
        true,
      );
    }
  });

  it('el status del catálogo coincide con la categoría de la clase de error', () => {
    const classPattern =
      /class\s+(\w+)\s+extends\s+(\w+)\s*\{\s*(?:override\s+)?readonly\s+code\s*=\s*'([A-Z_]+)'/g;
    let checked = 0;
    for (const path of moduleErrorFiles) {
      for (const [, name, category, code] of read(path).matchAll(classPattern)) {
        const expected = category ? STATUS_BY_CATEGORY[category] : undefined;
        expect(expected, `${name} extiende ${category}, categoría desconocida`).toBeDefined();
        expect(
          (API_ERRORS as Record<string, { status: number } | undefined>)[code ?? '']?.status,
          `${name} (${code}) debería documentarse con status ${expected}`,
        ).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it('los ejemplos usan el mismo code que su entrada', () => {
    for (const [code, doc] of Object.entries(API_ERRORS)) {
      expect(doc.examples.default.code).toBe(code);
    }
  });
});
