import { EMPLOYEE_STATUSES, NationalId, PersonalRfc } from '@rrhh/domain';
import { z } from 'zod';

import { CountrySchema, CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

export const EmployeeStatusSchema = z.enum(EMPLOYEE_STATUSES);

// ── Modelos de lectura ─────────────────────────────────────────────────────
export const EmployeeListItemSchema = z
  .object({
    id: z.uuid(),
    fullName: z.string(),
    nationalId: z.string().describe('Formateado para mostrar, p. ej. GOMA850101HQRRRN04'),
    rfc: z.string().nullable(),
    email: z.email(),
    positionTitle: z.string().nullable(),
    hireDate: z.iso.date(),
    status: EmployeeStatusSchema,
  })
  .meta({ id: 'EmployeeListItem' });
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
    rfc: z.string().trim().optional(),
  })
  .refine((input) => NationalId.isValid(input.nationalId.country, input.nationalId.number), {
    path: ['nationalId', 'number'],
    message: 'Documento de identidad inválido',
  })
  // El RFC de persona física solo existe en México: obligatorio allí, prohibido en el resto.
  .superRefine((input, ctx) => {
    if (input.nationalId.country === 'MX') {
      if (input.rfc === undefined || !PersonalRfc.isValid(input.rfc)) {
        ctx.addIssue({
          code: 'custom',
          path: ['rfc'],
          message: 'RFC obligatorio y válido para colaboradores de México',
        });
      }
    } else if (input.rfc !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rfc'],
        message: 'El RFC solo aplica a colaboradores de México',
      });
    }
  })
  .meta({ id: 'RegisterEmployeeInput' });
export type RegisterEmployeeInput = z.input<typeof RegisterEmployeeSchema>;

export const AssignEmployeeRfcSchema = z
  .object({
    rfc: z
      .string()
      .trim()
      .refine((rfc) => PersonalRfc.isValid(rfc), 'RFC de persona física inválido'),
  })
  .meta({ id: 'AssignEmployeeRfcInput' });
export type AssignEmployeeRfcInput = z.input<typeof AssignEmployeeRfcSchema>;

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
    access: requires('employees:read', { companyParam: 'companyId' }),
    params: CompanyScopedParams,
    query: ListEmployeesQuerySchema,
    response: pageOf(EmployeeListItemSchema),
  }),
  registerEmployee: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees',
    summary: 'Registra (contrata) un colaborador',
    access: requires('employees:register', { companyParam: 'companyId' }),
    params: CompanyScopedParams,
    body: RegisterEmployeeSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  assignEmployeeRfc: defineRoute({
    method: 'PUT',
    path: '/companies/:companyId/employees/:employeeId/rfc',
    summary: 'Captura o corrige el RFC de un colaborador',
    access: requires('employees:update', { companyParam: 'companyId' }),
    params: z.object({ companyId: z.uuid(), employeeId: z.uuid() }),
    body: AssignEmployeeRfcSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
