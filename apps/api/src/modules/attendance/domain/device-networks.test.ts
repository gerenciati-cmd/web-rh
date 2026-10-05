import { describe, expect, it } from 'vitest';

import { Device, DEVICE_SEEN_RESOLUTION_MS, MAX_ALLOWED_NETWORKS, type DeviceId } from './device';
import { DeviceNetworkUnrestrictedError } from './errors';

const ID = '00000000-0000-4000-8000-000000000001' as DeviceId;
const NOW = new Date('2026-10-05T17:00:00Z');

function registered(): Device {
  const result = Device.register({
    id: ID,
    serialNumber: 'TESTSN001',
    name: 'Entrada principal',
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!result.ok) throw result.error;
  return result.value;
}

function withNetworks(networks: readonly string[]): Device {
  const device = registered();
  const set = device.setAllowedNetworks(networks);
  if (!set.ok) throw set.error;
  return device;
}

describe('Device: estado inicial de red', () => {
  it('un equipo nuevo no tiene redes permitidas, no recibe comandos y no tiene IP', () => {
    const device = registered();

    expect(device.allowedNetworks).toEqual([]);
    expect(device.receivesCommands).toBe(false);
    expect(device.lastSeenIp).toBeNull();
  });
});

describe('Device.setAllowedNetworks', () => {
  it('guarda las redes en forma canónica a.b.c.d/n', () => {
    const device = registered();

    const result = device.setAllowedNetworks(['127.0.0.1', '10.1.2.3/24']);

    expect(result.ok).toBe(true);
    expect(device.allowedNetworks).toEqual(['127.0.0.1/32', '10.1.2.0/24']);
  });

  it('elimina repetidos, también los que solo se repiten tras canonizar', () => {
    const device = registered();

    device.setAllowedNetworks(['10.1.2.0/24', '10.1.2.77/24', '10.1.2.0/24']);

    expect(device.allowedNetworks).toEqual(['10.1.2.0/24']);
  });

  it('una lista vacía quita la restricción', () => {
    const device = withNetworks(['10.0.0.0/8']);

    const result = device.setAllowedNetworks([]);

    expect(result.ok).toBe(true);
    expect(device.allowedNetworks).toEqual([]);
    expect(device.receivesCommands).toBe(false);
  });

  it.each(['junk', '10.0.0.0/33', '::1', '300.1.1.1', ''])(
    'rechaza %j con INVALID_VALUE y no cambia las redes previas',
    (bad) => {
      const device = withNetworks(['10.0.0.0/8']);

      const result = device.setAllowedNetworks(['192.168.1.1', bad]);

      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(!result.ok && result.error.message).toBe(`Red IPv4 inválida: ${bad}`);
      expect(device.allowedNetworks).toEqual(['10.0.0.0/8']);
    },
  );

  it('acepta exactamente el máximo de redes y rechaza una más', () => {
    const distinct = (count: number) =>
      Array.from({ length: count }, (_, index) => `10.0.${index}.0/24`);
    const device = registered();

    expect(device.setAllowedNetworks(distinct(MAX_ALLOWED_NETWORKS)).ok).toBe(true);
    expect(device.allowedNetworks).toHaveLength(MAX_ALLOWED_NETWORKS);

    const tooMany = device.setAllowedNetworks(distinct(MAX_ALLOWED_NETWORKS + 1));
    expect(!tooMany.ok && tooMany.error.message).toBe('Máximo 10 redes por checador');
    expect(device.allowedNetworks).toHaveLength(MAX_ALLOWED_NETWORKS);
  });

  it('el tope cuenta redes distintas: repetidos no lo agotan', () => {
    const device = registered();
    const repeated = Array.from({ length: MAX_ALLOWED_NETWORKS + 5 }, () => '10.0.0.1');

    expect(device.setAllowedNetworks(repeated).ok).toBe(true);
    expect(device.allowedNetworks).toEqual(['10.0.0.1/32']);
  });
});

describe('Device.receivesCommands', () => {
  it('es true solo cuando hay al menos una red permitida', () => {
    const device = registered();
    expect(device.receivesCommands).toBe(false);

    device.setAllowedNetworks(['10.0.0.1']);
    expect(device.receivesCommands).toBe(true);

    device.setAllowedNetworks([]);
    expect(device.receivesCommands).toBe(false);
  });
});

describe('Device.acceptsAddress', () => {
  it('sin redes permitidas acepta cualquier origen, incluso desconocido o basura', () => {
    const device = registered();

    expect(device.acceptsAddress('203.0.113.9')).toBe(true);
    expect(device.acceptsAddress(null)).toBe(true);
    expect(device.acceptsAddress('no-es-ip')).toBe(true);
  });

  it('con redes acepta una IP dentro de alguna de ellas y rechaza las demás', () => {
    const device = withNetworks(['10.0.5.0/24', '203.0.113.9']);

    expect(device.acceptsAddress('10.0.5.200')).toBe(true);
    expect(device.acceptsAddress('203.0.113.9')).toBe(true);
    expect(device.acceptsAddress('10.0.6.1')).toBe(false);
    expect(device.acceptsAddress('203.0.113.10')).toBe(false);
  });

  it('con redes rechaza un origen desconocido (null) o que no es IPv4', () => {
    const device = withNetworks(['0.0.0.0/0']);

    expect(device.acceptsAddress(null)).toBe(false);
    expect(device.acceptsAddress('junk')).toBe(false);
    expect(device.acceptsAddress('2001:db8::1')).toBe(false);
  });

  it('reconoce la forma IPv4 mapeada de un socket de doble pila', () => {
    const device = withNetworks(['192.168.1.0/24']);

    expect(device.acceptsAddress('::ffff:192.168.1.20')).toBe(true);
    expect(device.acceptsAddress('::ffff:192.168.2.20')).toBe(false);
  });

  it('/0 acepta cualquier IPv4', () => {
    const device = withNetworks(['0.0.0.0/0']);

    expect(device.acceptsAddress('8.8.8.8')).toBe(true);
  });
});

describe('Device.markSeen con IP', () => {
  const FIRST = new Date(NOW.getTime() + 1000);

  it('la primera vez anota el contacto y la IP, y pide persistir', () => {
    const device = registered();

    expect(device.markSeen(FIRST, '10.0.0.5')).toBe(true);
    expect(device.lastSeenAt).toEqual(FIRST);
    expect(device.lastSeenIp).toBe('10.0.0.5');
  });

  it('dentro de la resolución y con la misma IP no cambia nada ni pide persistir', () => {
    const device = registered();
    device.markSeen(FIRST, '10.0.0.5');

    const shortlyAfter = new Date(FIRST.getTime() + DEVICE_SEEN_RESOLUTION_MS - 1);
    expect(device.markSeen(shortlyAfter, '10.0.0.5')).toBe(false);
    expect(device.lastSeenAt).toEqual(FIRST);
    expect(device.lastSeenIp).toBe('10.0.0.5');
  });

  it('dentro de la resolución pero con IP distinta anota la nueva IP y pide persistir', () => {
    const device = registered();
    device.markSeen(FIRST, '10.0.0.5');
    const shortlyAfter = new Date(FIRST.getTime() + 1000);

    expect(device.markSeen(shortlyAfter, '10.0.0.9')).toBe(true);
    expect(device.lastSeenIp).toBe('10.0.0.9');
    expect(device.lastSeenAt).toEqual(shortlyAfter);
  });

  it('pasada la resolución con la misma IP vuelve a anotar', () => {
    const device = registered();
    device.markSeen(FIRST, '10.0.0.5');
    const later = new Date(FIRST.getTime() + DEVICE_SEEN_RESOLUTION_MS);

    expect(device.markSeen(later, '10.0.0.5')).toBe(true);
    expect(device.lastSeenAt).toEqual(later);
  });

  it('pasar de una IP a null dentro de la resolución cuenta como cambio', () => {
    const device = registered();
    device.markSeen(FIRST, '10.0.0.5');

    expect(device.markSeen(new Date(FIRST.getTime() + 1000), null)).toBe(true);
    expect(device.lastSeenIp).toBeNull();
  });
});

describe('DeviceNetworkUnrestrictedError', () => {
  it('tiene código estable, categoría de regla de negocio y el id en details', () => {
    const error = new DeviceNetworkUnrestrictedError(ID);

    expect(error.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
    expect(error.message).toBe('El checador no tiene redes permitidas: no puede recibir comandos');
    expect(error.details).toEqual({ deviceId: ID });
  });
});
