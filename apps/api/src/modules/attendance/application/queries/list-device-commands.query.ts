import type { DeviceCommandDto, Page, PageQuery } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceNotFoundError } from '../../domain/errors';

import type { AttendanceQueries } from './attendance.queries';

/** Bitácora de comandos de un checador; un equipo inexistente es 404, no una página vacía. */
export class ListDeviceCommands implements Command<
  PageQuery & { deviceId: string },
  Page<DeviceCommandDto>
> {
  constructor(
    private readonly deps: {
      attendanceQueries: AttendanceQueries;
      deviceRepository: DeviceRepository;
    },
  ) {}

  async execute({ deviceId, ...page }: PageQuery & { deviceId: string }) {
    const device = await this.deps.deviceRepository.findById(deviceId as DeviceId);
    if (!device) return err<DomainError>(new DeviceNotFoundError(deviceId));
    return ok(await this.deps.attendanceQueries.listDeviceCommands(deviceId, page));
  }
}
