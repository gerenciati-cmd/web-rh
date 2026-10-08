import { Entity, err, InvalidValueError, ok, type Id, type Result } from '@rrhh/domain';

import type { DeviceId } from './device';

export type DeviceCommandId = Id<'DeviceCommand'>;

export type DeviceCommandStatus = 'QUEUED' | 'SENT' | 'DONE' | 'FAILED';

export interface DeviceCommandProps {
  deviceId: DeviceId;
  /** Número `C:<n>:` con el que se entrega; el equipo lo devuelve como `ID` en su respuesta. */
  number: number;
  /** Texto sin el prefijo `C:<n>:`. */
  command: string;
  status: DeviceCommandStatus;
  queuedAt: Date;
  sentAt: Date | null;
  returnCode: string | null;
  completedAt: Date | null;
  queuedBy: string | null;
}

// Duplica `DEVICE_COMMAND_PATTERN` de @rrhh/contracts (el dominio no importa contratos). Sin
// prefijo `C:<n>:` (lo asigna el API) y sin saltos de línea: colarían otro comando en la
// respuesta de getrequest.
const COMMAND_PATTERN = /^DATA (UPDATE|QUERY|DELETE) USERINFO (?:\t|[^\p{Cc}])*$/u;
const MAX_COMMAND_LENGTH = 500;
// Código `Return` del equipo: entero, a veces negativo (observado `0` = éxito).
const RETURN_CODE_PATTERN = /^-?\d{1,15}$/;
const SUCCESS_RETURN_CODE = '0';

/** Comando que se entrega al checador en su próximo sondeo; su respuesta lo cierra. */
export class DeviceCommand extends Entity<DeviceCommandId> {
  private constructor(
    id: DeviceCommandId,
    private props: DeviceCommandProps,
  ) {
    super(id);
  }

  static queue(input: {
    id: DeviceCommandId;
    deviceId: DeviceId;
    number: number;
    command: string;
    queuedBy: string | null;
    now: Date;
  }): Result<DeviceCommand, InvalidValueError> {
    if (!Number.isSafeInteger(input.number) || input.number < 1) {
      return err(new InvalidValueError('Número de comando inválido'));
    }
    if (input.command.length < 1 || input.command.length > MAX_COMMAND_LENGTH) {
      return err(new InvalidValueError('Comando con largo inválido'));
    }
    if (!COMMAND_PATTERN.test(input.command)) {
      return err(new InvalidValueError('Solo se aceptan comandos USERINFO'));
    }
    return ok(
      new DeviceCommand(input.id, {
        deviceId: input.deviceId,
        number: input.number,
        command: input.command,
        status: 'QUEUED',
        queuedAt: input.now,
        sentAt: null,
        returnCode: null,
        completedAt: null,
        queuedBy: input.queuedBy,
      }),
    );
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse. */
  static restore(id: DeviceCommandId, props: DeviceCommandProps): DeviceCommand {
    return new DeviceCommand(id, props);
  }

  get deviceId(): DeviceId {
    return this.props.deviceId;
  }

  get number(): number {
    return this.props.number;
  }

  get command(): string {
    return this.props.command;
  }

  /** Lo que recibe el equipo: el número permite asociar su respuesta a este comando. */
  get wireText(): string {
    return `C:${this.props.number}:${this.props.command}`;
  }

  get status(): DeviceCommandStatus {
    return this.props.status;
  }

  get queuedAt(): Date {
    return this.props.queuedAt;
  }

  get sentAt(): Date | null {
    return this.props.sentAt;
  }

  get returnCode(): string | null {
    return this.props.returnCode;
  }

  get completedAt(): Date | null {
    return this.props.completedAt;
  }

  get queuedBy(): string | null {
    return this.props.queuedBy;
  }

  /** Lo entrega una sola vez: un comando ya enviado no cambia. */
  markSent(now: Date): void {
    if (this.props.status !== 'QUEUED') return;
    this.props = { ...this.props, status: 'SENT', sentAt: now };
  }

  /**
   * Cierra un comando enviado con el código `Return` del equipo: `0` es éxito, otro es falla.
   * Devuelve `false` si no cambió (no enviado, ya cerrado o código ilegible).
   */
  complete(returnCode: string, now: Date): boolean {
    if (this.props.status !== 'SENT' || !RETURN_CODE_PATTERN.test(returnCode)) return false;
    this.props = {
      ...this.props,
      status: returnCode === SUCCESS_RETURN_CODE ? 'DONE' : 'FAILED',
      returnCode,
      completedAt: now,
    };
    return true;
  }
}
