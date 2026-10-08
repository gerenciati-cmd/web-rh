import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

/**
 * Familia de comandos USERINFO. `UPDATE` y `QUERY` confirmados en el SenseFace 2A el 2026-10-03;
 * `DELETE` aún no. Sin prefijo `C:<n>:`: lo asigna el API para asociar la respuesta del equipo.
 * Anclada al final y sin caracteres de control salvo el tab: un salto de línea colaría otro
 * comando (el equipo lee uno por línea), p. ej. `CLEAR DATA`.
 */
export const DEVICE_COMMAND_PATTERN = /^DATA (UPDATE|QUERY|DELETE) USERINFO (?:\t|[^\p{Cc}])*$/u;

// ── Modelos de lectura ─────────────────────────────────────────────────────
export const DeviceCommandSchema = z
  .object({
    id: z.uuid(),
    number: z
      .number()
      .int()
      .positive()
      .describe('Número con el que se envió (C:<n>:); el equipo lo devuelve como ID'),
    command: z.string().describe('Texto del comando, sin el prefijo C:<n>:'),
    status: z
      .enum(['QUEUED', 'SENT', 'DONE', 'FAILED'])
      .describe(
        'QUEUED: en cola; SENT: entregado; DONE: el equipo respondió Return=0; FAILED: respondió otro código',
      ),
    queuedAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable().describe('Cuándo se entregó; null si sigue en cola'),
    returnCode: z
      .string()
      .nullable()
      .describe('Código Return que respondió el equipo; null si aún no responde'),
    completedAt: z.iso
      .datetime()
      .nullable()
      .describe('Cuándo llegó la respuesta del equipo; null si aún no responde'),
    queuedBy: z.uuid().describe('Usuario que lo encoló'),
  })
  .meta({ id: 'AttendanceDeviceCommand' });
export type DeviceCommandDto = z.infer<typeof DeviceCommandSchema>;

// ── Entradas ───────────────────────────────────────────────────────────────
// Sin trim: los tabuladores del texto son significativos para el equipo.
export const QueueDeviceCommandSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .max(500)
      .regex(DEVICE_COMMAND_PATTERN, 'Solo comandos USERINFO')
      .describe(
        'Comando USERINFO (`DATA UPDATE|QUERY|DELETE USERINFO ...`), sin prefijo `C:<n>:`: lo asigna el API; hasta 500 caracteres',
      ),
  })
  .meta({ id: 'QueueAttendanceDeviceCommandInput' });
export type QueueDeviceCommandInput = z.input<typeof QueueDeviceCommandSchema>;

const DeviceParams = z.object({ deviceId: z.uuid().describe('Id del checador') });

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceDeviceCommandRoutes = {
  queueDeviceCommand: defineRoute({
    method: 'POST',
    path: '/attendance/devices/:deviceId/commands',
    summary: 'Encola un comando USERINFO para el próximo sondeo del checador',
    description: [
      'Deja un comando en cola para que el checador lo recoja en su próximo sondeo. Es una herramienta de diagnóstico del protocolo del equipo.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el `deviceId` y un comando que cumpla el patrón USERINFO, sin prefijo `C:<n>:`. Responde con el `id` del comando; el resultado del equipo se ve en la bitácora.',
    ].join('\n'),
    errors: ['DEVICE_NOT_FOUND', 'DEVICE_NETWORK_UNRESTRICTED'],
    access: requires('attendance.devices:manage'),
    params: DeviceParams,
    body: QueueDeviceCommandSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  listDeviceCommands: defineRoute({
    method: 'GET',
    path: '/attendance/devices/:deviceId/commands',
    summary: 'Bitácora de comandos enviados a un checador',
    description: [
      'Devuelve la bitácora de comandos de un checador, paginada, con su estado (en cola, enviado, o el resultado que respondió el equipo).',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el `deviceId` en la ruta. No modifica datos.',
    ].join('\n'),
    errors: ['DEVICE_NOT_FOUND'],
    access: requires('attendance.devices:manage'),
    params: DeviceParams,
    query: PageQuerySchema,
    response: pageOf(DeviceCommandSchema),
  }),
};
