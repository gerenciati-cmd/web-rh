import { createHash, randomBytes } from 'node:crypto';

import type { SessionTokens } from '../application/ports/session-tokens';

const TOKEN_BYTES = 32;

export class CryptoSessionTokens implements SessionTokens {
  issue(): { token: string; tokenHash: string } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, tokenHash: this.hashOf(token) };
  }

  // Un token aleatorio de 256 bits ya es incomputable por fuerza bruta: no necesita
  // un hash lento (argon2/bcrypt), a diferencia de una contraseña elegida por una persona.
  hashOf(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
