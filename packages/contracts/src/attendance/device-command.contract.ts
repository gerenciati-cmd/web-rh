import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

/**
 * Familia de comandos que acepta la sonda. Es una HIPÓTESIS tomada de la literatura del protocolo
 * PUSH de ZKTeco, no observada en el equipo: la sonda existe para confirmarla. Anclada al final
 * y sin caracteres de control salvo el tab: un salto de línea colaría otro comando (el equipo lee
 * uno por línea), p. ej. `CLEAR DATA`.
 */
export const DEVICE_COMMAND_PATTERN =
  /^(C:\d+:)?DATA (UPDATE|QUERY|DELETE) USERINFO (?:\t|[^\p{Cc}])*$/u;

// ── Modelos de lectura ─────────────────────────────────────────────────────
export const DeviceCommandSchema = z
  .object({
    id: z.uuid(),
    command: z.string().describe('Texto del comando tal como se envió al equipo'),
    status: z.enum(['QUEUED', 'SENT']).describe('QUEUED: en cola; SENT: ya entregado al equipo'),
    queuedAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable().describe('Cuándo se entregó; null si sigue en cola'),
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
        'Comando USERINFO (`DATA UPDATE|QUERY|DELETE USERINFO ...`, con prefijo `C:<n>:` opcional); hasta 500 caracteres',
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
      '**Necesita:** el `deviceId` y un comando que cumpla el patrón USERINFO. Responde con el `id` del comando; el resultado en el equipo no se confirma aquí.',
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
      'Devuelve la bitácora de comandos de un checador, paginada, con su estado (en cola o enviado).',
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
