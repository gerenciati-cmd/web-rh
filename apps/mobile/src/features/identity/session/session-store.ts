import type { SessionUser } from '@rrhh/contracts';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface StoredSession {
  token: string;
  user: SessionUser;
  expiresAt: string;
}

const SESSION_KEY = 'rrhh.session';

let currentSession: StoredSession | null = null;

/**
 * Token de la sesión activa. Es síncrono porque `api-client` lo lee en cada petición.
 */
export function getCurrentToken(): string | null {
  return currentSession?.token ?? null;
}

/** Fija la sesión en memoria; no toca el almacenamiento del dispositivo. */
export function setCurrentSession(session: StoredSession | null): void {
  currentSession = session;
}

/**
 * Guarda la sesión en el almacén seguro del dispositivo. En web no se persiste: un token de larga
 * vida no debe quedar en el almacenamiento del navegador.
 */
export async function persistSession(session: StoredSession): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.token === 'string' &&
    candidate.token.length > 0 &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.user === 'object' &&
    candidate.user !== null
  );
}

/**
 * Recupera la sesión recordada. Si está corrupta o vencida se borra para no reintentarla.
 */
export async function loadPersistedSession(): Promise<StoredSession | null> {
  if (Platform.OS === 'web') return null;
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!isStoredSession(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
  return parsed;
}

export async function deletePersistedSession(): Promise<void> {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
