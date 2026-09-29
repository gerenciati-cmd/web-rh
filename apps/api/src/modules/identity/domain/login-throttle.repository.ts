import type { LoginThrottle } from './login-throttle';

export interface LoginThrottleRepository {
  find(key: string): Promise<LoginThrottle | null>;
  save(throttle: LoginThrottle): Promise<void>;
}
