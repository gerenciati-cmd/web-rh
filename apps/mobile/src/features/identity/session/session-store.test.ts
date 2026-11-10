import type { SessionUser } from '@rrhh/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deletePersistedSession,
  getCurrentToken,
  loadPersistedSession,
  persistSession,
  setCurrentSession,
  type StoredSession,
} from './session-store';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'ios' },
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
  deleteItemAsync: mocks.deleteItemAsync,
}));

const user: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'persona@example.com',
  employeeId: null,
};
const future = new Date(Date.now() + 86_400_000).toISOString();
const session: StoredSession = { token: 'tok', user, expiresAt: future };

beforeEach(() => {
  mocks.platform.OS = 'ios';
  mocks.getItemAsync.mockReset();
  mocks.setItemAsync.mockReset();
  mocks.deleteItemAsync.mockReset();
  setCurrentSession(null);
});

describe('sesión en memoria', () => {
  it('no hay token hasta fijar una sesión y vuelve a null al limpiarla', () => {
    expect(getCurrentToken()).toBeNull();
    setCurrentSession(session);
    expect(getCurrentToken()).toBe('tok');
    setCurrentSession(null);
    expect(getCurrentToken()).toBeNull();
  });

  it('fijar la sesión no toca el almacén del dispositivo', () => {
    setCurrentSession(session);
    expect(mocks.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('persistSession', () => {
  it('guarda el JSON bajo la clave rrhh.session en nativo', async () => {
    await persistSession(session);
    expect(mocks.setItemAsync).toHaveBeenCalledWith('rrhh.session', JSON.stringify(session));
  });

  it('no hace nada en web', async () => {
    mocks.platform.OS = 'web';
    await persistSession(session);
    expect(mocks.setItemAsync).not.toHaveBeenCalled();
  });
});

describe('loadPersistedSession', () => {
  it('devuelve la sesión guardada y vigente', async () => {
    mocks.getItemAsync.mockResolvedValue(JSON.stringify(session));
    await expect(loadPersistedSession()).resolves.toEqual(session);
    expect(mocks.getItemAsync).toHaveBeenCalledWith('rrhh.session');
    expect(mocks.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('devuelve null sin tocar el almacén en web', async () => {
    mocks.platform.OS = 'web';
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mocks.getItemAsync).not.toHaveBeenCalled();
  });

  it('devuelve null sin borrar nada cuando no hay sesión guardada', async () => {
    mocks.getItemAsync.mockResolvedValue(null);
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mocks.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('borra y devuelve null si el JSON es inválido', async () => {
    mocks.getItemAsync.mockResolvedValue('{no es json');
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith('rrhh.session');
  });

  it.each([
    ['token', { user, expiresAt: future }],
    ['token vacío', { token: '', user, expiresAt: future }],
    ['user', { token: 'tok', expiresAt: future }],
    ['expiresAt', { token: 'tok', user }],
  ])('borra y devuelve null si falta %s', async (_name, value) => {
    mocks.getItemAsync.mockResolvedValue(JSON.stringify(value));
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith('rrhh.session');
  });

  it('borra y devuelve null si la sesión ya venció', async () => {
    const expired = { ...session, expiresAt: new Date(Date.now() - 1000).toISOString() };
    mocks.getItemAsync.mockResolvedValue(JSON.stringify(expired));
    await expect(loadPersistedSession()).resolves.toBeNull();
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith('rrhh.session');
  });
});

describe('deletePersistedSession', () => {
  it('borra la clave en nativo', async () => {
    await deletePersistedSession();
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith('rrhh.session');
  });

  it('no hace nada en web', async () => {
    mocks.platform.OS = 'web';
    await deletePersistedSession();
    expect(mocks.deleteItemAsync).not.toHaveBeenCalled();
  });
});
