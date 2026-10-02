import type { DeviceDto, Page, PageQuery } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { AttendanceQueries } from './attendance.queries';

export class ListDevices implements UseCase<PageQuery, Page<DeviceDto>> {
  constructor(private readonly deps: { attendanceQueries: AttendanceQueries }) {}

  execute(page: PageQuery): Promise<Page<DeviceDto>> {
    return this.deps.attendanceQueries.listDevices(page);
  }
}
