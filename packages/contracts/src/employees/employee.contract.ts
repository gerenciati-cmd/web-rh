import { EMPLOYEE_STATUSES, NationalId } from '@rrhh/domain';
import { z } from 'zod';

import { CountrySchema, CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute } from '../http';

export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

// ── Modelos de lectura ─────────────────────────────────────────────────────
export const EmployeeListItemSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  nationalId: z.string().describe('Formateado para mostrar, p. ej. GOMA850101HQRRRN04'),
  email: z.email(),
  positionTitle: z.string().nullable(),
  hireDate: z.iso.date(),
  status: EmployeeStatusSchema,
});
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;

// ── Entradas ───────────────────────────────────────────────────────────────
export const RegisterEmployeeSchema = z
  .object({
    nationalId: z.object({ country: CountrySchema, number: z.string().trim().min(1) }),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.email(),
    positionTitle: z.string().trim().min(1).max(150).optional(),
    hireDate: z.iso.date(),
  })
  .refine((input) => NationalId.isValid(input.nationalId.country, input.nationalId.number), {
    path: ['nationalId', 'number'],
    message: 'Documento de identidad inválido',
  });
export type RegisterEmployeeInput = z.input<typeof RegisterEmployeeSchema>;

export const ListEmployeesQuerySchema = PageQuerySchema.extend({
  status: EmployeeStatusSchema.optional(),
  search: z.string().trim().min(1).optional(),
});

const CompanyScopedParams = z.object({ companyId: z.uuid() });

// ── Rutas ──────────────────────────────────────────────────────────────────
export const employeeRoutes = {
  listEmployees: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/employees',
    summary: 'Directorio de colaboradores de una empresa',
    params: CompanyScopedParams,
    query: ListEmployeesQuerySchema,
    response: pageOf(EmployeeListItemSchema),
  }),
  registerEmployee: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees',
    summary: 'Registra (contrata) un colaborador',
    params: CompanyScopedParams,
    body: RegisterEmployeeSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
};
