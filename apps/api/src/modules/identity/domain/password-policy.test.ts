import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPasswordPolicy } from './password-policy';

describe('checkPasswordPolicy', () => {
  it('rechaza una contraseña más corta que el mínimo', () => {
    const result = checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
  });

  it('acepta una contraseña exactamente en el mínimo', () => {
    const result = checkPasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH));

    expect(result.ok).toBe(true);
  });

  it('acepta una contraseña exactamente en el máximo', () => {
    const result = checkPasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH));

    expect(result.ok).toBe(true);
  });

  it('rechaza una contraseña más larga que el máximo', () => {
    const result = checkPasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
  });

  it('cuenta puntos de código Unicode, no unidades UTF-16 (un emoji no cuenta doble)', () => {
    // 11 emoji (1 punto de código cada uno, pero 2 unidades UTF-16 cada uno) + 1 letra = 12.
    const withEmoji = `${'😀'.repeat(PASSWORD_MIN_LENGTH - 1)}a`;
    // eslint-disable-next-line @typescript-eslint/no-misused-spread -- igual que password-policy.ts: cuenta puntos de código, no unidades UTF-16.
    expect([...withEmoji].length).toBe(PASSWORD_MIN_LENGTH);
    expect(withEmoji.length).toBeGreaterThan(PASSWORD_MIN_LENGTH);

    const result = checkPasswordPolicy(withEmoji);

    expect(result.ok).toBe(true);
  });
});
