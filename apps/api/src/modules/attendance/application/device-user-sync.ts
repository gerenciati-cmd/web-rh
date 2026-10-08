import type { Clock, IdGenerator, Logger } from '@/shared/application/ports';

import type { Device } from '../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../domain/device-command';
import type { DeviceCommandRepository } from '../domain/device-command.repository';
import { deleteUserCommand, upsertUserCommand } from '../domain/device-user-commands';
import type { DeviceUserRepository } from '../domain/device-user.repository';

interface Deps {
  deviceCommandRepository: DeviceCommandRepository;
  deviceUserRepository: DeviceUserRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}

/**
 * - `queued`: se encoló un comando nuevo.
 * - `duplicate`: ya había uno idéntico en cola; no se repite.
 * - `invalid`: el dominio rechazó el texto (p. ej. largo); se omite.
 * - `unrestricted`: el equipo no tiene redes permitidas; no se encoló nada.
 */
export type SyncOutcome = 'queued' | 'duplicate' | 'invalid' | 'unrestricted';

/**
 * Encola los comandos de sincronización y mantiene el registro `device_users`. Encola directo
 * con `DeviceCommand.queue` (no vía `QueueDeviceCommand`, que exige un usuario), así que la
 * barrera de red (decisión 16) se aplica aquí: todo comando de sincronización pasa por este
 * helper. Los logs llevan ids y conteos, nunca PIN ni nombre.
 */
export class DeviceUserSync {
  constructor(private readonly deps: Deps) {}

  /** Alta o actualización del colaborador en el equipo. */
  async push(
    device: Device,
    member: { employeeId: string; fullName: string; rfc: string },
    queuedBy: string | null,
  ): Promise<SyncOutcome> {
    if (!device.receivesCommands) return 'unrestricted';
    const outcome = await this.enqueue(
      device,
      upsertUserCommand(member.rfc, member.fullName),
      member.employeeId,
      queuedBy,
    );
    if (outcome === 'queued' || outcome === 'duplicate') {
      await this.deps.deviceUserRepository.put({
        deviceId: device.id,
        pin: member.rfc,
        employeeId: member.employeeId,
        syncedAt: this.deps.clock.now(),
      });
    }
    return outcome;
  }

  /** Baja de un usuario que el API había puesto en el equipo. */
  async remove(
    device: Device,
    user: { pin: string; employeeId: string },
    queuedBy: string | null,
  ): Promise<SyncOutcome> {
    if (!device.receivesCommands) return 'unrestricted';
    const outcome = await this.enqueue(
      device,
      deleteUserCommand(user.pin),
      user.employeeId,
      queuedBy,
    );
    if (outcome === 'queued' || outcome === 'duplicate') {
      await this.deps.deviceUserRepository.remove(device.id, user.pin);
    }
    return outcome;
  }

  private async enqueue(
    device: Device,
    text: string,
    employeeId: string,
    queuedBy: string | null,
  ): Promise<SyncOutcome> {
    const { deviceCommandRepository, idGenerator, clock, logger } = this.deps;
    if (await deviceCommandRepository.hasQueued(device.id, text)) return 'duplicate';

    const command = DeviceCommand.queue({
      id: idGenerator.next() as DeviceCommandId,
      deviceId: device.id,
      number: await deviceCommandRepository.nextNumber(),
      command: text,
      queuedBy,
      now: clock.now(),
    });
    if (!command.ok) {
      logger.warn(
        { deviceId: device.id, employeeId },
        'zkteco: comando de sincronización inválido',
      );
      return 'invalid';
    }
    await deviceCommandRepository.save(command.value);
    return 'queued';
  }
}
