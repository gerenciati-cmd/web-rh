import { describe, expect, it } from 'vitest';

import { Device, DEVICE_COMMANDS_ENABLED, DEVICE_SITE_ASSIGNED, type DeviceId } from './device';
import { DeviceCommand, type DeviceCommandId } from './device-command';
import { DeviceWithoutSiteError } from './errors';

/** Eventos que disparan la sincronización de colaboradores (plan attendance-marcaciones/007). */
const ID = '00000000-0000-4000-8000-000000000001' as DeviceId;
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-10-08T12:00:00Z');

function registered(): Device {
  const result = Device.register({
    id: ID,
    serialNumber: 'TESTSN001',
    name: 'Entrada',
    siteId: SITE_A,
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!result.ok) throw result.error;
  result.value.pullEvents();
  return result.value;
}

describe('Device.assignSite: evento', () => {
  it('registra DEVICE_SITE_ASSIGNED con la sede nueva y la anterior cuando cambia', () => {
    const device = registered();

    device.assignSite(SITE_B, 'America/Mexico_City', NOW);

    const events = device.pullEvents();
    expect(events.map((event) => event.name)).toEqual([DEVICE_SITE_ASSIGNED]);
    expect(events[0]?.payload).toEqual({ deviceId: ID, siteId: SITE_B, previousSiteId: SITE_A });
  });

  it('no registra nada al repetir la misma sede, pero la zona sí se copia', () => {
    const device = registered();

    device.assignSite(SITE_A, 'America/Mexico_City', NOW);

    expect(device.pullEvents()).toEqual([]);
    expect(device.timeZone).toBe('America/Mexico_City');
  });
});

describe('Device.setAllowedNetworks: evento', () => {
  it('registra DEVICE_COMMANDS_ENABLED al pasar de sin redes a con redes', () => {
    const device = registered();

    const result = device.setAllowedNetworks(['10.0.0.0/8'], NOW);

    expect(result.ok).toBe(true);
    const events = device.pullEvents();
    expect(events.map((event) => event.name)).toEqual([DEVICE_COMMANDS_ENABLED]);
    expect(events[0]?.payload).toEqual({ deviceId: ID });
  });

  it('no registra nada al reemplazar una lista no vacía por otra no vacía', () => {
    const device = registered();
    device.setAllowedNetworks(['10.0.0.0/8'], NOW);
    device.pullEvents();

    device.setAllowedNetworks(['192.168.1.0/24'], NOW);

    expect(device.pullEvents()).toEqual([]);
  });

  it('no registra nada al vaciar la lista, y vuelve a registrar al rehabilitarla', () => {
    const device = registered();
    device.setAllowedNetworks(['10.0.0.0/8'], NOW);
    device.pullEvents();

    device.setAllowedNetworks([], NOW);
    expect(device.pullEvents()).toEqual([]);

    device.setAllowedNetworks(['10.0.0.0/8'], NOW);
    expect(device.pullEvents().map((event) => event.name)).toEqual([DEVICE_COMMANDS_ENABLED]);
  });

  it('no registra nada si la lista vacía se repite ni si la lista es inválida', () => {
    const device = registered();

    device.setAllowedNetworks([], NOW);
    const invalid = device.setAllowedNetworks(['10.0.0.0/33'], NOW);

    expect(invalid.ok).toBe(false);
    expect(device.pullEvents()).toEqual([]);
    expect(device.allowedNetworks).toEqual([]);
  });
});

describe('DeviceCommand.queue: queuedBy nulo', () => {
  it('acepta queuedBy null (comando de la sincronización automática)', () => {
    const result = DeviceCommand.queue({
      id: '00000000-0000-4000-8000-0000000000c1' as DeviceCommandId,
      deviceId: ID,
      number: 1,
      command: 'DATA DELETE USERINFO PIN=GOMA850101AB1',
      queuedBy: null,
      now: NOW,
    });

    expect(result.ok && result.value.queuedBy).toBeNull();
  });
});

describe('DeviceWithoutSiteError', () => {
  it('es DEVICE_WITHOUT_SITE con el deviceId en details', () => {
    const error = new DeviceWithoutSiteError(ID);

    expect(error.code).toBe('DEVICE_WITHOUT_SITE');
    expect(error.message).toBe('El checador no tiene sede asignada');
    expect(error.details).toEqual({ deviceId: ID });
  });
});
