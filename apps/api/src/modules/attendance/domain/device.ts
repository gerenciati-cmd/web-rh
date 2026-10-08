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

import {
  formatIpv4Address,
  formatIpv4Network,
  ipv4NetworkContains,
  parseIpv4Address,
  parseIpv4Network,
} from './ipv4-network';

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
  /** Redes IPv4 canónicas (`a.b.c.d/n`); vacía = sin restricción de red y sin comandos. */
  allowedNetworks: readonly string[];
  lastSeenIp: string | null;
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

/** Tope de redes permitidas por equipo (igual que el contrato). */
export const MAX_ALLOWED_NETWORKS = 10;

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
      allowedNetworks: [],
      lastSeenIp: null,
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

  get allowedNetworks(): readonly string[] {
    return this.props.allowedNetworks;
  }

  get lastSeenIp(): string | null {
    return this.props.lastSeenIp;
  }

  /**
   * Solo un equipo con redes permitidas recibe comandos: llevan RFC y nombre, y sin barrera de
   * red los tomaría cualquiera que conozca el número de serie (decisión 16 del README).
   */
  get receivesCommands(): boolean {
    return this.props.allowedNetworks.length > 0;
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

  /** Reemplaza las redes permitidas (IP o CIDR IPv4); se guardan canónicas y sin repetir. */
  setAllowedNetworks(networks: readonly string[]): Result<void, InvalidValueError> {
    const canonical = new Set<string>();
    for (const text of networks) {
      const network = parseIpv4Network(text);
      if (!network) return err(new InvalidValueError(`Red IPv4 inválida: ${text}`));
      canonical.add(formatIpv4Network(network));
    }
    if (canonical.size > MAX_ALLOWED_NETWORKS) {
      return err(new InvalidValueError(`Máximo ${MAX_ALLOWED_NETWORKS} redes por checador`));
    }
    this.props = { ...this.props, allowedNetworks: [...canonical] };
    return ok(undefined);
  }

  /** Sin redes permitidas acepta cualquier origen; si hay, la IP debe caer en alguna. */
  acceptsAddress(ip: string | null): boolean {
    const { allowedNetworks } = this.props;
    if (allowedNetworks.length === 0) return true;
    const address = ip === null ? null : parseIpv4Address(ip);
    if (address === null) return false;
    return allowedNetworks.some((text) => {
      const network = parseIpv4Network(text);
      return network !== null && ipv4NetworkContains(network, address);
    });
  }

  /**
   * Anota el contacto del equipo y su IP de origen. Devuelve `true` si hay algo que persistir
   * (primera vez, ya pasó `DEVICE_SEEN_RESOLUTION_MS` o cambió la IP); si no, no cambia nada.
   */
  markSeen(now: Date, rawIp: string | null): boolean {
    const { lastSeenAt, lastSeenIp } = this.props;
    const ip = normalizeSourceIp(rawIp);
    const recent =
      lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() < DEVICE_SEEN_RESOLUTION_MS;
    if (recent && ip === lastSeenIp) return false;
    this.props = { ...this.props, lastSeenAt: now, lastSeenIp: ip };
    return true;
  }
}

const MAX_IP_LENGTH = 45;
const IPV6_CHARS = /^[0-9a-f:.]+$/i;

/**
 * Normaliza la IP de origen antes de guardarla: una IPv4 (o su forma mapeada `::ffff:a.b.c.d`, la
 * que Node reporta en sockets de doble pila) queda como `a.b.c.d`, para que la IP mostrada se pueda
 * pegar tal cual en `PUT …/networks`. Lo demás solo se conserva si parece una IPv6 (la columna es
 * `VarChar(45)` y el valor puede venir de `X-Forwarded-For`); si no, `null`.
 */
function normalizeSourceIp(ip: string | null): string | null {
  if (ip === null) return null;
  const v4 = parseIpv4Address(ip);
  if (v4 !== null) return formatIpv4Address(v4);
  const text = ip.trim();
  return text.length <= MAX_IP_LENGTH && text.includes(':') && IPV6_CHARS.test(text) ? text : null;
}
