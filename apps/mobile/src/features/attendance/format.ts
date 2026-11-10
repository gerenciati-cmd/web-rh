import type { WorkdayDto } from '@rrhh/contracts';

/** Minutos a texto corto: `0 min`, `45 min`, `8 h`, `8 h 05`. */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/**
 * Hora `HH:mm` (24 h) de un instante en la zona de la sede. Nunca la zona del teléfono: el
 * checador y las reglas de jornada trabajan en la zona de la sede.
 */
export function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** `YYYY-MM-DD` a `Lun 10 nov`, tratada como fecha de calendario (sin corrimiento de zona). */
export function formatLocalDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const instant = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const parts = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = part('weekday').replace('.', '');
  const monthName = part('month').replace('.', '');
  const text = `${weekday} ${part('day')} ${monthName}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** `2026-11` a `Noviembre 2026`. */
export function formatMonthTitle(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1] ?? ''} ${year ?? ''}`.trim();
}

export interface WorkdayStatusView {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'sand';
  detail: string | null;
}

/** Cómo se muestra el estado de una jornada guardada. */
export function workdayStatusView(w: WorkdayDto): WorkdayStatusView {
  switch (w.status) {
    case 'ATTENDED':
      return w.lateMinutes > 0
        ? { label: `Retardo ${w.lateMinutes} min`, tone: 'warning', detail: null }
        : { label: 'Asistencia', tone: 'success', detail: null };
    case 'ABSENT_NO_PUNCHES':
      return { label: 'Falta', tone: 'danger', detail: 'Sin marcaciones' };
    case 'ABSENT_SINGLE_PUNCH':
      return { label: 'Falta', tone: 'danger', detail: 'Una sola marcación' };
    case 'REST_WORKED':
      return { label: 'Descanso trabajado', tone: 'sand', detail: null };
  }
}

export interface MonthSummary {
  attended: number;
  late: number;
  absences: number;
  overtimeMinutes: number;
  restWorked: number;
}

/** Totales del mes; `attended` incluye los retardos. */
export function monthSummary(items: WorkdayDto[]): MonthSummary {
  const summary: MonthSummary = {
    attended: 0,
    late: 0,
    absences: 0,
    overtimeMinutes: 0,
    restWorked: 0,
  };
  for (const w of items) {
    summary.overtimeMinutes += w.overtimeMinutes;
    switch (w.status) {
      case 'ATTENDED':
        summary.attended += 1;
        if (w.lateMinutes > 0) summary.late += 1;
        break;
      case 'ABSENT_NO_PUNCHES':
      case 'ABSENT_SINGLE_PUNCH':
        summary.absences += 1;
        break;
      case 'REST_WORKED':
        summary.restWorked += 1;
        break;
    }
  }
  return summary;
}

/** `2026-01` a `2025-12`. */
export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const y = year ?? 1970;
  const mm = m ?? 1;
  return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`;
}
