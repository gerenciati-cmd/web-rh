import type { LoginThrottle } from '../../domain/login-throttle';
import type { LoginThrottleRepository } from '../../domain/login-throttle.repository';

export class InMemoryLoginThrottleRepository implements LoginThrottleRepository {
  readonly throttles = new Map<string, LoginThrottle>();

  find(key: string): Promise<LoginThrottle | null> {
    return Promise.resolve(this.throttles.get(key) ?? null);
  }

  save(throttle: LoginThrottle): Promise<void> {
    this.throttles.set(throttle.id, throttle);
    return Promise.resolve();
  }
}
