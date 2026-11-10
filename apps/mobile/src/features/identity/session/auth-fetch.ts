let unauthorizedHandler: ((rejectedToken: string) => void) | null = null;

/**
 * Registra quién reacciona cuando el API rechaza un token que sí se envió. Recibe el token
 * rechazado para que pueda ignorar un 401 tardío de una sesión que ya no es la vigente.
 */
export function setUnauthorizedHandler(handler: ((rejectedToken: string) => void) | null): void {
  unauthorizedHandler = handler;
}

function readAuthorization(headers: HeadersInit | undefined): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get('authorization');
  if (Array.isArray(headers)) {
    const entry = headers.find(([name]) => name.toLowerCase() === 'authorization');
    return entry ? entry[1] : null;
  }
  const name = Object.keys(headers).find((key) => key.toLowerCase() === 'authorization');
  return name === undefined ? null : (headers[name] ?? null);
}

/**
 * `fetch` que avisa de las sesiones vencidas o revocadas. Solo cuenta un 401 si la petición llevaba
 * token: el 401 del propio login (credenciales incorrectas) no es una sesión vencida.
 */
export const authFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) {
    const authorization = readAuthorization(init?.headers);
    if (authorization !== null) {
      unauthorizedHandler?.(authorization.replace(/^Bearer\s+/i, ''));
    }
  }
  return response;
};
