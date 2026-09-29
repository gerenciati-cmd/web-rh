import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer } from './test-app';

/**
 * NOTA para revisión: este archivo nació como un script de verificación puntual (de ahí el
 * nombre) para confirmar en ejecución real qué responde `/auth/login` con un correo mal
 * formado, antes de escribir la aserción correspondiente. El hook `guard-bash` bloquea borrar
 * un archivo untracked (HARNESS.md: "Untracked no significa desechable"), así que en vez de
 * quedar como descarte se dejó como el test permanente de esa rama (GAP real, ver abajo).
 */
describe('POST /auth/login — correo mal formado', () => {
  it.fails(
    'GAP: plan 001, criterio de aceptación — "malformed email ... → 401 INVALID_CREDENTIALS" no ocurre: ' +
      'LogInSchema valida `email` con z.email() (packages/contracts/src/identity/auth.contract.ts:14), ' +
      'más estricto que el regex de Email.create (packages/domain/src/email.ts:4), así que un correo mal ' +
      'formado nunca llega al comando LogIn (log-in.command.ts:68-72): bindRoute lo rechaza antes con ' +
      '400 VALIDATION_ERROR, no con 401 INVALID_CREDENTIALS',
    async () => {
      const container = buildTestContainer();
      const app = createApp(container);

      const response = await request(app).post(`${API_PREFIX}/auth/login`).send({
        email: 'no-es-un-email',
        password: 'contraseña-larga-y-valida',
        client: 'web',
      });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Correo o contraseña incorrectos',
      });
    },
  );
});
