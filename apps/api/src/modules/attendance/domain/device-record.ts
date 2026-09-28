/** Registro que un equipo ZKTeco empuja por ADMS, ya interpretado y sin datos sensibles. */
export type DevicePushRecord =
  | {
      kind: 'attendance';
      pin: string;
      /** Hora local del equipo tal como llega (`YYYY-MM-DD HH:mm:ss`), sin desfase horario. */
      deviceTime: string;
      status: string;
      verifyMode: string;
      extraFields: number;
    }
  | {
      kind: 'operation';
      code: string;
      adminPin: string;
      deviceTime: string;
      objects: readonly string[];
    }
  | { kind: 'entry'; prefix: string; fields: Readonly<Record<string, string>> }
  | { kind: 'unparsed'; length: number };

/**
 * Campos cuyo valor puede quedar en el log. Es una lista cerrada a propósito: plantillas de
 * huella/rostro, fotos, claves, tarjetas y nombres son datos personales (decisión 3 del README
 * de la iniciativa), y una clave desconocida debe quedar oculta hasta que alguien la revise.
 * La comparación es exacta porque el equipo mezcla `PIN` y `Pin`.
 */
export const LOGGABLE_DEVICE_FIELDS: ReadonlySet<string> = new Set([
  'PIN',
  'Pin',
  'FID',
  'No',
  'Index',
  'Valid',
  'Duress',
  'Type',
  'MajorVer',
  'MinorVer',
  'Format',
  'Size',
  'Pri',
  'Grp',
  'TZ',
  'Verify',
  'Expires',
  'DeviceName',
  'FWVersion',
  'PushVersion',
]);

// Claves y prefijos se registran tal cual: solo se aceptan con forma de identificador corto, para
// que un formato desconocido (p. ej. una foto binaria) no cuele contenido crudo en el log.
const DEVICE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** `true` si el texto puede usarse como clave o prefijo de registro sin redactarlo. */
export function isDeviceIdentifier(text: string): boolean {
  return DEVICE_IDENTIFIER.test(text);
}

/** Un valor largo en un campo permitido sigue siendo sospechoso (p. ej. un blob mal etiquetado). */
const MAX_LOGGABLE_VALUE_LENGTH = 64;

/** Conserva todas las claves y reemplaza por `[redactado:<largo>]` los valores no permitidos. */
export function redactDeviceFields(
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const loggable = LOGGABLE_DEVICE_FIELDS.has(key) && value.length <= MAX_LOGGABLE_VALUE_LENGTH;
    redacted[key] = loggable ? value : `[redactado:${value.length}]`;
  }
  return redacted;
}
