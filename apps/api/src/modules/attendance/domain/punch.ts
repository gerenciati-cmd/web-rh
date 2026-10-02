import {
  Entity,
  err,
  InvalidValueError,
  localDateTimeToUtc,
  ok,
  type Id,
  type Result,
} from '@rrhh/domain';

import type { DeviceId } from './device';

export type PunchId = Id<'Punch'>;

export interface PunchProps {
  deviceId: DeviceId;
  pin: string;
  /** Hora de pared del equipo tal como llegó (`YYYY-MM-DD HH:mm:ss`, sin offset). */
  deviceLocalTime: string;
  /** Instante UTC resultante de interpretar `deviceLocalTime` en la zona del equipo. */
  occurredAt: Date;
  status: string;
  verifyMode: string;
  receivedAt: Date;
}

const MAX_PIN_LENGTH = 32;
const MAX_CODE_LENGTH = 16;

/** Una marcación cruda ya almacenada. Inmutable: no tiene estado que cambiar ni eventos. */
export class Punch extends Entity<PunchId> {
  private constructor(
    id: PunchId,
    private readonly props: PunchProps,
  ) {
    super(id);
  }

  /** Construye la marcación a partir de un registro ATTLOG y la zona horaria del equipo. */
  static fromDevice(input: {
    id: PunchId;
    deviceId: DeviceId;
    timeZone: string;
    pin: string;
    deviceTime: string;
    status: string;
    verifyMode: string;
    receivedAt: Date;
  }): Result<Punch, InvalidValueError> {
    if (input.pin.length < 1 || input.pin.length > MAX_PIN_LENGTH || /\s/.test(input.pin)) {
      return err(new InvalidValueError('PIN de marcación inválido'));
    }
    if (input.status.length > MAX_CODE_LENGTH || input.verifyMode.length > MAX_CODE_LENGTH) {
      return err(new InvalidValueError('Marcación con campos demasiado largos'));
    }
    const occurredAt = localDateTimeToUtc(input.deviceTime, input.timeZone);
    if (!occurredAt.ok) return occurredAt;

    return ok(
      new Punch(input.id, {
        deviceId: input.deviceId,
        pin: input.pin,
        deviceLocalTime: input.deviceTime,
        occurredAt: occurredAt.value,
        status: input.status,
        verifyMode: input.verifyMode,
        receivedAt: input.receivedAt,
      }),
    );
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse. */
  static restore(id: PunchId, props: PunchProps): Punch {
    return new Punch(id, props);
  }

  get deviceId(): DeviceId {
    return this.props.deviceId;
  }

  get pin(): string {
    return this.props.pin;
  }

  get deviceLocalTime(): string {
    return this.props.deviceLocalTime;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get status(): string {
    return this.props.status;
  }

  get verifyMode(): string {
    return this.props.verifyMode;
  }

  get receivedAt(): Date {
    return this.props.receivedAt;
  }
}
