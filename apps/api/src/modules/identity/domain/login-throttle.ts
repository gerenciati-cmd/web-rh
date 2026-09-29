import { Entity, type Email } from '@rrhh/domain';

export interface LoginThrottlePolicy {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
}

export interface LoginThrottleProps {
  failures: number;
  windowStartedAt: Date;
  blockedUntil: Date | null;
}

/**
 * Contador de intentos fallidos de login, con clave por correo o por IP (defensa en
 * dos frentes: un atacante que rota de correo sigue topando con el límite de su IP).
 */
export class LoginThrottle extends Entity<string> {
  private constructor(
    key: string,
    private props: LoginThrottleProps,
  ) {
    super(key);
  }

  static keyForEmail(email: Email): string {
    return `email:${email.value}`;
  }

  static keyForIp(ip: string): string {
    return `ip:${ip}`;
  }

  static fresh(key: string, now: Date): LoginThrottle {
    return new LoginThrottle(key, { failures: 0, windowStartedAt: now, blockedUntil: null });
  }

  static restore(key: string, props: LoginThrottleProps): LoginThrottle {
    return new LoginThrottle(key, props);
  }

  /** `null` si nunca fue bloqueado o si el bloqueo ya venció. */
  blockedUntilAt(now: Date): Date | null {
    if (!this.props.blockedUntil) return null;
    return this.props.blockedUntil > now ? this.props.blockedUntil : null;
  }

  registerFailure(now: Date, policy: LoginThrottlePolicy): void {
    let { failures, windowStartedAt, blockedUntil } = this.props;
    if (now.getTime() - windowStartedAt.getTime() >= policy.windowMs) {
      failures = 0;
      windowStartedAt = now;
      blockedUntil = null;
    }
    failures += 1;
    if (failures >= policy.maxFailures) {
      blockedUntil = new Date(now.getTime() + policy.blockMs);
    }
    this.props = { failures, windowStartedAt, blockedUntil };
  }

  clear(now: Date): void {
    this.props = { failures: 0, windowStartedAt: now, blockedUntil: null };
  }

  get snapshot(): Readonly<LoginThrottleProps> {
    return this.props;
  }
}
