/*
 * The small amount of HTTP this service actually needs.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Errors are a code and a message, in that order of importance: the client switches on the code
 * and shows the message only when it has nothing better to say. That is the same shape `verify`
 * returns, and it exists for the same reason — every caller is in a UI path that has to degrade
 * rather than break.
 */

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function fail(code: string, status: number, message?: string): Response {
  return json(message ? { error: code, message } : { error: code }, status);
}

/** Bodies are small and known; anything larger is not a mistake, it is an attempt. */
export const MAX_JSON_BYTES = 8 * 1024;

export type BodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Read a JSON object body, refusing anything oversized before parsing it.
 *
 * Returns a response rather than throwing, so a handler reads as a straight line of guards.
 */
export async function readJson(request: Request): Promise<BodyResult<Record<string, unknown>>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_JSON_BYTES) return { ok: false, response: fail('too-large', 413) };

  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: fail('bad-body', 400) };
  }
  if (text.length > MAX_JSON_BYTES) return { ok: false, response: fail('too-large', 413) };

  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, response: fail('bad-body', 400) };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, response: fail('bad-body', 400) };
  }
}

/** A string field, trimmed, or null if it is missing, the wrong type, or out of bounds. */
export function str(body: Record<string, unknown>, key: string, max: number): string | null {
  const v = body[key];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

export function cookies(request: Request): Map<string, string> {
  const out = new Map<string, string>();
  const header = request.headers.get('cookie');
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * `SameSite=Lax` rather than `Strict`: the verification link arrives from a mail client, and a
 * Strict cookie would not be sent on that first navigation, so following the link would land the
 * player on a page that does not know who they are.
 */
export function setCookie(name: string, value: string, maxAgeSeconds: number, path = '/'): string {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join('; ');
}

export function clearCookie(name: string, path = '/'): string {
  return `${name}=; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * A redirect to a path on this site, setting any number of cookies on the way.
 *
 * Relative on purpose: the page that follows it is whichever origin the browser is already on,
 * which is the deployment in production and the dev server in development, without either
 * having to be told.
 */
export function redirect(location: string, ...setCookies: string[]): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

/** The caller's address, for rate limiting. Cloudflare sets this and strips any client copy. */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? '0.0.0.0';
}
