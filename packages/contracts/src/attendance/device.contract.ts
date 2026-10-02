import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const DeviceSchema = z
  .object({
    id: z.uuid(),
    serialNumber: z.string(),
    name: z.string(),
    timeZone: z.string(),
    active: z.boolean(),
    registeredAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
    lastPunchAt: z.iso.datetime().nullable(),
    siteId: z.uuid().nullable(),
    clockOffsetSeconds: z
      .number()
      .int()
      .nullable()
      .describe('Hora recibida − hora de la marcación, medida en el último envío en tiempo real'),
    clockOffsetMeasuredAt: z.iso.datetime().nullable(),
    clockSuspect: z.boolean(),
  })
  .meta({ id: 'AttendanceDevice' });
export type DeviceDto = z.infer<typeof DeviceSchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const RegisterDeviceSchema = z
  .object({
    serialNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,64}$/),
    name: z.string().trim().min(1).max(100),
    // La zona horaria del equipo se toma de su sede.
    siteId: z.uuid(),
  })
  .meta({ id: 'RegisterAttendanceDeviceInput' });
export type RegisterDeviceInput = z.input<typeof RegisterDeviceSchema>;

export const AssignDeviceSiteSchema = z
  .object({ siteId: z.uuid() })
  .meta({ id: 'AssignAttendanceDeviceSiteInput' });
export type AssignDeviceSiteInput = z.input<typeof AssignDeviceSiteSchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceDeviceRoutes = {
  listDevices: defineRoute({
    method: 'GET',
    path: '/attendance/devices',
    summary: 'Checadores registrados y su último contacto',
    access: requires('attendance.devices:read'),
    query: PageQuerySchema,
    response: pageOf(DeviceSchema),
  }),
  registerDevice: defineRoute({
    method: 'POST',
    path: '/attendance/devices',
    summary: 'Registra un checador autorizado',
    access: requires('attendance.devices:manage'),
    body: RegisterDeviceSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  assignDeviceSite: defineRoute({
    method: 'PUT',
    path: '/attendance/devices/:deviceId/site',
    summary: 'Asigna la sede de un checador (y su zona horaria)',
    access: requires('attendance.devices:manage'),
    params: z.object({ deviceId: z.uuid() }),
    body: AssignDeviceSiteSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
