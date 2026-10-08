import type { Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { Device } from '../../domain/device';
import type { DeviceUser } from '../../domain/device-user';
import type { DeviceUserRepository } from '../../domain/device-user.repository';
import type { DeviceRepository } from '../../domain/device.repository';
import type { DeviceUserSync, SyncOutcome } from '../device-user-sync';
import type { SiteRoster } from '../ports/site-roster';

interface Deps {
  deviceRepository: DeviceRepository;
  deviceUserRepository: DeviceUserRepository;
  siteRoster: SiteRoster;
  deviceUserSync: DeviceUserSync;
  logger: Logger;
}

/** Dónde debe estar el colaborador: su sede, con su RFC como PIN. */
interface Target {
  employeeId: string;
  fullName: string;
  rfc: string;
  siteId: string;
}

/**
 * Reconcilia a UN colaborador con los checadores: debe estar en los equipos activos de su sede
 * (si está activo y tiene RFC) y en ningún otro. Un equipo sin redes permitidas se omite; su
 * propia sincronización al habilitarlo lo pone al día.
 */
export class SyncEmployee implements UseCase<{ employeeId: string }, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { employeeId: string }): Promise<void> {
    const { deviceRepository, deviceUserRepository, logger } = this.deps;
    const { employeeId } = input;

    const target = await this.findTarget(employeeId);
    const desired = target ? await deviceRepository.listActiveBySite(target.siteId) : [];
    const rows = await deviceUserRepository.listByEmployee(employeeId);

    const unrestricted = new Set<string>();
    const note = (deviceId: string, outcome: SyncOutcome) => {
      if (outcome === 'unrestricted') unrestricted.add(deviceId);
    };

    await this.removeStale(rows, desired, target, note);
    await this.addMissing(rows, desired, target, note);

    for (const deviceId of unrestricted) {
      logger.warn({ deviceId, employeeId }, 'zkteco: checador sin redes, sincronización omitida');
    }
  }

  /** Sin destino (inactivo, sin RFC o sin sede) el colaborador no debe estar en ningún equipo. */
  private async findTarget(employeeId: string): Promise<Target | null> {
    const placement = await this.deps.siteRoster.findPlacement(employeeId);
    if (!placement?.active) return null;
    const { rfc, fullName } = placement.member;
    if (rfc === null || placement.siteId === null) return null;
    return { employeeId, fullName, rfc, siteId: placement.siteId };
  }

  private async removeStale(
    rows: readonly DeviceUser[],
    desired: readonly Device[],
    target: Target | null,
    note: (deviceId: string, outcome: SyncOutcome) => void,
  ): Promise<void> {
    const desiredIds = new Set<string>(desired.map((device) => device.id));
    for (const row of rows) {
      if (desiredIds.has(row.deviceId) && row.pin === target?.rfc) continue;
      const device = await this.deps.deviceRepository.findById(row.deviceId);
      // Un equipo que ya no existe no tiene a dónde mandar la baja.
      if (!device) continue;
      note(device.id, await this.deps.deviceUserSync.remove(device, row, null));
    }
  }

  private async addMissing(
    rows: readonly DeviceUser[],
    desired: readonly Device[],
    target: Target | null,
    note: (deviceId: string, outcome: SyncOutcome) => void,
  ): Promise<void> {
    if (!target) return;
    for (const device of desired) {
      if (rows.some((row) => row.deviceId === device.id && row.pin === target.rfc)) continue;
      const member = { employeeId: target.employeeId, fullName: target.fullName, rfc: target.rfc };
      note(device.id, await this.deps.deviceUserSync.push(device, member, null));
    }
  }
}
