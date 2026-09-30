import { Entity, type Email } from '@rrhh/domain';

export interface LoginThrottlePolicy {
  maxFailures: number;
  windowMs: number;
  blockMs: number;
}

/** Límites separados por correo y por IP (M2): una IP compartida (oficina, reverse proxy) no
 *  debe agotar, con el límite pensado para un atacante, el login de todo el mundo detrás de ella. */
export interface LoginThrottlePolicies {
  email: LoginThrottlePolicy;
  ip: LoginThrottlePolicy;
}

export interface LoginThrottleProps {
  /** Intentos (reservas) contados en la ventana actual, incluidos los aún no verificados. */
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

  /**
   * Reserva un intento ANTES de verificar la contraseña (H3, README decisión 11): el repositorio
   * llama a esto bajo un row lock, así que una ráfaga concurrente serializa sus reservas en vez
   * de leer el mismo contador y perder incrementos.
   */
  registerAttempt(now: Date, policy: LoginThrottlePolicy): void {
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

  /**
   * Deshace la reserva de UN intento: lo usa `LogIn` cuando la contraseña resultó correcta (no
   * consumir el cupo de la IP por un login ajeno exitoso) o cuando otra llave de la misma
   * petición terminó bloqueada. El bloqueo, si lo hay, pudo fijarlo esta reserva o una
   * concurrente: restar el intento sigue siendo correcto porque el bloqueo solo se levanta si
   * los fallos bajan del máximo.
   */
  releaseAttempt(policy: LoginThrottlePolicy): void {
    const failures = Math.max(0, this.props.failures - 1);
    const blockedUntil = failures < policy.maxFailures ? null : this.props.blockedUntil;
    this.props = { ...this.props, failures, blockedUntil };
  }

  clear(now: Date): void {
    this.props = { failures: 0, windowStartedAt: now, blockedUntil: null };
  }

  get snapshot(): Readonly<LoginThrottleProps> {
    return this.props;
  }
}
