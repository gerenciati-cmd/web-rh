/**
 * Redes IPv4 (dirección o CIDR) para la barrera de red de los checadores. Aritmética pura sobre
 * enteros de 32 bits: el dominio no puede usar `node:net` (regla `domain-no-node-builtins`), y los
 * equipos ADMS se conectan por IPv4 (decisión 13 del README de `attendance-marcaciones`).
 */
export interface Ipv4Network {
  /** Dirección de red ya enmascarada, como entero sin signo. */
  readonly base: number;
  readonly prefix: number;
}

// Cada octeto 0–255 sin ceros a la izquierda: `010` es ambiguo (octal en algunas herramientas).
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)';
const IPV4_PATTERN = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);
const PREFIX_PATTERN = /^(?:3[0-2]|[12]\d|\d)$/;
// Forma en que Node reporta una IPv4 en un socket de doble pila.
const MAPPED_PREFIX = '::ffff:';

/** Convierte `a.b.c.d` (o `::ffff:a.b.c.d`) a entero sin signo; `null` si no es una IPv4 válida. */
export function parseIpv4Address(text: string): number | null {
  const lower = text.trim().toLowerCase();
  const address = lower.startsWith(MAPPED_PREFIX) ? lower.slice(MAPPED_PREFIX.length) : lower;
  if (!IPV4_PATTERN.test(address)) return null;
  return address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
}

/** Interpreta `a.b.c.d` (equivale a `/32`) o `a.b.c.d/n`; `null` si no es válida. */
export function parseIpv4Network(text: string): Ipv4Network | null {
  const [addressText, prefixText, ...rest] = text.trim().split('/');
  if (rest.length > 0 || addressText === undefined || addressText.includes(':')) return null;
  const address = parseIpv4Address(addressText);
  if (address === null) return null;
  if (prefixText !== undefined && !PREFIX_PATTERN.test(prefixText)) return null;
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  return { base: applyMask(address, prefix), prefix };
}

export function ipv4NetworkContains(network: Ipv4Network, address: number): boolean {
  return applyMask(address, network.prefix) === network.base;
}

/** Texto canónico `a.b.c.d/n` (dirección ya enmascarada). */
export function formatIpv4Network(network: Ipv4Network): string {
  const { base } = network;
  const octets = [base >>> 24, (base >>> 16) & 255, (base >>> 8) & 255, base & 255];
  return `${octets.join('.')}/${network.prefix}`;
}

function applyMask(address: number, prefix: number): number {
  // `<< 32` no existe en JS (desplaza 0): el prefijo 0 se trata aparte.
  if (prefix === 0) return 0;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0;
}
