import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { LoginThrottle, type LoginThrottlePolicy } from './login-throttle';

const now = new Date('2026-01-15T12:00:00Z');
const POLICY: LoginThrottlePolicy = { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

function email(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('LoginThrottle', () => {
  it('keyForEmail y keyForIp arman claves distintas y estables', () => {
    expect(LoginThrottle.keyForEmail(email('ana@aps.cl'))).toBe('email:ana@aps.cl');
    expect(LoginThrottle.keyForIp('10.0.0.1')).toBe('ip:10.0.0.1');
  });

  it('fresh arranca sin fallos ni bloqueo', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);

    expect(throttle.snapshot).toEqual({ failures: 0, windowStartedAt: now, blockedUntil: null });
    expect(throttle.blockedUntilAt(now)).toBeNull();
  });

  it('registrar fallos por debajo del máximo no bloquea', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);

    for (let i = 0; i < POLICY.maxFailures - 1; i++) throttle.registerAttempt(now, POLICY);

    expect(throttle.snapshot.failures).toBe(POLICY.maxFailures - 1);
    expect(throttle.blockedUntilAt(now)).toBeNull();
  });

  it('llegar al máximo de fallos bloquea hasta now + blockMs', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);

    for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerAttempt(now, POLICY);

    expect(throttle.snapshot.failures).toBe(POLICY.maxFailures);
    expect(throttle.blockedUntilAt(now)).toEqual(new Date(now.getTime() + POLICY.blockMs));
  });

  it('blockedUntilAt vuelve a null una vez que el bloqueo venció', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);
    for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerAttempt(now, POLICY);

    const afterBlock = new Date(now.getTime() + POLICY.blockMs + 1);

    expect(throttle.blockedUntilAt(afterBlock)).toBeNull();
  });

  it('la ventana se reinicia tras windowMs sin resetear manualmente', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);
    for (let i = 0; i < POLICY.maxFailures - 1; i++) throttle.registerAttempt(now, POLICY);
    expect(throttle.snapshot.failures).toBe(POLICY.maxFailures - 1);

    const afterWindow = new Date(now.getTime() + POLICY.windowMs);
    throttle.registerAttempt(afterWindow, POLICY);

    // La ventana se reinició: este es el primer fallo de la nueva ventana, no el quinto.
    expect(throttle.snapshot.failures).toBe(1);
    expect(throttle.snapshot.windowStartedAt).toEqual(afterWindow);
    expect(throttle.blockedUntilAt(afterWindow)).toBeNull();
  });

  it('clear resetea fallos, ventana y bloqueo', () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);
    for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerAttempt(now, POLICY);
    expect(throttle.blockedUntilAt(now)).not.toBeNull();

    const later = new Date(now.getTime() + 1000);
    throttle.clear(later);

    expect(throttle.snapshot).toEqual({ failures: 0, windowStartedAt: later, blockedUntil: null });
    expect(throttle.blockedUntilAt(later)).toBeNull();
  });

  // releaseAttempt (H3/M2, plan 001 paso 15): deshace UNA reserva — la usa `LogIn` cuando la
  // contraseña resultó correcta (no consumir el cupo de la IP por un login ajeno exitoso) o
  // cuando otra llave de la misma petición terminó bloqueada.
  describe('releaseAttempt', () => {
    it('resta un intento reservado', () => {
      const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);
      throttle.registerAttempt(now, POLICY);
      throttle.registerAttempt(now, POLICY);

      throttle.releaseAttempt(POLICY);

      expect(throttle.snapshot.failures).toBe(1);
    });

    it('no baja de cero si se libera sin haber reservado nada', () => {
      const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);

      throttle.releaseAttempt(POLICY);

      expect(throttle.snapshot.failures).toBe(0);
    });

    it('levanta el bloqueo cuando, tras liberar, los fallos vuelven a estar bajo el máximo', () => {
      const throttle = LoginThrottle.fresh('email:ana@aps.cl', now);
      for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerAttempt(now, POLICY);
      expect(throttle.blockedUntilAt(now)).not.toBeNull();

      throttle.releaseAttempt(POLICY);

      expect(throttle.snapshot.failures).toBe(POLICY.maxFailures - 1);
      expect(throttle.blockedUntilAt(now)).toBeNull();
    });
  });
});
