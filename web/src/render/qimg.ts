/*
 * Loader for the .qimg files produced by tools/extract-assets.ts.
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Format: "QIMG", uint16 width, uint16 height, 768-byte RGB palette, width*height indices.
 * These carry the palette indices that a browser PNG decode would discard.
 */

export interface QImage {
  width: number;
  height: number;
  palette: Uint8Array;
  indices: Uint8Array;
}

export function decodeQimg(buf: ArrayBuffer): QImage {
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (magic !== 'QIMG') throw new Error(`not a .qimg file (magic "${magic}")`);

  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  const palette = new Uint8Array(buf, 8, 768);
  const indices = new Uint8Array(buf, 8 + 768, width * height);
  return { width, height, palette, indices };
}

export async function loadQimg(url: string): Promise<QImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status} ${res.statusText}`);
  return decodeQimg(await res.arrayBuffer());
}
