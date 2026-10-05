import { z } from 'zod';

import { PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const PunchSchema = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid().describe('Checador que recibió la marcación'),
    serialNumber: z.string().describe('Número de serie del checador'),
    pin: z.string().describe('PIN con el que el colaborador se identificó en el equipo'),
    employee: z
      .object({ id: z.uuid(), fullName: z.string(), companyId: z.uuid() })
      .nullable()
      .describe('Colaborador cuyo RFC coincide con el PIN; null si ninguno'),
    occurredAt: z.iso.datetime().describe('Instante UTC de la marcación'),
    deviceLocalTime: z
      .string()
      .describe('Hora local del equipo tal como llegó, YYYY-MM-DD HH:mm:ss'),
    status: z.string().describe('Código de estado de la marcación según el equipo'),
    verifyMode: z.string().describe('Código del método de verificación (huella, rostro, etc.)'),
    receivedAt: z.iso.datetime().describe('Cuándo la recibió el servidor'),
  })
  .meta({ id: 'AttendancePunch' });
export type PunchDto = z.infer<typeof PunchSchema>;

// ── Filtros de consulta ────────────────────────────────────────────────────
export const ListPunchesQuerySchema = PageQuerySchema.extend({
  deviceId: z
    .uuid()
    .optional()
    .describe('Opcional. Solo marcaciones de este checador; si se omite, de todos'),
  pin: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('Opcional. Solo marcaciones con este PIN; si se omite, de todos'),
  from: z.iso
    .datetime()
    .optional()
    .describe('Opcional. Instante UTC inicial (ISO 8601); si se omite, sin límite inferior'),
  to: z.iso
    .datetime()
    .optional()
    .describe('Opcional. Instante UTC final (ISO 8601); si se omite, sin límite superior'),
});
export type ListPunchesQuery = z.output<typeof ListPunchesQuerySchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendancePunchRoutes = {
  listPunches: defineRoute({
    method: 'GET',
    path: '/attendance/punches',
    summary: 'Marcaciones crudas recibidas de los checadores',
    description: [
      'Devuelve las marcaciones tal como las enviaron los checadores, paginadas y con filtros opcionales por checador, PIN y rango de fechas. Cada una se atribuye a un colaborador cuando su RFC coincide con el PIN.',
      '',
      '**Quién puede:** administrador del holding (todas) y RH (solo las de colaboradores de sus empresas).',
      '',
      '**Necesita:** nada obligatorio. No modifica datos.',
    ].join('\n'),
    access: requires('attendance.punches:read'),
    query: ListPunchesQuerySchema,
    response: pageOf(PunchSchema),
  }),
};
