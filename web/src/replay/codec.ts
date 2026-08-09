/*
 * Tapes as text.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * A tape is bytes, and several of the places one has to sit are strings: a JSON body, a clipboard,
 * a storage slot. `btoa`/`atob` are the only base64 that exists unprefixed in both the browser and
 * the Worker runtime this has to run in, so that is what these use — no `Buffer`, no dependency.
 * The cost is having to hand them latin1 a chunk at a time.
 */

/** Base64 of a tape's bytes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // apply() blows the argument limit somewhere above this
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Back again. Throws on anything that is not base64, which every caller has to expect. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
