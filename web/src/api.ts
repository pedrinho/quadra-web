/*
 * Talking to the service.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Nothing in here throws. Every caller is in a path that has to keep working when the service
 * does not — the game must start, play and finish with the API down, the way sound already
 * degrades when the audio bank fails to load — so a failure is a value with a code on it, the
 * same shape `verify` returns and for the same reason.
 *
 * There is no token to manage. The session is an HttpOnly cookie the browser sends by itself,
 * which is why the Worker serves the page as well as the API: same origin, first-party cookie,
 * and nothing signed-in kept anywhere a script can reach.
 */

export interface ApiFailure {
  ok: false;
  /**
   * The server's own code where there is one. Two are invented here: `offline` when the request
   * never landed at all, and `unavailable` for any 5xx — a service that failed and a service
   * that cannot be reached are the same thing from a page that has a game to get on with, and
   * a proxy in front of a stopped Worker produces the second while meaning the first.
   */
  code: string;
  message?: string;
  status: number;
}

/** Neither of these is the caller's fault, and neither is worth interrupting a game over. */
export function isUnreachable(failure: ApiFailure): boolean {
  return failure.code === 'offline' || failure.code === 'unavailable';
}

export type ApiResult<T> = ({ ok: true } & T) | ApiFailure;

export interface Account {
  id: string;
  displayName: string;
  email: string;
  verified: boolean;
  createdAt: number;
}

/** A row on the board. The score is what the server's replay of the tape produced. */
export interface BoardRun {
  rank: number;
  id: string;
  player: string;
  score: number;
  lines: number;
  level: number;
  frames: number;
  ticks: number;
  over: boolean;
  startedAt: number;
  verifiedAt: number;
  seed: string;
  simVersion: number;
}

export interface Grant {
  grant: string;
  /** Decimal: a seed is 64 bits, which a JSON number cannot hold. */
  seed: string;
  expiresAt: number;
}

const BASE = '/v1';

export class Api {
  /**
   * What `/auth/me` last said, so the page can render a signed-in state without a round trip on
   * every glance. `refresh()` is the only thing that sets it.
   */
  account: Account | null = null;
  /** False once a request fails to land at all — the page says so rather than looking broken. */
  reachable = true;

  async refresh(): Promise<Account | null> {
    const res = await this.get<{ player: Account | null }>('/auth/me');
    this.account = res.ok ? res.player : null;
    return this.account;
  }

  register(email: string, password: string, displayName: string) {
    return this.post<{ sent: boolean }>('/auth/register', { email, password, displayName });
  }

  login(email: string, password: string) {
    return this.player('/auth/login', { email, password });
  }

  verifyEmail(token: string) {
    return this.player('/auth/verify', { token });
  }

  resendVerification(email: string) {
    return this.post<{ sent: boolean }>('/auth/resend', { email });
  }

  forgot(email: string) {
    return this.post<{ sent: boolean }>('/auth/forgot', { email });
  }

  resetPassword(token: string, password: string) {
    return this.player('/auth/reset', { token, password });
  }

  async logout(): Promise<void> {
    await this.post('/auth/logout', {});
    this.account = null;
  }

  deleteAccount(password: string) {
    return this.send<{ ok: true }>('DELETE', '/auth/me', { body: { password } });
  }

  /** A seed for a run that is going to count. */
  startRun() {
    return this.post<Grant>('/runs/start', {});
  }

  /**
   * Offer a finished run to the board.
   *
   * The tape goes as raw bytes rather than base64 in a JSON field: it can be a quarter of a
   * megabyte, and base64 would make that a third larger on the one request where size matters.
   */
  submitRun(grant: string, tape: Uint8Array) {
    return this.send<{ run: BoardRun; rank: number }>('POST', '/runs', {
      body: tape,
      headers: { 'content-type': 'application/octet-stream', 'x-quadra-grant': grant },
    });
  }

  leaderboard(board: 'all' | 'daily' = 'all', limit = 20) {
    return this.get<{ runs: BoardRun[] }>(`/leaderboard?board=${board}&limit=${limit}`);
  }

  run(id: string) {
    return this.get<{ run: BoardRun }>(`/runs/${encodeURIComponent(id)}`);
  }

  /** The bytes behind a row. What makes every row on the board watchable. */
  async tape(id: string): Promise<ApiResult<{ bytes: Uint8Array }>> {
    try {
      const res = await fetch(`${BASE}/runs/${encodeURIComponent(id)}/tape`);
      this.reachable = true;
      if (!res.ok) return { ok: false, code: 'not-found', status: res.status };
      return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch {
      this.reachable = false;
      return { ok: false, code: 'offline', status: 0 };
    }
  }

  /* --- internals --------------------------------------------------------- */

  private player(path: string, body: unknown) {
    return this.post<{ player: Account }>(path, body);
  }

  private get<T>(path: string) {
    return this.send<T>('GET', path, {});
  }

  private post<T>(path: string, body: unknown) {
    return this.send<T>('POST', path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  private async send<T>(
    method: string,
    path: string,
    opts: { body?: BodyInit | unknown; headers?: Record<string, string> },
  ): Promise<ApiResult<T>> {
    const init: RequestInit = { method, headers: opts.headers ?? {} };
    if (opts.body !== undefined) init.body = opts.body as BodyInit;
    if (method === 'DELETE' && opts.body !== undefined) {
      init.body = JSON.stringify(opts.body);
      init.headers = { 'content-type': 'application/json' };
    }

    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, init);
      this.reachable = true;
    } catch {
      // Offline, or nothing listening. Not an error to show a stack trace for — the page has a
      // perfectly good game to be getting on with.
      this.reachable = false;
      return { ok: false, code: 'offline', status: 0 };
    }

    let body: Record<string, unknown> = {};
    if (res.headers.get('content-type')?.includes('json')) {
      try {
        const parsed: unknown = await res.json();
        if (typeof parsed === 'object' && parsed !== null) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        /* a body that does not parse is a server problem, and `status` already says so */
      }
    }

    if (!res.ok) {
      if (res.status >= 500) return { ok: false, code: 'unavailable', status: res.status };
      const code = typeof body['error'] === 'string' ? body['error'] : `http-${res.status}`;
      const message = typeof body['message'] === 'string' ? body['message'] : undefined;
      return { ok: false, code, status: res.status, ...(message ? { message } : {}) };
    }
    return { ok: true, ...(body as T) };
  }
}

/**
 * Something to show a player for a code the page has no better words for.
 *
 * Deliberately not exhaustive: the call sites that care about a particular failure name it
 * themselves, and this is what is left.
 */
export function apiMessage(failure: ApiFailure): string {
  switch (failure.code) {
    case 'offline':
    case 'unavailable':
      return 'Could not reach the board.';
    case 'rate-limited':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'unauthenticated':
      return 'You are not signed in.';
    case 'unverified':
      return 'Confirm your e-mail address first.';
    case 'bad-credentials':
      return 'That e-mail and password do not match.';
    case 'bad-email':
      return 'That does not look like an e-mail address.';
    case 'bad-name':
      return '3 to 20 characters, and at least one of them a letter or a digit.';
    case 'name-taken':
      return 'Somebody already plays under that name.';
    case 'bad-password-too-short':
      return 'Ten characters or more, please.';
    case 'bad-password-too-long':
      return 'That password is too long.';
    case 'bad-password-too-obvious':
      return 'Pick something less guessable.';
    case 'bad-token':
      return 'That link has expired or has already been used.';
    default:
      return failure.message ?? 'Something went wrong.';
  }
}
