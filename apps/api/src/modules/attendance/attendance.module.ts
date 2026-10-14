import { asClass } from 'awilix';

import {
  EMPLOYEE_HIRED,
  EMPLOYEE_RFC_ASSIGNED,
  EMPLOYEE_SITE_ASSIGNED,
  EMPLOYEE_TERMINATED,
} from '@/modules/employees';
import type { AppModule } from '@/shared/app-module';

import { AssignDeviceSite } from './application/commands/assign-device-site.command';
import { AssignEmployeeShift } from './application/commands/assign-employee-shift.command';
import { CompleteDeviceCommands } from './application/commands/complete-device-commands.command';
import { CreateShift } from './application/commands/create-shift.command';
import { QueueDeviceCommand } from './application/commands/queue-device-command.command';
import { RecordDeviceContact } from './application/commands/record-device-contact.command';
import { RecordDevicePush } from './application/commands/record-device-push.command';
import { RegisterDevice } from './application/commands/register-device.command';
import { SetDeviceNetworks } from './application/commands/set-device-networks.command';
import { SyncDevice } from './application/commands/sync-device.command';
import { SyncEmployee } from './application/commands/sync-employee.command';
import { TakeDeviceCommand } from './application/commands/take-device-command.command';
import { DeviceUserSync } from './application/device-user-sync';
import type { PunchOwnerDirectory } from './application/ports/punch-owner-directory';
import type { ShiftCompanyDirectory } from './application/ports/shift-company-directory';
import type { ShiftEmployeeDirectory } from './application/ports/shift-employee-directory';
import type { SiteDirectory } from './application/ports/site-directory';
import type { SiteRoster } from './application/ports/site-roster';
import type { AttendanceQueries } from './application/queries/attendance.queries';
import { ListDeviceCommands } from './application/queries/list-device-commands.query';
import { ListDevices } from './application/queries/list-devices.query';
import { ListEmployeeShiftAssignments } from './application/queries/list-employee-shift-assignments.query';
import { ListPunches } from './application/queries/list-punches.query';
import { ListShifts } from './application/queries/list-shifts.query';
import type { ShiftQueries } from './application/queries/shift.queries';
import { DEVICE_COMMANDS_ENABLED, DEVICE_SITE_ASSIGNED } from './domain/device';
import type { DeviceCommandRepository } from './domain/device-command.repository';
import type { DeviceUserRepository } from './domain/device-user.repository';
import type { DeviceRepository } from './domain/device.repository';
import type { PunchRepository } from './domain/punch.repository';
import type { ShiftAssignmentRepository } from './domain/shift-assignment.repository';
import type { ShiftRepository } from './domain/shift.repository';
import { createAttendanceRouter } from './http/attendance.router';
import { createZktecoAdmsRouter } from './http/zkteco-adms.router';
import { EmployeesPunchOwnerDirectory } from './infrastructure/employees-punch-owner-directory';
import { EmployeesShiftEmployeeDirectory } from './infrastructure/employees-shift-employee-directory';
import { EmployeesSiteRoster } from './infrastructure/employees-site-roster';
import { OrganizationShiftCompanyDirectory } from './infrastructure/organization-shift-company-directory';
import { OrganizationSiteDirectory } from './infrastructure/organization-site-directory';
import { PrismaAttendanceQueries } from './infrastructure/prisma-attendance.queries';
import { PrismaDeviceCommandRepository } from './infrastructure/prisma-device-command.repository';
import { PrismaDeviceUserRepository } from './infrastructure/prisma-device-user.repository';
import { PrismaDeviceRepository } from './infrastructure/prisma-device.repository';
import { PrismaPunchRepository } from './infrastructure/prisma-punch.repository';
import { PrismaShiftAssignmentRepository } from './infrastructure/prisma-shift-assignment.repository';
import { PrismaShiftQueries } from './infrastructure/prisma-shift.queries';
import { PrismaShiftRepository } from './infrastructure/prisma-shift.repository';

export interface AttendanceCradle {
  deviceRepository: DeviceRepository;
  punchRepository: PunchRepository;
  attendanceQueries: AttendanceQueries;
  punchOwnerDirectory: PunchOwnerDirectory;
  deviceSiteDirectory: SiteDirectory;
  registerDevice: RegisterDevice;
  assignDeviceSite: AssignDeviceSite;
  setDeviceNetworks: SetDeviceNetworks;
  listDevices: ListDevices;
  listPunches: ListPunches;
  recordDeviceContact: RecordDeviceContact;
  recordDevicePush: RecordDevicePush;
  deviceCommandRepository: DeviceCommandRepository;
  queueDeviceCommand: QueueDeviceCommand;
  takeDeviceCommand: TakeDeviceCommand;
  completeDeviceCommands: CompleteDeviceCommands;
  listDeviceCommands: ListDeviceCommands;
  siteRoster: SiteRoster;
  deviceUserRepository: DeviceUserRepository;
  deviceUserSync: DeviceUserSync;
  syncDevice: SyncDevice;
  syncEmployee: SyncEmployee;
  shiftRepository: ShiftRepository;
  shiftAssignmentRepository: ShiftAssignmentRepository;
  shiftQueries: ShiftQueries;
  shiftCompanyDirectory: ShiftCompanyDirectory;
  shiftEmployeeDirectory: ShiftEmployeeDirectory;
  createShift: CreateShift;
  assignEmployeeShift: AssignEmployeeShift;
  listShifts: ListShifts;
  listEmployeeShiftAssignments: ListEmployeeShiftAssignments;
}

// El bus registra el rechazo de un handler: una forma desconocida se loguea y se ignora.
function payloadId(payload: unknown, field: string, eventName: string): string {
  const value = (payload as Record<string, unknown> | null)?.[field];
  if (typeof value !== 'string') throw new Error(`El evento ${eventName} no trae ${field} válido`);
  return value;
}

export const attendanceModule: AppModule<AttendanceCradle> = {
  name: 'attendance',
  registrations: {
    // Persistencia
    deviceRepository: asClass(PrismaDeviceRepository).singleton(),
    punchRepository: asClass(PrismaPunchRepository).singleton(),
    deviceCommandRepository: asClass(PrismaDeviceCommandRepository).singleton(),
    attendanceQueries: asClass(PrismaAttendanceQueries).singleton(),
    punchOwnerDirectory: asClass(EmployeesPunchOwnerDirectory).singleton(),
    deviceSiteDirectory: asClass(OrganizationSiteDirectory).singleton(),
    // Casos de uso
    registerDevice: asClass(RegisterDevice).singleton(),
    assignDeviceSite: asClass(AssignDeviceSite).singleton(),
    setDeviceNetworks: asClass(SetDeviceNetworks).singleton(),
    listDevices: asClass(ListDevices).singleton(),
    listPunches: asClass(ListPunches).singleton(),
    recordDeviceContact: asClass(RecordDeviceContact).singleton(),
    recordDevicePush: asClass(RecordDevicePush).singleton(),
    queueDeviceCommand: asClass(QueueDeviceCommand).singleton(),
    takeDeviceCommand: asClass(TakeDeviceCommand).singleton(),
    completeDeviceCommands: asClass(CompleteDeviceCommands).singleton(),
    listDeviceCommands: asClass(ListDeviceCommands).singleton(),
    siteRoster: asClass(EmployeesSiteRoster).singleton(),
    deviceUserRepository: asClass(PrismaDeviceUserRepository).singleton(),
    deviceUserSync: asClass(DeviceUserSync).singleton(),
    syncDevice: asClass(SyncDevice).singleton(),
    syncEmployee: asClass(SyncEmployee).singleton(),
    // Turnos
    shiftRepository: asClass(PrismaShiftRepository).singleton(),
    shiftAssignmentRepository: asClass(PrismaShiftAssignmentRepository).singleton(),
    shiftQueries: asClass(PrismaShiftQueries).singleton(),
    shiftCompanyDirectory: asClass(OrganizationShiftCompanyDirectory).singleton(),
    shiftEmployeeDirectory: asClass(EmployeesShiftEmployeeDirectory).singleton(),
    createShift: asClass(CreateShift).singleton(),
    assignEmployeeShift: asClass(AssignEmployeeShift).singleton(),
    listShifts: asClass(ListShifts).singleton(),
    listEmployeeShiftAssignments: asClass(ListEmployeeShiftAssignments).singleton(),
  },
  // Un colaborador cambia (alta, sede, RFC, baja) → se reconcilia en los checadores; un checador
  // recibe redes o sede → se reconcilia con su sede. `DEVICE_REGISTERED` no se escucha: un equipo
  // nuevo no tiene redes permitidas y no puede recibir comandos (decisión 19).
  subscribe: ({ eventBus, syncEmployee, syncDevice }) => {
    for (const eventName of [
      EMPLOYEE_HIRED,
      EMPLOYEE_SITE_ASSIGNED,
      EMPLOYEE_RFC_ASSIGNED,
      EMPLOYEE_TERMINATED,
    ]) {
      eventBus.subscribe(eventName, async (event) => {
        await syncEmployee.execute({
          employeeId: payloadId(event.payload, 'employeeId', eventName),
        });
      });
    }
    for (const eventName of [DEVICE_COMMANDS_ENABLED, DEVICE_SITE_ASSIGNED]) {
      eventBus.subscribe(eventName, async (event) => {
        // Un `err` ya lo registra el caso de uso (queuedBy null): no se lanza.
        await syncDevice.execute({
          deviceId: payloadId(event.payload, 'deviceId', eventName),
          queuedBy: null,
        });
      });
    }
  },
  router: createAttendanceRouter,
  deviceRouter: createZktecoAdmsRouter,
  // El checador pregunta por comandos cada ~10 s (`Delay=10`).
  quietRequestPaths: ['/iclock/getrequest'],
};
