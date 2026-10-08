import { describe, expect, it } from 'vitest';

import { deleteUserCommand, upsertUserCommand } from './device-user-commands';

describe('upsertUserCommand', () => {
  it('arma el texto confirmado en el SenseFace 2A, con el RFC como PIN y el nombre', () => {
    expect(upsertUserCommand('GOMA850101AB1', 'Ana Rojas')).toBe(
      'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0',
    );
  });

  it('cambia tabs y saltos de línea del nombre por espacios para no romper el formato clave=valor', () => {
    const text = upsertUserCommand('GOMA850101AB1', 'Ana\tRojas\nLópez\r');

    expect(text).toContain('\tName=Ana Rojas López\tPri=0');
    // Solo los 7 separadores del formato (8 campos: PIN, Name, Pri, Passwd, Card, Grp, TZ, Verify).
    expect(text.split('\t')).toHaveLength(8);
    expect(text).not.toMatch(/[\r\n]/);
  });

  it('colapsa espacios repetidos y recorta los extremos', () => {
    expect(upsertUserCommand('X', '  Ana   María  ')).toContain('Name=Ana María\t');
  });

  it('conserva los acentos', () => {
    expect(upsertUserCommand('X', 'José Peña')).toContain('Name=José Peña\t');
  });
});

describe('deleteUserCommand', () => {
  it('arma el texto de baja por PIN (pendiente de confirmar en el equipo)', () => {
    expect(deleteUserCommand('GOMA850101AB1')).toBe('DATA DELETE USERINFO PIN=GOMA850101AB1');
  });
});
