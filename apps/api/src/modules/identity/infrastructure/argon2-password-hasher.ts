import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from '../application/ports/password-hasher';

const argon2Async = promisify(argon2);

// OWASP Password Storage Cheat Sheet, mínimo recomendado para Argon2id:
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_PASSES = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;
/** Versión de Argon2 (0x13 = 19), fija; solo se registra en el string PHC. */
const ARGON2_VERSION = 19;

/** Usado cuando el correo no existe, para que `verify` cueste lo mismo que un intento real. */
const DUMMY_PASSWORD_FOR_TIMING = 'contraseña-de-referencia-para-tiempo-constante-no-real';

interface ParsedPhc {
  memory: number;
  passes: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
}

function encodePhc(input: ParsedPhc): string {
  const salt = input.salt.toString('base64url');
  const hash = input.hash.toString('base64url');
  return `$argon2id$v=${ARGON2_VERSION}$m=${input.memory},t=${input.passes},p=${input.parallelism}$${salt}$${hash}`;
}

/** `null` si el string no tiene la forma esperada: `verify` lo trata como no válido. */
function parsePhc(encoded: string): ParsedPhc | null {
  const parts = encoded.split('$');
  // ['', 'argon2id', 'v=19', 'm=…,t=…,p=…', salt, hash]
  if (parts.length !== 6 || parts[1] !== 'argon2id') return null;

  const params = new Map(
    (parts[3] ?? '').split(',').map((pair) => {
      const [key, value] = pair.split('=');
      return [key, value] as const;
    }),
  );
  const memory = Number(params.get('m'));
  const passes = Number(params.get('t'));
  const parallelism = Number(params.get('p'));
  if (!Number.isInteger(memory) || !Number.isInteger(passes) || !Number.isInteger(parallelism)) {
    return null;
  }

  const saltPart = parts[4];
  const hashPart = parts[5];
  if (!saltPart || !hashPart) return null;

  try {
    return {
      memory,
      passes,
      parallelism,
      salt: Buffer.from(saltPart, 'base64url'),
      hash: Buffer.from(hashPart, 'base64url'),
    };
  } catch {
    return null;
  }
}

export class Argon2PasswordHasher implements PasswordHasher {
  #dummyHash: string | undefined;

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(ARGON2_SALT_LENGTH);
    const derived = await argon2Async('argon2id', {
      message: plain,
      nonce: salt,
      parallelism: ARGON2_PARALLELISM,
      tagLength: ARGON2_TAG_LENGTH,
      memory: ARGON2_MEMORY_KIB,
      passes: ARGON2_PASSES,
    });
    return encodePhc({
      memory: ARGON2_MEMORY_KIB,
      passes: ARGON2_PASSES,
      parallelism: ARGON2_PARALLELISM,
      salt,
      hash: derived,
    });
  }

  async verify(plain: string, hash: string): Promise<boolean> {
    const parsed = parsePhc(hash);
    if (!parsed) return false;

    try {
      // Se usan los parámetros GUARDADOS (no las constantes actuales): así un cambio futuro
      // de política sigue verificando los hashes ya emitidos.
      const derived = await argon2Async('argon2id', {
        message: plain,
        nonce: parsed.salt,
        parallelism: parsed.parallelism,
        tagLength: parsed.hash.length,
        memory: parsed.memory,
        passes: parsed.passes,
      });
      return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
    } catch {
      return false;
    }
  }

  async simulateVerify(plain: string): Promise<void> {
    this.#dummyHash ??= await this.hash(DUMMY_PASSWORD_FOR_TIMING);
    await this.verify(plain, this.#dummyHash);
  }
}
