import { AggregateRoot, createEvent, type Id } from '@rrhh/domain';

import type { UserId } from './user';

export type SessionId = Id<'Session'>;

export const SESSION_CLIENTS = ['WEB', 'MOBILE'] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];

export interface SessionLifetime {
  absoluteMs: number;
  /** `null` = sin expiración por inactividad (mobile, README decisión 5). */
  idleMs: number | null;
}

export type SessionPolicy = Record<SessionClient, SessionLifetime>;

export const SESSION_STARTED = 'identity.session.started';
export const SESSION_REVOKED = 'identity.session.revoked';

/** Cuánto esperar entre escrituras de `lastSeenAt`: evita un UPDATE por cada request. */
const TOUCH_INTERVAL_MS = 60_000;

export interface SessionProps {
  userId: UserId;
  tokenHash: string;
  client: SessionClient;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  idleTimeoutMs: number | null;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
}

/** Sesión opaca server-side (ADR 0011): el token solo existe hasheado aquí; nunca en claro. */
export class Session extends AggregateRoot<SessionId> {
  private constructor(
    id: SessionId,
    private props: SessionProps,
  ) {
    super(id);
  }

  static start(input: {
    id: SessionId;
    userId: UserId;
    tokenHash: string;
    client: SessionClient;
    lifetime: SessionLifetime;
    now: Date;
    ip: string | null;
    userAgent: string | null;
  }): Session {
    const session = new Session(input.id, {
      userId: input.userId,
      tokenHash: input.tokenHash,
      client: input.client,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: new Date(input.now.getTime() + input.lifetime.absoluteMs),
      idleTimeoutMs: input.lifetime.idleMs,
      revokedAt: null,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    session.record(
      createEvent(
        SESSION_STARTED,
        { sessionId: input.id, userId: input.userId, client: input.client },
        input.now,
      ),
    );
    return session;
  }

  static restore(id: SessionId, props: SessionProps): Session {
    return new Session(id, props);
  }

  isActiveAt(now: Date): boolean {
    if (this.props.revokedAt) return false;
    if (now >= this.props.expiresAt) return false;
    if (this.props.idleTimeoutMs === null) return true;
    return now.getTime() - this.props.lastSeenAt.getTime() < this.props.idleTimeoutMs;
  }

  needsTouch(now: Date): boolean {
    return now.getTime() - this.props.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
  }

  touch(now: Date): void {
    this.props = { ...this.props, lastSeenAt: now };
  }

  revoke(now: Date): void {
    if (this.props.revokedAt) return;
    this.props = { ...this.props, revokedAt: now };
    this.record(
      createEvent(SESSION_REVOKED, { sessionId: this.id, userId: this.props.userId }, now),
    );
  }

  get snapshot(): Readonly<SessionProps> {
    return this.props;
  }
}
