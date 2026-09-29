import { z } from 'zod';

import { defineRoute } from '../http';

export const SessionClientSchema = z.enum(['web', 'mobile']);
export type SessionClient = z.infer<typeof SessionClientSchema>;

export const SessionUserSchema = z.object({ id: z.uuid(), email: z.email() });
export type SessionUser = z.infer<typeof SessionUserSchema>;

// Sin regla de fortaleza aquí: el login debe aceptar lo que la persona escriba
// (la política solo se exige al fijar una contraseña).
export const LogInSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
  client: SessionClientSchema,
});
export type LogInInput = z.input<typeof LogInSchema>;

export const LogInResponseSchema = z.object({
  user: SessionUserSchema,
  expiresAt: z.iso.datetime(),
  token: z
    .string()
    .nullable()
    .describe('Solo para client=mobile; en web viaja en una cookie httpOnly'),
});

export const authRoutes = {
  logIn: defineRoute({
    method: 'POST',
    path: '/auth/login',
    summary: 'Inicia sesión con correo y contraseña',
    body: LogInSchema,
    response: LogInResponseSchema,
  }),
  logOut: defineRoute({
    method: 'POST',
    path: '/auth/logout',
    summary: 'Cierra la sesión actual',
    response: z.undefined(),
    successStatus: 204,
  }),
  me: defineRoute({
    method: 'GET',
    path: '/auth/me',
    summary: 'Usuario de la sesión actual',
    response: SessionUserSchema,
  }),
};
