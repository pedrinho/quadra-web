import { env } from 'cloudflare:test';
import worker from '../src/index.js';
import { COOKIE } from '../src/session.js';

export const ORIGIN = 'https://quadra.test';

/** Whatever the mailer printed, most recent first. Development sends go to the console. */
export const mailbox: { to: string; text: string }[] = [];

/**
 * Capture what the mailer would have sent.
 *
 * With no API key configured `send` logs the message, so reading the log *is* reading the
 * outbox — and it keeps the tests exercising the real code path rather than a mail stub.
 */
export function captureMail(): void {
  const original = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    const match = /^\[mail\] to ([^:]+): (.*)$/s.exec(line);
    if (match) mailbox.unshift({ to: match[1]!, text: match[2]! });
    else original(...args);
  };
}

/** The most recent link of a given kind sent to an address. */
export function linkFor(to: string, param: 'verify' | 'reset'): string | null {
  const mail = mailbox.find((m) => m.to.toLowerCase() === to.toLowerCase() && m.text.includes(`?${param}=`));
  if (!mail) return null;
  return new RegExp(`\\?${param}=([A-Za-z0-9_-]+)`).exec(mail.text)?.[1] ?? null;
}

export async function reset(): Promise<void> {
  mailbox.length = 0;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs'),
    env.DB.prepare('DELETE FROM grants'),
    env.DB.prepare('DELETE FROM email_tokens'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM identities'),
    env.DB.prepare('DELETE FROM signups'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM rate_limits'),
  ]);
}

export interface CallOptions {
  body?: unknown;
  cookie?: string | null;
  /** Rate limits are per address, so tests that must not collide vary this. */
  ip?: string;
  raw?: BodyInit;
  headers?: Record<string, string>;
  /** Bindings to change for this one request, e.g. to switch a sign-in method off. */
  env?: Partial<typeof env>;
}

export interface Call {
  status: number;
  body: Record<string, unknown>;
  cookie: string | null;
  response: Response;
}

/** One request through the real Worker entry point, exactly as Cloudflare would deliver it. */
export async function call(
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<Call> {
  const headers: Record<string, string> = {
    'cf-connecting-ip': opts.ip ?? '203.0.113.1',
    ...opts.headers,
  };
  if (opts.cookie) headers['cookie'] = `${COOKIE}=${opts.cookie}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const init: RequestInit = { method, headers };
  if (opts.raw !== undefined) init.body = opts.raw;
  else if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, init),
    opts.env ? { ...env, ...opts.env } : env,
  );

  // Only JSON gets parsed. A tape comes back as bytes, and reading those as text would both
  // corrupt them and make the runtime say so at length.
  let body: Record<string, unknown> = {};
  if (response.headers.get('content-type')?.includes('json')) {
    try {
      const parsed: unknown = JSON.parse(await response.clone().text());
      if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
    } catch {
      /* a malformed JSON response is a failure a test should see as an empty body */
    }
  }

  return { status: response.status, body, cookie: tokenFrom(response), response };
}

/** The session token out of a `Set-Cookie`, if the response set one. */
export function tokenFrom(response: Response): string | null {
  return cookieFrom(response, COOKIE);
}

/** A cookie's value out of the response's `Set-Cookie`s, which may be several. */
export function cookieFrom(response: Response, name: string): string | null {
  // Workers' own `getAll`, which exists for exactly this header: `get` would join them with commas.
  for (const header of response.headers.getAll('set-cookie')) {
    if (!header.startsWith(`${name}=`)) continue;
    const value = header.slice(name.length + 1, header.indexOf(';'));
    return value.length > 0 ? value : null;
  }
  return null;
}

export const GOOD_PASSWORD = 'a-perfectly-fine-password';

/** Register, follow the link, and come back signed in. */
export async function registerVerified(
  email: string,
  displayName: string,
  password = GOOD_PASSWORD,
): Promise<string> {
  const created = await call('POST', '/v1/auth/register', {
    body: { email, password, displayName },
    ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
  });
  if (created.status !== 202) throw new Error(`register failed: ${created.status}`);

  const token = linkFor(email, 'verify');
  if (!token) throw new Error(`no verification link for ${email}`);

  const verified = await call('POST', '/v1/auth/verify', { body: { token } });
  if (!verified.cookie) throw new Error(`verify failed: ${verified.status}`);
  return verified.cookie;
}
