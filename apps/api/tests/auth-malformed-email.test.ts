import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { API_PREFIX } from '@/http/app';

import { buildTestApp } from './test-app';

/**
 * Un correo mal formado lo rechaza el contrato (400) antes de llegar a `LogIn`. No filtra si la
 * cuenta existe: solo valida la forma. Decisión del usuario al revisar el plan 001.
 */
describe('POST /auth/login — correo mal formado', () => {
  it('responde 400 VALIDATION_ERROR sin llegar a verificar credenciales', async () => {
    const response = await request(buildTestApp()).post(`${API_PREFIX}/auth/login`).send({
      email: 'no-es-un-email',
      password: 'contraseña-larga-y-valida',
      client: 'web',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
