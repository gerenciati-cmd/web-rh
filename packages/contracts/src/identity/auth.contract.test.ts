import { describe, expect, it } from 'vitest';

import { LogInResponseSchema, LogInSchema, authRoutes } from './auth.contract';

describe('LogInSchema', () => {
  const base = { email: 'ana@aps.cl', password: 'contraseña-cualquiera', client: 'web' as const };

  it('acepta email, password y client válidos', () => {
    expect(LogInSchema.safeParse(base).success).toBe(true);
  });

  it('acepta client=mobile', () => {
    expect(LogInSchema.safeParse({ ...base, client: 'mobile' }).success).toBe(true);
  });

  it('rechaza un client fuera de web/mobile', () => {
    expect(LogInSchema.safeParse({ ...base, client: 'desktop' }).success).toBe(false);
  });

  it('rechaza un email con formato inválido', () => {
    expect(LogInSchema.safeParse({ ...base, email: 'no-es-email' }).success).toBe(false);
  });

  it('rechaza una password vacía (login no exige la política de fortaleza)', () => {
    expect(LogInSchema.safeParse({ ...base, password: '' }).success).toBe(false);
  });

  it('acepta una password corta (sin regla de mínimo, a diferencia de la política de alta)', () => {
    expect(LogInSchema.safeParse({ ...base, password: 'a' }).success).toBe(true);
  });

  it('rechaza una password de más de 128 caracteres', () => {
    expect(LogInSchema.safeParse({ ...base, password: 'a'.repeat(129) }).success).toBe(false);
  });

  it('acepta una password de exactamente 128 caracteres', () => {
    expect(LogInSchema.safeParse({ ...base, password: 'a'.repeat(128) }).success).toBe(true);
  });

  // Regresión L1 (plan 001, paso 15): sin `.max(254)`, un email con formato válido pero
  // larguísimo pasaba el contrato y hacía fallar el guardado del throttle en Postgres
  // (`login_throttles.key VARCHAR(320)`, prefijo `email:`) con un 500 en vez de un 401.
  it('acepta un email de exactamente 254 caracteres (mismo límite que users.email)', () => {
    const email = `${'a'.repeat(242)}@example.com`;
    expect(email).toHaveLength(254);

    expect(LogInSchema.safeParse({ ...base, email }).success).toBe(true);
  });

  it('rechaza un email de 255 caracteres o más, aunque el formato sea válido', () => {
    const email = `${'a'.repeat(243)}@example.com`;
    expect(email).toHaveLength(255);

    expect(LogInSchema.safeParse({ ...base, email }).success).toBe(false);
  });
});

describe('LogInResponseSchema', () => {
  const base = {
    user: { id: '00000000-0000-4000-8000-000000000000', email: 'ana@aps.cl', employeeId: null },
  };

  it('acepta token nulo (web: viaja en cookie)', () => {
    const result = LogInResponseSchema.safeParse({
      ...base,
      expiresAt: '2026-01-15T12:00:00.000Z',
      token: null,
    });
    expect(result.success).toBe(true);
  });

  it('acepta un token string (mobile)', () => {
    const result = LogInResponseSchema.safeParse({
      ...base,
      expiresAt: '2026-01-15T12:00:00.000Z',
      token: 'un-token',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza si falta token (ni string ni null)', () => {
    const result = LogInResponseSchema.safeParse({
      ...base,
      expiresAt: '2026-01-15T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un expiresAt que no es datetime ISO', () => {
    const result = LogInResponseSchema.safeParse({
      ...base,
      expiresAt: 'no-es-fecha',
      token: null,
    });
    expect(result.success).toBe(false);
  });
});

describe('authRoutes', () => {
  it('logIn es POST /auth/login', () => {
    expect(authRoutes.logIn.method).toBe('POST');
    expect(authRoutes.logIn.path).toBe('/auth/login');
  });

  it('logOut es POST /auth/logout y responde 204 sin body', () => {
    expect(authRoutes.logOut.method).toBe('POST');
    expect(authRoutes.logOut.path).toBe('/auth/logout');
    expect(authRoutes.logOut.successStatus).toBe(204);
  });

  it('me es GET /auth/me', () => {
    expect(authRoutes.me.method).toBe('GET');
    expect(authRoutes.me.path).toBe('/auth/me');
  });
});
