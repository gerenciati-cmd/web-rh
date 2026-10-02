import { isValidTimeZone } from '@rrhh/domain';
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
    // La MISMA regla del dominio (`Device.register`).
    timeZone: z.string().trim().refine(isValidTimeZone, 'Zona horaria inválida'),
  })
  .meta({ id: 'RegisterAttendanceDeviceInput' });
export type RegisterDeviceInput = z.input<typeof RegisterDeviceSchema>;

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
};
