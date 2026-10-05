import {
  AggregateRoot,
  createEvent,
  err,
  InvalidValueError,
  isValidTimeZone,
  ok,
  type Id,
  type Result,
} from '@rrhh/domain';

export type DeviceId = Id<'Device'>;

export interface DeviceProps {
  serialNumber: string;
  name: string;
  timeZone: string;
  active: boolean;
  registeredAt: Date;
  lastSeenAt: Date | null;
  siteId: string | null;
  clockOffsetSeconds: number | null;
  clockOffsetMeasuredAt: Date | null;
}

export const DEVICE_REGISTERED = 'attendance.device.registered';

/**
 * Desfase máximo tolerado entre la hora recibida y la hora de la marcación antes de considerar
 * sospechoso el reloj (o la zona) del equipo. Decisión 9 del README de `organization-sedes`.
 */
export const CLOCK_OFFSET_TOLERANCE_SECONDS = 300;

/**
 * El equipo consulta al servidor cada ~10 s; `lastSeenAt` solo se reescribe cuando pasó este
 * intervalo, para no convertir cada consulta en una escritura a la BD.
 */
export const DEVICE_SEEN_RESOLUTION_MS = 60_000;

const SERIAL_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * Agregado Device: un checador autorizado a empujar marcaciones. No pertenece a una empresa
 * (los equipos se comparten entre empresas del holding); su zona horaria interpreta la hora local
 * con la que el equipo sella cada marcación.
 */
export class Device extends AggregateRoot<DeviceId> {
  private constructor(
    id: DeviceId,
    private props: DeviceProps,
  ) {
    super(id);
  }

  /** Alta de un equipo nuevo: valida y registra el evento de dominio. */
  static register(input: {
    id: DeviceId;
    serialNumber: string;
    name: string;
    siteId: string;
    /** Zona horaria de la sede; el llamador la obtiene de organization. */
    timeZone: string;
    now: Date;
  }): Result<Device, InvalidValueError> {
    const serialNumber = input.serialNumber.trim();
    const name = input.name.trim();
    const timeZone = input.timeZone.trim();

    if (!SERIAL_PATTERN.test(serialNumber)) {
      return err(new InvalidValueError('Número de serie inválido'));
    }
    if (name.length < 1) return err(new InvalidValueError('El nombre del equipo es obligatorio'));
    if (name.length > 100) {
      return err(new InvalidValueError('El nombre del equipo es demasiado largo'));
    }
    if (!isValidTimeZone(timeZone)) return err(new InvalidValueError('Zona horaria inválida'));

    const device = new Device(input.id, {
      serialNumber,
      name,
      timeZone,
      active: true,
      registeredAt: input.now,
      lastSeenAt: null,
      siteId: input.siteId,
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
    });
    device.record(createEvent(DEVICE_REGISTERED, { deviceId: input.id, serialNumber }, input.now));
    return ok(device);
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse; no emite eventos. */
  static restore(id: DeviceId, props: DeviceProps): Device {
    return new Device(id, props);
  }

  get serialNumber(): string {
    return this.props.serialNumber;
  }

  get name(): string {
    return this.props.name;
  }

  get timeZone(): string {
    return this.props.timeZone;
  }

  get active(): boolean {
    return this.props.active;
  }

  get registeredAt(): Date {
    return this.props.registeredAt;
  }

  get lastSeenAt(): Date | null {
    return this.props.lastSeenAt;
  }

  get siteId(): string | null {
    return this.props.siteId;
  }

  get clockOffsetSeconds(): number | null {
    return this.props.clockOffsetSeconds;
  }

  get clockOffsetMeasuredAt(): Date | null {
    return this.props.clockOffsetMeasuredAt;
  }

  /** El reloj (o la zona) del equipo se desvía más de la tolerancia en la última medición. */
  get clockSuspect(): boolean {
    const { clockOffsetSeconds } = this.props;
    return (
      clockOffsetSeconds !== null && Math.abs(clockOffsetSeconds) > CLOCK_OFFSET_TOLERANCE_SECONDS
    );
  }

  /** Asigna la sede; la zona horaria del equipo se copia de ella (el llamador la provee). */
  assignSite(siteId: string, timeZone: string): void {
    this.props = { ...this.props, siteId, timeZone };
  }

  /** Guarda la última medición de desfase (hora recibida − hora de la marcación, en segundos). */
  recordClockOffset(seconds: number, now: Date): void {
    this.props = { ...this.props, clockOffsetSeconds: seconds, clockOffsetMeasuredAt: now };
  }

  /**
   * Anota el contacto del equipo. Devuelve `true` si hay algo que persistir (primera vez o ya
   * pasó `DEVICE_SEEN_RESOLUTION_MS`); si no, no cambia nada.
   */
  markSeen(now: Date): boolean {
    const { lastSeenAt } = this.props;
    if (lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() < DEVICE_SEEN_RESOLUTION_MS) {
      return false;
    }
    this.props = { ...this.props, lastSeenAt: now };
    return true;
  }
}
