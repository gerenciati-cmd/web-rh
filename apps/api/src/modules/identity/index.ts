/** API PÚBLICA del módulo identity. */
export { identityModule, type IdentityCradle } from './identity.module';
export { ROLE_ASSIGNED, ROLE_REVOKED } from './domain/role-assignment';
export { SESSION_REVOKED, SESSION_STARTED } from './domain/session';
export { INVITATION_ACCEPTED, INVITATION_ISSUED } from './domain/invitation';
export { USER_DISABLED, USER_REGISTERED } from './domain/user';
