import { z } from 'zod';

import { PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const PunchSchema = z
  .object({
    id: z.uuid(),
    deviceId: z.uuid(),
    serialNumber: z.string(),
    pin: z.string(),
    occurredAt: z.iso.datetime().describe('Instante UTC de la marcación'),
    deviceLocalTime: z
      .string()
      .describe('Hora local del equipo tal como llegó, YYYY-MM-DD HH:mm:ss'),
    status: z.string(),
    verifyMode: z.string(),
    receivedAt: z.iso.datetime(),
  })
  .meta({ id: 'AttendancePunch' });
export type PunchDto = z.infer<typeof PunchSchema>;

// ── Filtros de consulta ────────────────────────────────────────────────────
export const ListPunchesQuerySchema = PageQuerySchema.extend({
  deviceId: z.uuid().optional(),
  pin: z.string().trim().min(1).max(32).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type ListPunchesQuery = z.output<typeof ListPunchesQuerySchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendancePunchRoutes = {
  listPunches: defineRoute({
    method: 'GET',
    path: '/attendance/punches',
    summary: 'Marcaciones crudas recibidas de los checadores',
    access: requires('attendance.punches:read'),
    query: ListPunchesQuerySchema,
    response: pageOf(PunchSchema),
  }),
};
