import type { PasswordResetTokens } from '../application/ports/password-reset-tokens';

import { CryptoSessionTokens } from './crypto-session-tokens';

/** Mismo esquema que los tokens de sesión (256 bits, SHA-256): ver ADR 0011. */
export class CryptoPasswordResetTokens extends CryptoSessionTokens implements PasswordResetTokens {}
