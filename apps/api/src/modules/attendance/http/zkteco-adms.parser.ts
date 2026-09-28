import { redactDeviceFields, type DevicePushRecord } from '../domain/device-record';

/**
 * Traduce el formato de cable de ZKTeco ADMS (texto, una entrada por línea) a registros del
 * módulo. Los formatos se observaron en un SenseFace 2A (`ZAM70-NF24HA-Ver3.3.12`, 2026-09-28);
 * ver el Context del plan attendance-sonda-zkteco/001. El contenido crudo de una línea nunca
 * sale de aquí: lo que no se entiende se reduce a su largo.
 */
export function parseAdmsBody(table: string, body: string): DevicePushRecord[] {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');

  const normalizedTable = table.toUpperCase();
  if (normalizedTable === 'OPTIONS') return lines.map(parseOptionsLine);
  if (normalizedTable === 'ATTLOG') return lines.map(parseAttendanceLine);
  return lines.map(parsePrefixedLine);
}

// Los valores pueden traer comas (`… CO., LTD.`): se corta solo antes de un `~?Clave=`.
const OPTIONS_SEPARATOR = /,(?=~?[A-Za-z]\w*=)/;

function parseOptionsLine(line: string): DevicePushRecord {
  const fields: Record<string, string> = {};
  for (const pair of line.split(OPTIONS_SEPARATOR)) {
    const parsed = splitKeyValue(pair);
    if (parsed) fields[parsed.key.replace(/^~/, '')] = parsed.value;
  }
  return { kind: 'entry', prefix: 'options', fields: redactDeviceFields(fields) };
}

function parseAttendanceLine(line: string): DevicePushRecord {
  const fields = line.split('\t');
  // El equipo termina cada marcación con un tab.
  if (fields.at(-1) === '') fields.pop();
  const [pin, deviceTime, status = '', verifyMode = '', ...extra] = fields;
  if (pin === undefined || deviceTime === undefined) return unparsed(line);
  return { kind: 'attendance', pin, deviceTime, status, verifyMode, extraFields: extra.length };
}

function parsePrefixedLine(line: string): DevicePushRecord {
  const space = line.indexOf(' ');
  if (space <= 0) return unparsed(line);
  const prefix = line.slice(0, space);
  const parts = line.slice(space + 1).split('\t');

  if (prefix === 'OPLOG') {
    // OPLOG <código>\t<pin admin>\t<hora>\t<objetos…>: posicional, sin pares clave=valor.
    const [code, adminPin, deviceTime, ...objects] = parts;
    if (code === undefined || adminPin === undefined || deviceTime === undefined) {
      return unparsed(line);
    }
    return { kind: 'operation', code, adminPin, deviceTime, objects };
  }

  const fields: Record<string, string> = {};
  for (const part of parts) {
    const parsed = splitKeyValue(part);
    if (!parsed) return unparsed(line);
    fields[parsed.key] = parsed.value;
  }
  return { kind: 'entry', prefix, fields: redactDeviceFields(fields) };
}

/** Corta en el PRIMER `=`: los valores base64 terminan en `=`. */
function splitKeyValue(pair: string): { key: string; value: string } | null {
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  return { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

function unparsed(line: string): DevicePushRecord {
  return { kind: 'unparsed', length: line.length };
}

/**
 * Respuesta al handshake (`GET /iclock/cdata`). Un SenseFace 2A (`ZAM70-NF24HA-Ver3.3.12`) la
 * aceptó el 2026-09-28. `Stamp=None` le pide al equipo reenviar todo su historial, lo que
 * conviene en la sonda; `Delay` es cada cuántos segundos consulta comandos.
 */
export function admsOptionsResponse(serialNumber: string): string {
  return [
    `GET OPTION FROM: ${serialNumber}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=None',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:05',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP FACE UserPic BioPhoto',
    'Realtime=1',
    'Encrypt=None',
  ].join('\n');
}
