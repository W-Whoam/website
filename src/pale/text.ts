// Draws game-style text onto the scene: flat raster -> perspective warp onto the
// fitted UI plane -> core + glow layers -> colour/falloff -> added to the frame.
import { gaussian } from './blur';
import { FONT_FAMILY, type Model, type Slot } from './model';

const measureCanvas = document.createElement('canvas');
const mctx = measureCanvas.getContext('2d')!;

function font(weight: number, px: number) {
  return `${weight} ${px}px ${FONT_FAMILY}`;
}

/** Advance width of `text` in plane units at font size `size`. */
export function textWidth(text: string, weight: number, size: number, ss: number): number {
  mctx.font = font(weight, size * ss);
  return mctx.measureText(text).width / ss;
}

interface Raster {
  data: Float32Array;
  w: number;
  h: number;
  pad: number;
  baseY: number;
}

function rasterize(text: string, weight: number, size: number, ss: number): Raster {
  const px = size * ss;
  mctx.font = font(weight, px);
  const m = mctx.measureText(text);
  const asc = Math.ceil(Math.max(m.actualBoundingBoxAscent, px * 0.95));
  const desc = Math.ceil(Math.max(m.actualBoundingBoxDescent, px * 0.3));
  const pad = 8 * ss;
  const w = Math.max(1, Math.ceil(m.width + Math.max(0, m.actualBoundingBoxRight - m.width)) + 2 * pad);
  const h = asc + desc + 2 * pad;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = font(weight, px);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  const baseY = pad + asc;
  ctx.fillText(text, pad, baseY);
  const id = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = id[i * 4 + 3] / 255;
  return { data, w, h, pad, baseY };
}

class Plane {
  x0: number; y0: number; p: number;
  a: number[]; b: number[];
  constructor(params: Slot['params']) {
    const [x0, y0, th, k, s, p] = params;
    const c = Math.cos(th), si = Math.sin(th);
    // A = s * R(th) * [[1,-k],[0,1]]
    const a00 = s * c, a01 = s * (-c * k - si), a10 = s * si, a11 = s * (-si * k + c);
    const det = a00 * a11 - a01 * a10;
    this.a = [a00, a01, a10, a11];
    this.b = [a11 / det, -a01 / det, -a10 / det, a00 / det];
    this.x0 = x0; this.y0 = y0; this.p = p;
  }
  fwd(u: number, v: number): [number, number] {
    const w = 1 + this.p * u;
    const [a00, a01, a10, a11] = this.a;
    return [this.x0 + (a00 * u + a01 * v) / w, this.y0 + (a10 * u + a11 * v) / w];
  }
  inv(X: number, Y: number): [number, number] {
    const dx = X - this.x0, dy = Y - this.y0;
    const [b00, b01, b10, b11] = this.b;
    const b0 = b00 * dx + b01 * dy, b1 = b10 * dx + b11 * dy;
    const den = 1 - this.p * b0;
    return [b0 / den, b1 / den];
  }
}

export interface Region { x: number; y: number; w: number; h: number; }

const SUB = 4; // supersampling per axis

/** Warp a flat text raster onto the plane; returns alpha for `region`. */
function warp(r: Raster, plane: Plane, uOff: number, vOff: number, ss: number, region: Region, into: Float32Array) {
  const { data, w: rw, h: rh, pad, baseY } = r;
  const sample = (fx: number, fy: number) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < -1 || y0 < -1 || x0 >= rw || y0 >= rh) return 0;
    const tx = fx - x0, ty = fy - y0;
    const g = (x: number, y: number) => (x < 0 || y < 0 || x >= rw || y >= rh ? 0 : data[y * rw + x]);
    return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  };
  // bbox of the raster on screen, to skip empty pixels
  const corners = [
    plane.fwd(uOff - pad / ss, vOff - baseY / ss), plane.fwd(uOff + (rw - pad) / ss, vOff - baseY / ss),
    plane.fwd(uOff - pad / ss, vOff + (rh - baseY) / ss), plane.fwd(uOff + (rw - pad) / ss, vOff + (rh - baseY) / ss),
  ];
  const bx0 = Math.max(region.x, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1);
  const by0 = Math.max(region.y, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1);
  const bx1 = Math.min(region.x + region.w, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
  const by1 = Math.min(region.y + region.h, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
  const inv = 1 / (SUB * SUB);
  for (let Y = by0; Y < by1; Y++) {
    for (let X = bx0; X < bx1; X++) {
      let acc = 0;
      for (let j = 0; j < SUB; j++) {
        for (let i = 0; i < SUB; i++) {
          const [u, v] = plane.inv(X + i / SUB, Y + j / SUB);
          acc += sample((u - uOff) * ss + pad, (v - vOff) * ss + baseY);
        }
      }
      if (acc > 0) into[(Y - region.y) * region.w + (X - region.x)] += acc * inv;
    }
  }
}

export interface TextJob {
  slot: Slot;
  text: string;
}

/** Fit text to a slot: shrink factor, size, offsets (centred on the original text). */
export function placeText(model: Model, slot: Slot, text: string) {
  const ow = textWidth(slot.orig, slot.weight, model.size, model.ss);
  let nw = textWidth(text, slot.weight, model.size, model.ss);
  const fac = nw > 0 ? Math.min(1, (ow * slot.maxw) / nw) : 1;
  const size = model.size * fac;
  nw *= fac;
  return { size, uOff: (ow - nw) / 2, vOff: -(1 - fac) * model.size * 0.35 };
}

const GLOW_MARGIN = 72;

/** Render text with glow + falloff and add it onto `img` (RGBA ImageData of the scene). */
export function drawText(img: ImageData, model: Model, slot: Slot, text: string) {
  if (!text.trim()) return;
  const { size, uOff, vOff } = placeText(model, slot, text);
  const plane = new Plane(slot.params);
  const r = rasterize(text, slot.weight, size, model.ss);
  // screen bbox (+ glow margin)
  const pts = [
    plane.fwd(uOff - r.pad / model.ss, vOff - r.baseY / model.ss),
    plane.fwd(uOff + (r.w - r.pad) / model.ss, vOff - r.baseY / model.ss),
    plane.fwd(uOff - r.pad / model.ss, vOff + (r.h - r.baseY) / model.ss),
    plane.fwd(uOff + (r.w - r.pad) / model.ss, vOff + (r.h - r.baseY) / model.ss),
  ];
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]))) - GLOW_MARGIN);
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))) - GLOW_MARGIN);
  const x1 = Math.min(img.width, Math.ceil(Math.max(...pts.map((p) => p[0]))) + GLOW_MARGIN);
  const y1 = Math.min(img.height, Math.ceil(Math.max(...pts.map((p) => p[1]))) + GLOW_MARGIN);
  const region: Region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  if (region.w <= 0 || region.h <= 0) return;
  let alpha: Float32Array = new Float32Array(region.w * region.h);
  warp(r, plane, uOff, vOff, model.ss, region, alpha);
  if (model.blur > 0) alpha = gaussian(alpha, region.w, region.h, model.blur);
  const bases: Float32Array[] = [alpha];
  const nb = slot.coefs[0].length;
  for (let i = 1; i < nb; i++) bases.push(gaussian(alpha, region.w, region.h, model.glow[i - 1]));
  const F = model.falloff;
  const d = img.data;
  for (let yy = 0; yy < region.h; yy++) {
    const Y = yy + region.y;
    const xb = F.x - Math.max(0, Y - F.y) * F.slope;
    for (let xx = 0; xx < region.w; xx++) {
      const X = xx + region.x;
      const k = yy * region.w + xx;
      const sig = 1 / (1 + Math.exp(-(xb - X) / F.width));
      const o = (Y * img.width + X) * 4;
      for (let c = 0; c < 3; c++) {
        const co = slot.coefs[c];
        let v = 0;
        for (let i = 0; i < nb; i++) v += co[i] * bases[i][k];
        if (v === 0) continue;
        const fall = F.floor[c] + (1 - F.floor[c]) * sig;
        const nv = d[o + c] + v * fall;
        d[o + c] = nv < 0 ? 0 : nv > 255 ? 255 : nv;
      }
    }
  }
}
