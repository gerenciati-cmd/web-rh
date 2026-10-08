import type { DeviceSyncResultDto } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Logger } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceUserRepository } from '../../domain/device-user.repository';
import type { DeviceRepository } from '../../domain/device.repository';
import {
  DeviceNetworkUnrestrictedError,
  DeviceNotFoundError,
  DeviceWithoutSiteError,
} from '../../domain/errors';
import type { DeviceUserSync } from '../device-user-sync';
import type { SiteRoster } from '../ports/site-roster';

export interface SyncDeviceInput {
  deviceId: string;
  /** Usuario que lo pidió; null si lo dispara la sincronización automática. */
  queuedBy: string | null;
}

interface Deps {
  deviceRepository: DeviceRepository;
  deviceUserRepository: DeviceUserRepository;
  siteRoster: SiteRoster;
  deviceUserSync: DeviceUserSync;
  logger: Logger;
}

/**
 * Deja un checador con los colaboradores activos de su sede: alta de cada uno con RFC y baja de
 * los que el API puso antes y ya no pertenecen. Nunca toca usuarios que el API no registró.
 */
export class SyncDevice implements Command<SyncDeviceInput, DeviceSyncResultDto> {
  constructor(private readonly deps: Deps) {}

  async execute(input: SyncDeviceInput) {
    const { deviceRepository, deviceUserRepository, siteRoster, deviceUserSync, logger } =
      this.deps;

    // Sin usuario (disparo automático) nadie recibe la respuesta: el rechazo queda en el log.
    const fail = (error: DomainError) => {
      if (input.queuedBy === null) {
        logger.warn(
          { deviceId: input.deviceId, code: error.code },
          error instanceof DeviceNetworkUnrestrictedError
            ? 'zkteco: checador sin redes, sincronización omitida'
            : 'zkteco: sincronización omitida',
        );
      }
      return err<DomainError>(error);
    };

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device) return fail(new DeviceNotFoundError(input.deviceId));
    if (device.siteId === null) return fail(new DeviceWithoutSiteError(device.id));

    const result: DeviceSyncResultDto = { queued: 0, removed: 0, skipped: [] };
    if (!device.active) return ok(result);
    if (!device.receivesCommands) {
      return fail(new DeviceNetworkUnrestrictedError(device.id));
    }

    const members = await siteRoster.activeMembers(device.siteId);
    const memberRfcs = new Set<string>();
    for (const member of members) {
      if (member.rfc === null) {
        result.skipped.push({
          employeeId: member.employeeId,
          fullName: member.fullName,
          reason: 'NO_RFC',
        });
        continue;
      }
      memberRfcs.add(member.rfc);
      const outcome = await deviceUserSync.push(
        device,
        { employeeId: member.employeeId, fullName: member.fullName, rfc: member.rfc },
        input.queuedBy,
      );
      if (outcome === 'queued') result.queued += 1;
    }

    for (const user of await deviceUserRepository.listByDevice(device.id)) {
      if (memberRfcs.has(user.pin)) continue;
      const outcome = await deviceUserSync.remove(device, user, input.queuedBy);
      if (outcome === 'queued') result.removed += 1;
    }

    logger.info(
      {
        deviceId: device.id,
        queued: result.queued,
        removed: result.removed,
        skipped: result.skipped.length,
      },
      'zkteco: sincronización de checador',
    );
    return ok(result);
  }
}
