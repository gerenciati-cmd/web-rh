import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const DeviceSchema = z
  .object({
    id: z.uuid(),
    serialNumber: z.string().describe('Número de serie del equipo'),
    name: z.string(),
    timeZone: z.string().describe('Zona horaria IANA del equipo, tomada de su sede'),
    active: z.boolean(),
    registeredAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable().describe('Último contacto del equipo; null si nunca'),
    lastPunchAt: z.iso.datetime().nullable().describe('Última marcación recibida; null si ninguna'),
    siteId: z.uuid().nullable().describe('Sede asignada; null si no tiene'),
    clockOffsetSeconds: z
      .number()
      .int()
      .nullable()
      .describe('Hora recibida − hora de la marcación, medida en el último envío en tiempo real'),
    clockOffsetMeasuredAt: z.iso
      .datetime()
      .nullable()
      .describe('Cuándo se midió `clockOffsetSeconds`; null si nunca'),
    clockSuspect: z.boolean().describe('true si el reloj del equipo parece desfasado'),
  })
  .meta({ id: 'AttendanceDevice' });
export type DeviceDto = z.infer<typeof DeviceSchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const RegisterDeviceSchema = z
  .object({
    serialNumber: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,64}$/)
      .describe('Número de serie impreso en el equipo: solo letras y dígitos, hasta 64'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe('Nombre para identificarlo, hasta 100 caracteres'),
    // La zona horaria del equipo se toma de su sede.
    siteId: z
      .uuid()
      .describe('Sede donde se instala; de ella toma su zona horaria. Debe estar activa'),
  })
  .meta({ id: 'RegisterAttendanceDeviceInput' });
export type RegisterDeviceInput = z.input<typeof RegisterDeviceSchema>;

export const AssignDeviceSiteSchema = z
  .object({ siteId: z.uuid().describe('Sede nueva; debe estar activa') })
  .meta({ id: 'AssignAttendanceDeviceSiteInput' });
export type AssignDeviceSiteInput = z.input<typeof AssignDeviceSiteSchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceDeviceRoutes = {
  listDevices: defineRoute({
    method: 'GET',
    path: '/attendance/devices',
    summary: 'Checadores registrados y su último contacto',
    description: [
      'Devuelve los checadores registrados, paginados, con su último contacto y el estado de su reloj.',
      '',
      '**Quién puede:** administrador del holding y RH.',
      '',
      '**Necesita:** opcionalmente `page` y `pageSize`. No modifica datos.',
    ].join('\n'),
    access: requires('attendance.devices:read'),
    query: PageQuerySchema,
    response: pageOf(DeviceSchema),
  }),
  registerDevice: defineRoute({
    method: 'POST',
    path: '/attendance/devices',
    summary: 'Registra un checador autorizado',
    description: [
      'Autoriza un checador para que envíe marcaciones. Un equipo no registrado es rechazado.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el número de serie, un nombre y una sede activa. Responde con el `id` del checador.',
    ].join('\n'),
    errors: ['SITE_NOT_FOUND', 'DEVICE_ALREADY_REGISTERED', 'SITE_INACTIVE'],
    access: requires('attendance.devices:manage'),
    body: RegisterDeviceSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  assignDeviceSite: defineRoute({
    method: 'PUT',
    path: '/attendance/devices/:deviceId/site',
    summary: 'Asigna la sede de un checador (y su zona horaria)',
    description: [
      'Cambia la sede de un checador; el equipo adopta la zona horaria de la nueva sede.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el `deviceId` en la ruta y una sede activa en el cuerpo.',
    ].join('\n'),
    errors: ['DEVICE_NOT_FOUND', 'SITE_NOT_FOUND', 'SITE_INACTIVE'],
    access: requires('attendance.devices:manage'),
    params: z.object({ deviceId: z.uuid().describe('Id del checador') }),
    body: AssignDeviceSiteSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
