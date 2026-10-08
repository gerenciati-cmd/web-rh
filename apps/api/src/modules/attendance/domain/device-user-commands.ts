/**
 * Textos de los comandos que sincronizan colaboradores con el checador (sin prefijo `C:<n>:`).
 * UPDATE confirmado en el SenseFace 2A el 2026-10-03; DELETE sigue pendiente de confirmar en el
 * equipo (verificación del plan 007).
 */

// Un tab o salto de línea en el nombre rompería el formato `clave=valor` separado por tabs.
function sanitizeName(name: string): string {
  return name
    .replace(/\p{Cc}/gu, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export function upsertUserCommand(pin: string, name: string): string {
  return `DATA UPDATE USERINFO PIN=${pin}\tName=${sanitizeName(name)}\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`;
}

export function deleteUserCommand(pin: string): string {
  return `DATA DELETE USERINFO PIN=${pin}`;
}

/** Prefijo común de todo UPDATE de ese PIN (el texto sigue con un tab y los demás campos). */
export function upsertUserPrefix(pin: string): string {
  return `DATA UPDATE USERINFO PIN=${pin}\t`;
}

/** Si el comando (sin prefijo `C:<n>:`) es el alta o la baja de ese PIN. */
export function targetsPin(command: string, pin: string): boolean {
  return command === deleteUserCommand(pin) || command.startsWith(upsertUserPrefix(pin));
}
