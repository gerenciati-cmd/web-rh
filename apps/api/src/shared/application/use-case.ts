import type { DomainError, Result } from '@rrhh/domain';

/**
 * Contrato de todo caso de uso: una clase, una operación, un método `execute`.
 *
 *  • Command → modifica estado vía agregado + repositorio. Devuelve Result (errores esperados).
 *  • Query   → lee vía puerto `XxxQueries` y devuelve DTOs. No toca el dominio.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

export type Command<TInput, TOutput, TError extends DomainError = DomainError> = UseCase<
  TInput,
  Result<TOutput, TError>
>;
