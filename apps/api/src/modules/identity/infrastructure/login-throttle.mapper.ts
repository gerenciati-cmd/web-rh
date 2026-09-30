import type { LoginThrottle as LoginThrottleRow } from '@/infrastructure/database/generated/client';

import { LoginThrottle } from '../domain/login-throttle';

export const LoginThrottleMapper = {
  toDomain(row: LoginThrottleRow): LoginThrottle {
    return LoginThrottle.restore(row.key, {
      failures: row.failures,
      windowStartedAt: row.windowStartedAt,
      blockedUntil: row.blockedUntil,
    });
  },

  toPersistence(throttle: LoginThrottle) {
    const s = throttle.snapshot;
    return {
      key: throttle.id,
      failures: s.failures,
      windowStartedAt: s.windowStartedAt,
      blockedUntil: s.blockedUntil,
    };
  },
};
