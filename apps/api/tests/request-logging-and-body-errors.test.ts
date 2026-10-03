import { asValue } from 'awilix';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, signInAs } from './test-app';

/**
 * Plan platform-observabilidad/001: nivel de log del sondeo de los checadores (`app.ts`
 * `customLogLevel` + `quietRequestPaths` de attendance), errores del parser de cuerpo
 * (`error-handler.ts`) y mensajes de validación en español (`bind-route.ts`).
 */

interface LogLine {
  level: number;
  msg?: string;
  req?: { url?: string };
}

/** Contenedor de test con un pino real (nivel debug) que escribe las líneas a un arreglo. */
function setUp() {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: 'debug' },
    {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  );
  const container = buildTestContainer();
  container.register({ logger: asValue(logger) });
  return { app: createApp(container), container, lines };
}

const DEBUG = 20;
const INFO = 30;
const WARN = 40;
const completed = (lines: LogLine[]) => lines.filter((line) => line.msg === 'request completed');

describe('nivel de log por ruta (sondeo de checadores)', () => {
  it('un sondeo exitoso (query incluida) va a debug, no a info', async () => {
    const { app, container, lines } = setUp();
    const { Device } = await import('@/modules/attendance/domain/device');
    const { FixedClock, SequentialIdGenerator } = await import('@/shared/testing/fakes');
    const device = Device.register({
      id: new SequentialIdGenerator().next() as never,
      serialNumber: 'SNPOLL001',
      name: 'Equipo de prueba',
      siteId: '00000000-0000-4000-8000-0000000000a1',
      timeZone: 'America/Cancun',
      now: new FixedClock().now(),
    });
    if (!device.ok) throw device.error;
    await container.cradle.deviceRepository.save(device.value);

    const response = await request(app).get('/iclock/getrequest?SN=SNPOLL001&INFO=x');

    expect(response.status).toBe(200);
    const poll = completed(lines).filter((line) => line.req?.url?.startsWith('/iclock/getrequest'));
    expect(poll).toHaveLength(1);
    expect(poll[0]?.level).toBe(DEBUG);
  });

  it('otras rutas exitosas siguen en info (GET /api/v1/sites)', async () => {
    const { app, container, lines } = setUp();
    const token = await signInAs(container, { role: 'HOLDING_ADMIN' });

    const response = await request(app)
      .get(`${API_PREFIX}/sites`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const listed = completed(lines).filter((line) => line.req?.url === `${API_PREFIX}/sites`);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.level).toBe(INFO);
  });

  it('un sondeo que falla (serie desconocida, 403) se registra en warn', async () => {
    const { app, lines } = setUp();

    const response = await request(app).get('/iclock/getrequest?SN=NOEXISTE');

    expect(response.status).toBe(403);
    const poll = completed(lines).filter((line) => line.req?.url?.startsWith('/iclock/getrequest'));
    expect(poll[0]?.level).toBe(WARN);
  });
});

describe('errores de cuerpo', () => {
  it('JSON malformado en POST /sites es 400 MALFORMED_JSON y no se loguea como inesperado', async () => {
    const { app, lines } = setUp();

    const response = await request(app)
      .post(`${API_PREFIX}/sites`)
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: 'MALFORMED_JSON',
      message: 'El cuerpo de la petición no es JSON válido',
    });
    expect(lines.some((line) => line.msg === 'unhandled error')).toBe(false);
  });

  it('un cuerpo de más de 1 MB es 413 PAYLOAD_TOO_LARGE y no se loguea como inesperado', async () => {
    const { app, lines } = setUp();
    const body = JSON.stringify({ name: 'a'.repeat(1024 * 1024 + 1) });

    const response = await request(app)
      .post(`${API_PREFIX}/sites`)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El cuerpo de la petición supera 1 MB',
    });
    expect(lines.some((line) => line.msg === 'unhandled error')).toBe(false);
  });
});

describe('mensajes de validación en español', () => {
  it('el mensaje propio de timeZone (contrato) no cambia con el locale', async () => {
    const { app, container } = setUp();
    const token = await signInAs(container, { role: 'HOLDING_ADMIN' });

    const response = await request(app)
      .post(`${API_PREFIX}/sites`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cancún Centro', country: 'MX', timeZone: 'America/Bogota' });

    expect(response.status).toBe(400);
    expect(response.body.details.issues).toContainEqual(
      expect.objectContaining({
        path: ['timeZone'],
        message: 'Zona horaria no permitida para el país de la sede',
      }),
    );
  });

  it('name de una letra en POST /sites: el mensaje integrado de Zod sale en español', async () => {
    const { app, container } = setUp();
    const token = await signInAs(container, { role: 'HOLDING_ADMIN' });

    const response = await request(app)
      .post(`${API_PREFIX}/sites`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', country: 'MX', timeZone: 'America/Bogota' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    const issues = response.body.details.issues as { path: string[]; message: string }[];
    const nameIssue = issues.find((issue) => issue.path[0] === 'name');
    expect(nameIssue?.message).toMatch(/caracteres/);
    expect(nameIssue?.message).not.toMatch(/Too small/);
  });
});
