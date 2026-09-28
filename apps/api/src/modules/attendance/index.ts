/**
 * API PÚBLICA del módulo attendance. Otros módulos SOLO pueden importar desde aquí
 * (regla verificada por dependency-cruiser en `pnpm arch:check`).
 */
export { attendanceModule, type AttendanceCradle } from './attendance.module';
