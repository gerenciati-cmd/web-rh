import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/http/app';
import { RecordDeviceContact } from '@/modules/attendance/application/commands/record-device-contact.command';
import { RecordDevicePush } from '@/modules/attendance/application/commands/record-device-push.command';
import { RecordingLogger } from '@/shared/testing/fakes';

import { buildTestContainer } from './test-app';

/**
 * Tests de integración del router de dispositivos ZKTeco ADMS: fuera de /api/v1 y de los
 * contratos (ADR 0008). Verifica el protocolo texto/plano observado en la captura real
 * (plan attendance-sonda-zkteco/001) y la redacción de datos personales en el log.
 *
 * El logger de pino-http (`container.cradle.logger`) necesita `.child(...)`, que
 * `RecordingLogger` no implementa, así que en vez de reemplazar la clave `logger` del cradle se
 * reemplazan los casos de uso del módulo con instancias que reciben el logger de prueba
 * directamente (mismo patrón que `allowedDeviceSerials`, registrado por separado para tests).
 */
describe('ADMS /iclock', () => {
  let app: ReturnType<typeof createApp>;
  let logger: RecordingLogger;

  function setUp(allowedDeviceSerials: readonly string[]) {
    const container = buildTestContainer();
    logger = new RecordingLogger();
    container.register({
      allowedDeviceSerials: asValue(allowedDeviceSerials),
      recordDeviceContact: asValue(new RecordDeviceContact({ logger, allowedDeviceSerials })),
      recordDevicePush: asValue(new RecordDevicePush({ logger, allowedDeviceSerials })),
    });
    return createApp(container);
  }

  beforeEach(() => {
    app = setUp(['TESTSN001']);
  });

  it('responde el bloque de opciones al handshake y registra el contacto', async () => {
    const response = await request(app).get('/iclock/cdata?SN=TESTSN001&options=all');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/plain');
    expect(response.text.split('\n')[0]).toBe('GET OPTION FROM: TESTSN001');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'info', msg: 'zkteco: contacto del dispositivo' }),
    );
  });

  it('acepta dos marcaciones ATTLOG y las registra en el log', async () => {
    const body =
      '1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n' +
      '2\t2026-09-28 08:02:00\t0\t15\t0\t0\t0\t0\t0\t0\t\n';

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=ATTLOG')
      .set('Content-Type', 'text/plain')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.text).toBe('OK: 2');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'zkteco: datos recibidos',
        obj: expect.objectContaining({ total: 2 }),
      }),
    );
    const debugRecords = logger.entries.filter(
      (entry) => entry.level === 'debug' && entry.msg === 'zkteco: registro',
    );
    expect(debugRecords).toHaveLength(2);
    expect(
      debugRecords.map((entry) => (entry.obj as { record: { pin: string } }).record.pin),
    ).toEqual(['1', '2']);
  });

  it('acepta un registro BIODATA y redacta Tmp en el log sin exponer la plantilla', async () => {
    const template = 'x'.repeat(100);
    const line = `BIODATA Pin=1\tNo=6\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=${template}`;

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=BIODATA')
      .set('Content-Type', 'text/plain')
      .send(line);

    expect(response.text).toBe('OK: 1');
    const record = logger.entries.find(
      (entry) => entry.level === 'debug' && entry.msg === 'zkteco: registro',
    );
    expect(record).toBeDefined();
    const fields = (record?.obj as { record: { fields: Record<string, string> } }).record.fields;
    expect(fields.Tmp).toBe(`[redactado:${template.length}]`);
    expect(fields.Pin).toBe('1');
    expect(fields.Type).toBe('1');
    expect(fields.Valid).toBe('1');
    expect(JSON.stringify(fields)).not.toContain(template);
  });

  it('acepta una línea BIOPHOTO y redacta Content y FileName', async () => {
    const content = 'y'.repeat(200);
    const line = `BIOPHOTO PIN=1\tNo=0\tIndex=0\tFileName=1.jpg\tType=9\tSize=200\tContent=${content}`;

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=OPERLOG')
      .set('Content-Type', 'text/plain')
      .send(line);

    expect(response.text).toBe('OK: 1');
    const record = logger.entries.find(
      (entry) => entry.level === 'debug' && entry.msg === 'zkteco: registro',
    );
    const fields = (record?.obj as { record: { fields: Record<string, string> } }).record.fields;
    expect(fields.Content).toBe(`[redactado:${content.length}]`);
    expect(fields.FileName).toBe('[redactado:5]');
    expect(fields.PIN).toBe('1');
    expect(fields.Type).toBe('9');
    expect(fields.Size).toBe('200');
    expect(JSON.stringify(fields)).not.toContain(content);
  });

  it('acepta USER y OPLOG dentro de OPERLOG, redacta Name y Passwd, y clasifica OPLOG como operation', async () => {
    const body =
      'USER PIN=1\tName=Prueba\tPri=0\tPasswd=1234\tCard=\tGrp=1\n' +
      'OPLOG 7\t0\t2026-09-28 10:47:19\t1\t0\t0\t0\n';

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=OPERLOG')
      .set('Content-Type', 'text/plain')
      .send(body);

    expect(response.text).toBe('OK: 2');
    const records = logger.entries
      .filter((entry) => entry.level === 'debug' && entry.msg === 'zkteco: registro')
      .map((entry) => (entry.obj as { record: unknown }).record);

    expect(records[0]).toMatchObject({
      kind: 'entry',
      prefix: 'USER',
      fields: expect.objectContaining({ Name: '[redactado:6]', Passwd: '[redactado:4]' }),
    });
    expect(records[1]).toMatchObject({ kind: 'operation', code: '7' });
  });

  it('interpreta table=options con coma dentro de un valor sin crear claves espurias', async () => {
    const line =
      '~DeviceName=SenseFace 2A,MAC=00:00:00:00:00:01,Vendor=ACME CO., LTD.,FWVersion=X-1';

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=options')
      .set('Content-Type', 'text/plain')
      .send(line);

    expect(response.text).toBe('OK: 1');
    const record = logger.entries.find(
      (entry) => entry.level === 'debug' && entry.msg === 'zkteco: registro',
    );
    const fields = (record?.obj as { record: { fields: Record<string, string> } }).record.fields;
    expect(fields.DeviceName).toBe('SenseFace 2A');
    expect(fields.FWVersion).toBe('X-1');
    expect(Object.keys(fields)).toEqual(['DeviceName', 'MAC', 'Vendor', 'FWVersion']);
  });

  it('responde 403 y registra warn si el SN no está en la lista permitida', async () => {
    const response = await request(app).get('/iclock/cdata?SN=OTRO&options=all');

    expect(response.status).toBe(403);
    expect(response.text).toBe('ERROR: dispositivo no autorizado');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', msg: 'zkteco: dispositivo no autorizado' }),
    );
  });

  it('responde 403 para cualquier SN si la lista permitida está vacía', async () => {
    const emptyAllowlistApp = setUp([]);

    const response = await request(emptyAllowlistApp).get('/iclock/cdata?SN=TESTSN001&options=all');

    expect(response.status).toBe(403);
  });

  it('responde 400 si falta el SN', async () => {
    const response = await request(app).get('/iclock/cdata?options=all');

    expect(response.status).toBe(400);
    expect(response.text).toBe('ERROR: SN requerido');
  });

  it('getrequest y devicecmd responden OK', async () => {
    const poll = await request(app).get('/iclock/getrequest?SN=TESTSN001');
    expect(poll.status).toBe(200);
    expect(poll.text).toBe('OK');

    const cmd = await request(app).post('/iclock/devicecmd?SN=TESTSN001');
    expect(cmd.status).toBe(200);
    expect(cmd.text).toBe('OK');
  });

  it('una ruta desconocida bajo /iclock responde OK y se registra como unknown', async () => {
    const response = await request(app).get('/iclock/registry?SN=TESTSN001');

    expect(response.status).toBe(200);
    expect(response.text).toBe('OK');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'zkteco: contacto del dispositivo',
        obj: expect.objectContaining({ kind: 'unknown' }),
      }),
    );
  });

  // Regresión de la reparación de revisión (deviación 7, hallazgo L2): antes, `express.json`
  // corría antes del router de dispositivos y un `Content-Type: application/json` se comía el
  // body, dejando `bodyText` en `''` (`OK: 0`). Ahora los device routers se montan antes de
  // `express.json` (`app.ts:35-37`), así que el body llega como texto sin importar el
  // Content-Type que el equipo declare.
  it('lee el body como texto aunque el equipo declare Content-Type: application/json', async () => {
    const body =
      '1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n' +
      '2\t2026-09-28 08:02:00\t0\t15\t0\t0\t0\t0\t0\t0\t\n';

    const response = await request(app)
      .post('/iclock/cdata?SN=TESTSN001&table=ATTLOG')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.text).toBe('OK: 2');
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'info',
        msg: 'zkteco: datos recibidos',
        obj: expect.objectContaining({ total: 2 }),
      }),
    );
  });

  it('el resto de /api/v1 y /health sigue funcionando sin cambios', async () => {
    await request(app).get('/health/live').expect(200, { status: 'ok' });
    await request(app)
      .post('/api/v1/companies')
      .send({ legalName: 'APS Holding SpA', taxId: '76.086.428-5', country: 'CL' })
      .expect(201);
  });
});
