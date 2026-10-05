import { describe, expect, it } from 'vitest';

import {
  formatIpv4Address,
  formatIpv4Network,
  ipv4NetworkContains,
  parseIpv4Address,
  parseIpv4Network,
} from './ipv4-network';

function network(text: string) {
  const parsed = parseIpv4Network(text);
  if (!parsed) throw new Error(`red inválida en el test: ${text}`);
  return parsed;
}

function address(text: string): number {
  const parsed = parseIpv4Address(text);
  if (parsed === null) throw new Error(`IP inválida en el test: ${text}`);
  return parsed;
}

describe('parseIpv4Address', () => {
  it('convierte una IPv4 a entero sin signo de 32 bits', () => {
    expect(parseIpv4Address('0.0.0.0')).toBe(0);
    expect(parseIpv4Address('10.0.0.1')).toBe(167772161);
    expect(parseIpv4Address('255.255.255.255')).toBe(4294967295);
  });

  it('desenvuelve la forma IPv4 mapeada que Node reporta en sockets de doble pila', () => {
    expect(parseIpv4Address('::ffff:10.0.0.1')).toBe(parseIpv4Address('10.0.0.1'));
    expect(parseIpv4Address('::FFFF:192.168.1.20')).toBe(parseIpv4Address('192.168.1.20'));
  });

  it('recorta espacios alrededor', () => {
    expect(parseIpv4Address(' 10.0.0.1 ')).toBe(parseIpv4Address('10.0.0.1'));
  });

  it.each([
    '',
    'junk',
    '10.0.0',
    '10.0.0.1.5',
    '256.0.0.1',
    '10.0.0.256',
    '-1.0.0.1',
    '010.0.0.1',
    '10.00.0.1',
    '10.0.0.1/24',
    '::1',
    '2001:db8::1',
    '::ffff:999.0.0.1',
  ])('rechaza %j', (text) => {
    expect(parseIpv4Address(text)).toBeNull();
  });
});

describe('parseIpv4Network', () => {
  it('una dirección sola equivale a /32', () => {
    expect(parseIpv4Network('10.1.2.3')).toEqual({ base: address('10.1.2.3'), prefix: 32 });
  });

  it('enmascara la dirección a la dirección de red', () => {
    expect(parseIpv4Network('10.1.2.3/24')).toEqual({ base: address('10.1.2.0'), prefix: 24 });
    expect(parseIpv4Network('192.168.77.9/16')).toEqual({
      base: address('192.168.0.0'),
      prefix: 16,
    });
  });

  it('acepta los prefijos extremos /0 y /32', () => {
    expect(parseIpv4Network('10.1.2.3/0')).toEqual({ base: 0, prefix: 0 });
    expect(parseIpv4Network('10.1.2.3/32')).toEqual({ base: address('10.1.2.3'), prefix: 32 });
  });

  it.each([
    '',
    'junk',
    '10.0.0.0/33',
    '10.0.0.0/-1',
    '10.0.0.0/',
    '10.0.0.0/08x',
    '10.0.0.0/024',
    '10.0.0.0/24/8',
    '10.0.0/24',
    '300.0.0.0/24',
    '::1',
    '2001:db8::/32',
    '::ffff:10.0.0.0/24',
  ])('rechaza %j', (text) => {
    expect(parseIpv4Network(text)).toBeNull();
  });
});

describe('ipv4NetworkContains', () => {
  it('/32 solo contiene su propia dirección', () => {
    const host = network('10.0.0.5');

    expect(ipv4NetworkContains(host, address('10.0.0.5'))).toBe(true);
    expect(ipv4NetworkContains(host, address('10.0.0.4'))).toBe(false);
    expect(ipv4NetworkContains(host, address('10.0.0.6'))).toBe(false);
  });

  it('/24 contiene sus extremos y excluye las redes vecinas', () => {
    const lan = network('10.0.5.0/24');

    expect(ipv4NetworkContains(lan, address('10.0.5.0'))).toBe(true);
    expect(ipv4NetworkContains(lan, address('10.0.5.255'))).toBe(true);
    expect(ipv4NetworkContains(lan, address('10.0.4.255'))).toBe(false);
    expect(ipv4NetworkContains(lan, address('10.0.6.0'))).toBe(false);
  });

  it('/0 contiene cualquier dirección, incluidas las más alta y más baja', () => {
    const everything = network('0.0.0.0/0');

    expect(ipv4NetworkContains(everything, address('0.0.0.0'))).toBe(true);
    expect(ipv4NetworkContains(everything, address('255.255.255.255'))).toBe(true);
    expect(ipv4NetworkContains(everything, address('172.16.9.9'))).toBe(true);
  });

  it('/31 cubre exactamente dos direcciones', () => {
    const pair = network('10.0.0.4/31');

    expect(ipv4NetworkContains(pair, address('10.0.0.4'))).toBe(true);
    expect(ipv4NetworkContains(pair, address('10.0.0.5'))).toBe(true);
    expect(ipv4NetworkContains(pair, address('10.0.0.6'))).toBe(false);
  });

  it('compara bien en el rango alto (bit de signo de 32 bits)', () => {
    const high = network('192.168.0.0/16');

    expect(ipv4NetworkContains(high, address('192.168.200.1'))).toBe(true);
    expect(ipv4NetworkContains(high, address('192.169.0.1'))).toBe(false);
  });
});

describe('formatIpv4Address', () => {
  it.each(['0.0.0.0', '10.0.0.1', '192.168.77.9', '255.255.255.255'])('%s ida y vuelta', (text) => {
    expect(formatIpv4Address(address(text))).toBe(text);
  });
});

describe('formatIpv4Network', () => {
  it.each([
    ['10.1.2.3', '10.1.2.3/32'],
    ['10.1.2.3/24', '10.1.2.0/24'],
    ['0.0.0.0/0', '0.0.0.0/0'],
    ['255.255.255.255', '255.255.255.255/32'],
    ['192.168.77.9/16', '192.168.0.0/16'],
  ])('%s -> %s', (text, canonical) => {
    expect(formatIpv4Network(network(text))).toBe(canonical);
  });
});
