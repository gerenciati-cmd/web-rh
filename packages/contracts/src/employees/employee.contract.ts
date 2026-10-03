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
    rfc: z.string().nullable().describe('RFC de persona física; null si aún no se captura'),
    siteId: z.uuid().nullable().describe('Sede asignada; null si no tiene'),
    email: z.email(),
    positionTitle: z.string().nullable().describe('Puesto; null si no se indicó'),
    hireDate: z.iso.date().describe('Fecha de contratación (YYYY-MM-DD)'),
    status: EmployeeStatusSchema,
  })
  .meta({ id: 'EmployeeListItem' });
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;

// ── Entradas ───────────────────────────────────────────────────────────────
export const RegisterEmployeeSchema = z
  .object({
    nationalId: z
      .object({
        country: CountrySchema.describe('País que emitió el documento'),
        number: z.string().trim().min(1).describe('Número del documento (CURP en México)'),
      })
      .describe('Documento de identidad; se valida según el país'),
    firstName: z.string().trim().min(1).max(100).describe('Nombre(s)'),
    lastName: z.string().trim().min(1).max(100).describe('Apellido(s)'),
    email: z.email().describe('Correo de contacto del colaborador'),
    positionTitle: z
      .string()
      .trim()
      .min(1)
      .max(150)
      .optional()
      .describe('Opcional. Puesto; si se omite queda sin puesto'),
    hireDate: z.iso.date().describe('Fecha de contratación (YYYY-MM-DD)'),
    rfc: z
      .string()
      .trim()
      .optional()
      .describe(
        'Opcional. RFC de persona física: obligatorio si el documento es de México y prohibido en otros países',
      ),
    siteId: z.uuid().describe('Sede donde trabaja; debe estar activa y ser del país de la empresa'),
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
      .refine((rfc) => PersonalRfc.isValid(rfc), 'RFC de persona física inválido')
      .describe('RFC de persona física (13 caracteres)'),
  })
  .meta({ id: 'AssignEmployeeRfcInput' });
export type AssignEmployeeRfcInput = z.input<typeof AssignEmployeeRfcSchema>;

export const AssignEmployeeSiteSchema = z
  .object({
    siteId: z.uuid().describe('Sede nueva; debe estar activa y ser del país de la empresa'),
  })
  .meta({ id: 'AssignEmployeeSiteInput' });
export type AssignEmployeeSiteInput = z.input<typeof AssignEmployeeSiteSchema>;

export const ListEmployeesQuerySchema = PageQuerySchema.extend({
  status: EmployeeStatusSchema.optional().describe(
    'Opcional. Filtra por estado; si se omite trae todos',
  ),
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Opcional. Texto a buscar en nombre, apellido, correo o documento de identidad; si se omite no filtra',
    ),
});

const CompanyScopedParams = z.object({ companyId: z.uuid().describe('Id de la empresa') });
const EmployeeParams = z.object({
  companyId: z.uuid().describe('Id de la empresa del colaborador'),
  employeeId: z.uuid().describe('Id del colaborador'),
});

// ── Rutas ──────────────────────────────────────────────────────────────────
export const employeeRoutes = {
  listEmployees: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/employees',
    summary: 'Directorio de colaboradores de una empresa',
    description: [
      'Devuelve el directorio de colaboradores de una empresa, paginado, con filtro opcional por estado y búsqueda por texto.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `companyId` en la ruta. No modifica datos.',
    ].join('\n'),
    access: requires('employees:read', { companyParam: 'companyId' }),
    params: CompanyScopedParams,
    query: ListEmployeesQuerySchema,
    response: pageOf(EmployeeListItemSchema),
  }),
  registerEmployee: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees',
    summary: 'Registra (contrata) un colaborador',
    description: [
      'Registra a un colaborador en una empresa. Queda activo y con la sede indicada.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** documento de identidad válido, nombre, correo, fecha de contratación y sede activa del mismo país que la empresa. El RFC es obligatorio para México y no aplica en otros países. Responde con el `id` del colaborador.',
    ].join('\n'),
    errors: [
      'COMPANY_NOT_FOUND',
      'SITE_NOT_FOUND',
      'EMPLOYEE_ALREADY_EXISTS',
      'EMPLOYEE_RFC_ALREADY_REGISTERED',
      'COMPANY_INACTIVE',
      'SITE_INACTIVE',
      'SITE_COUNTRY_MISMATCH',
      'BUSINESS_RULE_VIOLATION',
    ],
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
    description: [
      'Fija el RFC de un colaborador mexicano, o lo corrige si ya tenía uno. Reemplaza el valor anterior.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** un RFC de persona física válido que ningún otro colaborador tenga.',
    ].join('\n'),
    errors: ['EMPLOYEE_NOT_FOUND', 'EMPLOYEE_RFC_ALREADY_REGISTERED', 'RFC_NOT_APPLICABLE'],
    access: requires('employees:update', { companyParam: 'companyId' }),
    params: EmployeeParams,
    body: AssignEmployeeRfcSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  assignEmployeeSite: defineRoute({
    method: 'PUT',
    path: '/companies/:companyId/employees/:employeeId/site',
    summary: 'Asigna o cambia la sede de un colaborador',
    description: [
      'Asigna la sede de un colaborador o la cambia por otra. Reemplaza la sede anterior.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `siteId` de una sede activa del mismo país que la empresa del colaborador.',
    ].join('\n'),
    errors: [
      'EMPLOYEE_NOT_FOUND',
      'SITE_NOT_FOUND',
      'COMPANY_NOT_FOUND',
      'SITE_INACTIVE',
      'SITE_COUNTRY_MISMATCH',
    ],
    access: requires('employees:update', { companyParam: 'companyId' }),
    params: EmployeeParams,
    body: AssignEmployeeSiteSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
