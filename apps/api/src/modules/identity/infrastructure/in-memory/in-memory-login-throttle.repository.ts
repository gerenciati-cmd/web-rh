import { LoginThrottle } from '../../domain/login-throttle';
import type { LoginThrottleRepository } from '../../domain/login-throttle.repository';

export class InMemoryLoginThrottleRepository implements LoginThrottleRepository {
  readonly throttles = new Map<string, LoginThrottle>();

  /** Sin BD real no hay row lock que simular: alcanza con devolver la fila existente o una
   *  fresca, igual que hacía el `find` anterior. */
  lock(key: string, now: Date): Promise<LoginThrottle> {
    return Promise.resolve(this.throttles.get(key) ?? LoginThrottle.fresh(key, now));
  }

  save(throttle: LoginThrottle): Promise<void> {
    this.throttles.set(throttle.id, throttle);
    return Promise.resolve();
  }
}
