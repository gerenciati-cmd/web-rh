import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

/**
 * Familia de comandos que acepta la sonda. Es una HIPÓTESIS tomada de la literatura del protocolo
 * PUSH de ZKTeco, no observada en el equipo: la sonda existe para confirmarla.
 */
export const DEVICE_COMMAND_PATTERN = /^(C:\d+:)?DATA (UPDATE|QUERY|DELETE) USERINFO /;

// ── Modelos de lectura ─────────────────────────────────────────────────────
export const DeviceCommandSchema = z
  .object({
    id: z.uuid(),
    command: z.string(),
    status: z.enum(['QUEUED', 'SENT']),
    queuedAt: z.iso.datetime(),
    sentAt: z.iso.datetime().nullable(),
    queuedBy: z.uuid(),
  })
  .meta({ id: 'AttendanceDeviceCommand' });
export type DeviceCommandDto = z.infer<typeof DeviceCommandSchema>;

// ── Entradas ───────────────────────────────────────────────────────────────
// Sin trim: los tabuladores del texto son significativos para el equipo.
export const QueueDeviceCommandSchema = z
  .object({
    command: z.string().min(1).max(500).regex(DEVICE_COMMAND_PATTERN, 'Solo comandos USERINFO'),
  })
  .meta({ id: 'QueueAttendanceDeviceCommandInput' });
export type QueueDeviceCommandInput = z.input<typeof QueueDeviceCommandSchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceDeviceCommandRoutes = {
  queueDeviceCommand: defineRoute({
    method: 'POST',
    path: '/attendance/devices/:deviceId/commands',
    summary: 'Encola un comando USERINFO para el próximo sondeo del checador',
    access: requires('attendance.devices:manage'),
    params: z.object({ deviceId: z.uuid() }),
    body: QueueDeviceCommandSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  listDeviceCommands: defineRoute({
    method: 'GET',
    path: '/attendance/devices/:deviceId/commands',
    summary: 'Bitácora de comandos enviados a un checador',
    access: requires('attendance.devices:manage'),
    params: z.object({ deviceId: z.uuid() }),
    query: PageQuerySchema,
    response: pageOf(DeviceCommandSchema),
  }),
};
