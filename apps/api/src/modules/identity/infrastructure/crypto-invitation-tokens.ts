import type { InvitationTokens } from '../application/ports/invitation-tokens';

import { CryptoSessionTokens } from './crypto-session-tokens';

/** Mismo esquema que los tokens de sesión (256 bits, SHA-256): ver ADR 0011. */
export class CryptoInvitationTokens extends CryptoSessionTokens implements InvitationTokens {}
