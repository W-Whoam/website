// The "video" feel of the original clip: it flickers between two colour states
// (pattern measured frame by frame from the source), plus moving film grain.
import type { Film } from './model';

/** Scene image in both flicker states. */
export interface FilmScene {
  a: HTMLCanvasElement;
  b: HTMLCanvasElement;
}

/** b-state: colours through the measured 3x3 matrix (out_c = sum_k in_k * M[k][c]). */
export function tint(src: HTMLCanvasElement, m: number[][]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r === 0 && g === 0 && b === 0) continue;
    d[i] = r * m[0][0] + g * m[1][0] + b * m[2][0];
    d[i + 1] = r * m[0][1] + g * m[1][1] + b * m[2][1];
    d[i + 2] = r * m[0][2] + g * m[1][2] + b * m[2][2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function stateAt(film: Film, t: number): 'a' | 'b' {
  const p = film.pattern;
  return p[Math.floor(t * film.fps) % p.length] === 'b' ? 'b' : 'a';
}

// Grain: a few tiles of gaussian noise around mid-grey, blended with "overlay"
// at a random offset each frame, so it moves like film grain.
const TILE = 256;
const tiles: HTMLCanvasElement[] = [];
function grainTiles(): HTMLCanvasElement[] {
  if (tiles.length) return tiles;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      const g = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
      const v = Math.max(0, Math.min(255, 128 + g * 46));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    tiles.push(c);
  }
  return tiles;
}

/** Draw one video frame: flicker state for time t, then grain for frame number n. */
export function drawFilmFrame(ctx: CanvasRenderingContext2D, s: FilmScene, film: Film, t: number, n: number,
  w: number, h: number, grain = true) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(stateAt(film, t) === 'b' ? s.b : s.a, 0, 0, w, h);
  if (grain && film.grain > 0) {
    const ts = grainTiles();
    const pat = ctx.createPattern(ts[n % ts.length], 'repeat')!;
    const ox = (n * 97) % TILE, oy = (n * 61) % TILE;
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = film.grain;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pat;
    ctx.fillRect(ox, oy, w, h);
  }
  ctx.restore();
}
