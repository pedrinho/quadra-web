/*
 * Indexed framebuffer — the browser equivalent of Video_bitmap (source/video.h:34-73).
 * Copyright (C) 1998-2000 Ludus Design
 * Copyright (C) 2026 Quadra Web contributors
 * Licensed under the GNU LGPL v2.1 or later. See LICENSE at the repo root.
 *
 * Quadra draws into an 8-bit paletted surface and pushes a 256-colour palette alongside
 * it. Reproducing that rather than drawing RGBA sprites keeps Color::shade, palette
 * swapping per level, fades and index-0 transparency working exactly as they do in the
 * original — all of which are palette tricks that RGBA rendering would have to fake.
 */

export const SCREEN_WIDTH = 640;
export const SCREEN_HEIGHT = 480;

/** Palette index 0 is the transparent key when blitting sprites (source/sprite.cc:37-52). */
export const TRANSPARENT = 0;

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  /** One palette index per pixel. */
  readonly pixels: Uint8Array;
  /** 256 entries, RGB triples. */
  readonly palette = new Uint8Array(768);

  /** Allocated on first present(). Drawing needs no browser; only showing the result does. */
  private rgba: ImageData | null = null;
  private region: ImageData | null = null;

  /* Clip rectangle. The original gets this for free: every pane and board draws into its
   * own Video_bitmap, which is a sub-rectangle view of the screen, so a piece sliding in
   * from above the playfield is clipped at the boundary. */
  private clipX = 0;
  private clipY = 0;
  private clipW = 0;
  private clipH = 0;

  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.clipW = width;
    this.clipH = height;
  }

  /** Restrict drawing to a rectangle, as a Video_bitmap sub-view does. */
  setClip(x: number, y: number, w: number, h: number): void {
    this.clipX = Math.max(0, x);
    this.clipY = Math.max(0, y);
    this.clipW = Math.min(w, this.width - this.clipX);
    this.clipH = Math.min(h, this.height - this.clipY);
  }

  resetClip(): void {
    this.clipX = 0;
    this.clipY = 0;
    this.clipW = this.width;
    this.clipH = this.height;
  }

  /** Run `draw` with a clip rectangle applied, restoring the previous one afterwards. */
  clipped(x: number, y: number, w: number, h: number, draw: () => void): void {
    const [px, py, pw, ph] = [this.clipX, this.clipY, this.clipW, this.clipH];
    this.setClip(x, y, w, h);
    draw();
    this.clipX = px;
    this.clipY = py;
    this.clipW = pw;
    this.clipH = ph;
  }

  setPalette(rgb: Uint8Array): void {
    this.palette.set(rgb.subarray(0, 768));
  }

  clear(index = 0): void {
    this.pixels.fill(index);
  }

  /** Horizontal run. `Video_bitmap::hline`. */
  hline(y: number, x: number, len: number, index: number): void {
    if (y < this.clipY || y >= this.clipY + this.clipH) return;
    let start = x;
    let end = x + len;
    if (start < this.clipX) start = this.clipX;
    if (end > this.clipX + this.clipW) end = this.clipX + this.clipW;
    if (start >= end) return;
    this.pixels.fill(index, y * this.width + start, y * this.width + end);
  }

  /** Vertical run. `Video_bitmap::vline`. */
  vline(x: number, y: number, len: number, index: number): void {
    if (x < this.clipX || x >= this.clipX + this.clipW) return;
    let start = y;
    let end = y + len;
    if (start < this.clipY) start = this.clipY;
    if (end > this.clipY + this.clipH) end = this.clipY + this.clipH;
    for (let yy = start; yy < end; yy++) this.pixels[yy * this.width + x] = index;
  }

  putPel(x: number, y: number, index: number): void {
    if (x < this.clipX || y < this.clipY) return;
    if (x >= this.clipX + this.clipW || y >= this.clipY + this.clipH) return;
    this.pixels[y * this.width + x] = index;
  }

  /** Filled rectangle. `Video_bitmap::box`. */
  box(x: number, y: number, w: number, h: number, index: number): void {
    for (let i = 0; i < h; i++) this.hline(y + i, x, w, index);
  }

  /** Rectangle outline. `Video_bitmap::rect`. */
  rect(x: number, y: number, w: number, h: number, index: number): void {
    this.hline(y, x, w, index);
    this.hline(y + h - 1, x, w, index);
    this.vline(x, y, h, index);
    this.vline(x + w - 1, y, h, index);
  }

  /**
   * Blit an indexed image. With `transparent`, index 0 is skipped, which is how the
   * original does sprite masking.
   */
  putImage(
    src: Uint8Array,
    srcWidth: number,
    srcHeight: number,
    dx: number,
    dy: number,
    transparent = false,
  ): void {
    for (let y = 0; y < srcHeight; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      const srcRow = y * srcWidth;
      const dstRow = ty * this.width;
      for (let x = 0; x < srcWidth; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        const v = src[srcRow + x]!;
        if (transparent && v === TRANSPARENT) continue;
        this.pixels[dstRow + tx] = v;
      }
    }
  }

  /** Copy a sub-rectangle out of an indexed image — used to erase a cell back to the
   *  background, exactly as Canvas::blit_back does (source/canvas.cc:929-958). */
  putImageRegion(
    src: Uint8Array,
    srcWidth: number,
    sx: number,
    sy: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
  ): void {
    for (let y = 0; y < h; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= this.height) continue;
      const srcRow = (sy + y) * srcWidth + sx;
      const dstRow = ty * this.width + dx;
      for (let x = 0; x < w; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= this.width) continue;
        this.pixels[dstRow + x] = src[srcRow + x]!;
      }
    }
  }

  /**
   * Present a sub-rectangle, for a host that shows the playfield rather than the whole 640x480
   * frame. Everything still *draws* into the full frame — the background erase and the palette
   * the blocks are shaded from both depend on the original coordinates — so this only decides
   * how much of it reaches the page.
   */
  presentRegion(ctx: CanvasRenderingContext2D, sx: number, sy: number, w: number, h: number): void {
    if (!this.region || this.region.width !== w || this.region.height !== h) {
      this.region = new ImageData(w, h);
      const d = this.region.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }
    const { pixels, palette } = this;
    const out = this.region.data;
    for (let y = 0; y < h; y++) {
      let src = (sy + y) * this.width + sx;
      let o = y * w * 4;
      for (let x = 0; x < w; x++, src++, o += 4) {
        const p = pixels[src]! * 3;
        out[o] = palette[p]!;
        out[o + 1] = palette[p + 1]!;
        out[o + 2] = palette[p + 2]!;
      }
    }
    ctx.putImageData(this.region, 0, 0);
  }

  /** Expand the indexed buffer through the palette and present it. */
  present(ctx: CanvasRenderingContext2D): void {
    const { pixels, palette } = this;
    if (!this.rgba) {
      this.rgba = new ImageData(this.width, this.height);
      // Alpha is constant; only RGB is rewritten each frame.
      const d = this.rgba.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }
    const out = this.rgba.data;
    for (let i = 0, o = 0; i < pixels.length; i++, o += 4) {
      const p = pixels[i]! * 3;
      out[o] = palette[p]!;
      out[o + 1] = palette[p + 1]!;
      out[o + 2] = palette[p + 2]!;
    }
    ctx.putImageData(this.rgba, 0, 0);
  }
}
