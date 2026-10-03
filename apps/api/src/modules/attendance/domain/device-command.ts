import { Entity, err, InvalidValueError, ok, type Id, type Result } from '@rrhh/domain';

import type { DeviceId } from './device';

export type DeviceCommandId = Id<'DeviceCommand'>;

export type DeviceCommandStatus = 'QUEUED' | 'SENT';

export interface DeviceCommandProps {
  deviceId: DeviceId;
  command: string;
  status: DeviceCommandStatus;
  queuedAt: Date;
  sentAt: Date | null;
  queuedBy: string;
}

// Duplica `DEVICE_COMMAND_PATTERN` de @rrhh/contracts (el dominio no importa contratos). Es una
// hipótesis de la sonda, no un formato observado en el equipo.
const COMMAND_PATTERN = /^(C:\d+:)?DATA (UPDATE|QUERY|DELETE) USERINFO /;
const MAX_COMMAND_LENGTH = 500;

/** Comando que un operador encoló para entregarse al checador en su próximo sondeo. */
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
    command: string;
    queuedBy: string;
    now: Date;
  }): Result<DeviceCommand, InvalidValueError> {
    if (input.command.length < 1 || input.command.length > MAX_COMMAND_LENGTH) {
      return err(new InvalidValueError('Comando con largo inválido'));
    }
    if (!COMMAND_PATTERN.test(input.command)) {
      return err(new InvalidValueError('Solo se aceptan comandos USERINFO'));
    }
    return ok(
      new DeviceCommand(input.id, {
        deviceId: input.deviceId,
        command: input.command,
        status: 'QUEUED',
        queuedAt: input.now,
        sentAt: null,
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

  get command(): string {
    return this.props.command;
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

  get queuedBy(): string {
    return this.props.queuedBy;
  }

  /** Lo entrega una sola vez: un comando ya enviado no cambia. */
  markSent(now: Date): void {
    if (this.props.status === 'SENT') return;
    this.props = { ...this.props, status: 'SENT', sentAt: now };
  }
}
