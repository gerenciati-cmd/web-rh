import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import type {
  DeviceContactKind,
  RecordDeviceContact,
} from '../application/commands/record-device-contact.command';
import type { RecordDevicePush } from '../application/commands/record-device-push.command';

import { admsOptionsResponse, parseAdmsBody } from './zkteco-adms.parser';

// El equipo identifica todo request con `SN`; claves extra (`options`, `pushver`, `INFO`, `Stamp`…)
// se conservan para el log.
const AdmsQuerySchema = z.looseObject({
  SN: z.string().min(1).max(64),
  table: z.string().max(32).optional(),
});

/**
 * Adaptador HTTP delgado del protocolo ZKTeco ADMS (push). Es `text/plain` y responde texto,
 * por eso vive fuera de los contratos y de `bindRoute` (ADR 0008). Cero lógica de negocio aquí:
 * autorización y registro los hacen los casos de uso.
 */
export function createZktecoAdmsRouter(deps: {
  recordDeviceContact: RecordDeviceContact;
  recordDevicePush: RecordDevicePush;
}): Router {
  const router = Router();

  // Solo bajo /iclock: el equipo manda cualquier Content-Type y no debe afectar a /api/v1.
  router.use('/iclock', express.text({ type: () => true, limit: '5mb' }));

  const contact =
    (kind: DeviceContactKind, onOk: (serialNumber: string) => string) =>
    async (req: Request, res: Response) => {
      const query = parseQuery(req, res);
      if (!query) return;
      const body = bodyText(req);
      const result = await deps.recordDeviceContact.execute({
        serialNumber: query.SN,
        kind,
        method: req.method,
        path: req.path,
        query: stringValues(query),
        bodyLength: body.length,
      });
      if (!result.ok) {
        sendNotAllowed(res);
        return;
      }
      sendText(res, onOk(query.SN));
    };

  router.get('/iclock/cdata', contact('handshake', admsOptionsResponse));

  router.post('/iclock/cdata', async (req, res) => {
    const query = parseQuery(req, res);
    if (!query) return;
    const table = query.table ?? '';
    const body = bodyText(req);
    const result = await deps.recordDevicePush.execute({
      serialNumber: query.SN,
      table,
      // Getter: el caso de uso lo lee después de autorizar, así no se parsea el body de un
      // equipo no autorizado (hasta 5 MB).
      get records() {
        return parseAdmsBody(table, body);
      },
    });
    if (!result.ok) {
      sendNotAllowed(res);
      return;
    }
    sendText(res, `OK: ${result.value.accepted}`);
  });

  router.get(
    '/iclock/getrequest',
    contact('poll', () => 'OK'),
  );
  router.post(
    '/iclock/devicecmd',
    contact('command-result', () => 'OK'),
  );
  // Último: registra rutas que el firmware use y aún no conocemos (p. ej. `registry`).
  router.all(
    '/iclock/*splat',
    contact('unknown', () => 'OK'),
  );

  return router;
}

function parseQuery(req: Request, res: Response): z.output<typeof AdmsQuerySchema> | null {
  const parsed = AdmsQuerySchema.safeParse(req.query);
  if (parsed.success) return parsed.data;
  res.status(400).type('text/plain').send('ERROR: SN requerido');
  return null;
}

function bodyText(req: Request): string {
  const body: unknown = req.body;
  return typeof body === 'string' ? body : '';
}

/** El log solo recibe valores de texto: arrays u objetos anidados de la query se descartan. */
function stringValues(query: Readonly<Record<string, unknown>>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

function sendText(res: Response, text: string): void {
  res.status(200).type('text/plain').send(text);
}

function sendNotAllowed(res: Response): void {
  res.status(403).type('text/plain').send('ERROR: dispositivo no autorizado');
}
