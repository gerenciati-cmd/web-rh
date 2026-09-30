import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '@/config/env';
import { API_PREFIX, createApp } from '@/http/app';
import { SESSION_COOKIE } from '@/http/request-context';
import { User } from '@/modules/identity/domain/user';
import { type InMemorySessionRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-session.repository';
import { type InMemoryUserRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-user.repository';

import { buildTestContainer } from './test-app';

const EMAIL = 'ana@aps.cl';
const PASSWORD = 'contraseña-larga-y-valida';

function firstSetCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') throw new Error('se esperaba un Set-Cookie en la respuesta');
  return value;
}

function cookiePair(setCookieHeader: string): string {
  const pair = setCookieHeader.split(';')[0];
  if (!pair) throw new Error('Set-Cookie sin par nombre=valor');
  return pair;
}

/**
 * Tests HTTP de `identity`: contrato → middleware de autenticación → comando → cookies/headers.
 * Persistencia en memoria, como `tests/http.test.ts`. No hay endpoint para crear usuarios
 * (fuera de alcance del plan 001), así que los tests dan de alta al usuario directamente a
 * través del caso de uso `registerUser` del propio contenedor.
 */
describe('identity — HTTP', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    const registered = await container.cradle.registerUser.execute({
      email: EMAIL,
      password: PASSWORD,
    });
    if (!registered.ok) throw registered.error;
  });

  const login = (body: object) => request(app).post(`${API_PREFIX}/auth/login`).send(body);

  describe('POST /auth/login', () => {
    it('client=web: 200 con token null y una cookie de sesión httpOnly/secure/samesite=lax', async () => {
      const response = await login({ email: EMAIL, password: PASSWORD, client: 'web' }).expect(200);

      expect(response.body).toMatchObject({ user: { email: EMAIL }, token: null });
      expect(response.body.user.id).toEqual(expect.any(String));
      expect(response.body.expiresAt).toEqual(expect.any(String));

      const cookie = firstSetCookie(response.headers);
      expect(cookie).toContain(`${SESSION_COOKIE}=`);
      expect(cookie).toContain('Path=/');
      expect(cookie).toMatch(/Expires=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('client=mobile: 200 con token no nulo, sin Set-Cookie, y el hash guardado no es el token en claro', async () => {
      const response = await login({ email: EMAIL, password: PASSWORD, client: 'mobile' }).expect(
        200,
      );

      expect(typeof response.body.token).toBe('string');
      expect(response.body.token.length).toBeGreaterThan(0);
      expect(response.headers['set-cookie']).toBeUndefined();

      const sessionRepository = container.cradle.sessionRepository as InMemorySessionRepository;
      const [session] = [...sessionRepository.sessions.values()];
      expect(session?.snapshot.tokenHash).not.toBe(response.body.token);
      expect(session?.snapshot.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    describe('credenciales inválidas: siempre INVALID_CREDENTIALS con el mismo cuerpo', () => {
      const expectedBody = {
        code: 'INVALID_CREDENTIALS',
        message: 'Correo o contraseña incorrectos',
      };

      it('contraseña incorrecta', async () => {
        const response = await login({
          email: EMAIL,
          password: 'una-contraseña-distinta',
          client: 'web',
        }).expect(401);
        expect(response.body).toEqual(expectedBody);
      });

      it('correo desconocido', async () => {
        const response = await login({
          email: 'no-existe@aps.cl',
          password: PASSWORD,
          client: 'web',
        }).expect(401);
        expect(response.body).toEqual(expectedBody);
      });

      it('usuario DISABLED con la contraseña correcta', async () => {
        const userRepository = container.cradle.userRepository as InMemoryUserRepository;
        const [user] = [...userRepository.users.values()];
        if (!user) throw new Error('fixture: usuario no encontrado');
        // El agregado no expone un setter de estado (por diseño, ver domain/user.ts):
        // se reconstruye la fila con `restore` para simular un usuario deshabilitado.
        userRepository.users.set(
          user.id,
          User.restore(user.id, { ...user.snapshot, status: 'DISABLED' }),
        );

        const response = await login({ email: EMAIL, password: PASSWORD, client: 'web' }).expect(
          401,
        );
        expect(response.body).toEqual(expectedBody);
      });
    });

    it('429 con Retry-After tras 5 intentos fallidos para el mismo correo', async () => {
      for (let i = 0; i < 5; i++) {
        await login({ email: EMAIL, password: 'incorrecta', client: 'web' }).expect(401);
      }

      const response = await login({ email: EMAIL, password: PASSWORD, client: 'web' }).expect(429);

      expect(response.body.code).toBe('LOGIN_TEMPORARILY_BLOCKED');
      expect(response.headers['retry-after']).toBeDefined();
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('GET /auth/me', () => {
    it('con Authorization: Bearer válido responde 200 { id, email }', async () => {
      const loginResponse = await login({
        email: EMAIL,
        password: PASSWORD,
        client: 'mobile',
      }).expect(200);

      const response = await request(app)
        .get(`${API_PREFIX}/auth/me`)
        .set('Authorization', `Bearer ${loginResponse.body.token}`)
        .expect(200);

      expect(response.body).toEqual({
        id: loginResponse.body.user.id,
        email: EMAIL,
        employeeId: null,
      });
    });

    it('con la cookie web responde 200', async () => {
      const loginResponse = await login({ email: EMAIL, password: PASSWORD, client: 'web' }).expect(
        200,
      );
      const cookie = cookiePair(firstSetCookie(loginResponse.headers));

      const response = await request(app)
        .get(`${API_PREFIX}/auth/me`)
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body).toEqual({
        id: loginResponse.body.user.id,
        email: EMAIL,
        employeeId: null,
      });
    });

    it('sin credenciales responde 401 AUTHENTICATION_REQUIRED', async () => {
      const response = await request(app).get(`${API_PREFIX}/auth/me`).expect(401);
      expect(response.body).toEqual({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Debes iniciar sesión',
      });
    });

    it('con un token desconocido responde 401 AUTHENTICATION_REQUIRED', async () => {
      const response = await request(app)
        .get(`${API_PREFIX}/auth/me`)
        .set('Authorization', 'Bearer token-que-nunca-se-emitió')
        .expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('POST /auth/logout', () => {
    it('con una sesión válida (Bearer): 204, y el mismo token luego da 401 en /auth/me', async () => {
      const loginResponse = await login({
        email: EMAIL,
        password: PASSWORD,
        client: 'mobile',
      }).expect(200);
      const token = loginResponse.body.token as string;

      await request(app)
        .post(`${API_PREFIX}/auth/logout`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const sessionRepository = container.cradle.sessionRepository as InMemorySessionRepository;
      const [session] = [...sessionRepository.sessions.values()];
      expect(session?.snapshot.revokedAt).not.toBeNull();

      await request(app)
        .get(`${API_PREFIX}/auth/me`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('sin sesión responde 401', async () => {
      await request(app).post(`${API_PREFIX}/auth/logout`).expect(401);
    });

    it('con la cookie web y un Origin permitido: 204 y limpia la cookie', async () => {
      const allowedOrigin = 'https://app.aps.cl';
      const env = loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        CORS_ORIGINS: allowedOrigin,
      });
      const originContainer = buildTestContainer(env);
      const originApp = createApp(originContainer);
      const registered = await originContainer.cradle.registerUser.execute({
        email: EMAIL,
        password: PASSWORD,
      });
      if (!registered.ok) throw registered.error;

      const loginResponse = await request(originApp)
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: EMAIL, password: PASSWORD, client: 'web' })
        .expect(200);
      const cookie = cookiePair(firstSetCookie(loginResponse.headers));

      const logoutResponse = await request(originApp)
        .post(`${API_PREFIX}/auth/logout`)
        .set('Cookie', cookie)
        .set('Origin', allowedOrigin)
        .expect(204);

      const clearedCookie = firstSetCookie(logoutResponse.headers);
      expect(clearedCookie).toContain(`${SESSION_COOKIE}=;`);
    });

    it('con la cookie web pero sin Origin (o uno no permitido): 401 y la sesión sigue activa', async () => {
      const allowedOrigin = 'https://app.aps.cl';
      const env = loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        CORS_ORIGINS: allowedOrigin,
      });
      const originContainer = buildTestContainer(env);
      const originApp = createApp(originContainer);
      const registered = await originContainer.cradle.registerUser.execute({
        email: EMAIL,
        password: PASSWORD,
      });
      if (!registered.ok) throw registered.error;

      const loginResponse = await request(originApp)
        .post(`${API_PREFIX}/auth/login`)
        .send({ email: EMAIL, password: PASSWORD, client: 'web' })
        .expect(200);
      const cookie = cookiePair(firstSetCookie(loginResponse.headers));

      // Sin Origin.
      await request(originApp).post(`${API_PREFIX}/auth/logout`).set('Cookie', cookie).expect(401);

      // Con un Origin que no está en CORS_ORIGINS.
      await request(originApp)
        .post(`${API_PREFIX}/auth/logout`)
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .expect(401);

      const sessionRepository = originContainer.cradle
        .sessionRepository as InMemorySessionRepository;
      const [session] = [...sessionRepository.sessions.values()];
      expect(session?.snapshot.revokedAt).toBeNull();
    });
  });
});
