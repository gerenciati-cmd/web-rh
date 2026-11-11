import type { LatenessRuleDto } from '@rrhh/contracts';
import { LATENESS_PERIODS, type LatenessPeriod } from '@rrhh/domain';

import type { AttendanceLatenessRule as LatenessRuleRow } from '@/infrastructure/database/generated/client';

import type { LatenessRule } from '../domain/lateness-rule';

function isLatenessPeriod(value: string): value is LatenessPeriod {
  return (LATENESS_PERIODS as readonly string[]).includes(value);
}

/** La columna `period` solo la escribe esta app: otro valor es corrupción y se falla fuerte. */
function parsePeriod(value: string): LatenessPeriod {
  if (!isLatenessPeriod(value))
    throw new Error(`Periodo de regla de retardos desconocido: ${value}`);
  return value;
}

/** Traductor entre filas Prisma y dominio/DTOs de reglas de retardos; ningún tipo de Prisma sale de aquí. */
export const LatenessRuleMapper = {
  toDomain(row: LatenessRuleRow): LatenessRule {
    return {
      companyId: row.companyId,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      threshold: row.threshold,
      period: parsePeriod(row.period),
      setAt: row.setAt,
      setBy: row.setBy,
    };
  },

  toDto(row: LatenessRuleRow): LatenessRuleDto {
    return {
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      threshold: row.threshold,
      period: parsePeriod(row.period),
      setAt: row.setAt.toISOString(),
    };
  },
};
