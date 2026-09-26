/**
 * Result explícito para errores ESPERADOS del dominio (validaciones, reglas de negocio).
 * Las excepciones quedan reservadas para fallos inesperados (IO caído, bugs).
 *
 * Así el compilador obliga al llamador a manejar el caso de error.
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Combina varios Result: devuelve el primer error o todos los valores. */
export function combine<T extends readonly Result<unknown, unknown>[]>(
  results: T,
): Result<
  { [K in keyof T]: T[K] extends Result<infer V, unknown> ? V : never },
  T[number] extends Result<unknown, infer E> ? E : never
> {
  const values: unknown[] = [];
  for (const result of results) {
    if (!result.ok) return result as never;
    values.push(result.value);
  }
  return ok(values as never);
}
