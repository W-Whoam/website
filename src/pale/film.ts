// "Video" feel for preview and video export: a soft light flicker plus moving film grain.
import type { Film } from './model';

// Smooth value noise: a random level every 1/hz seconds, eased between them,
// so the light drifts instead of jumping.
function level(k: number): number {
  let x = (k * 374761393) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
export function flickerAt(film: Film, t: number): number {
  const p = t * film.flicker.hz;
  const k = Math.floor(p);
  const f = p - k;
  const e = f * f * (3 - 2 * f);
  return (level(k) * (1 - e) + level(k + 1) * e) * film.flicker.amount;
}

// Grain: a few tiles of gaussian noise around mid-grey, blended with "overlay"
// at a different offset each frame, so it moves like film grain.
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

/** Draw one video frame of `scene`: soft flicker for time t, grain for frame number n. */
export function drawFilmFrame(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, film: Film, t: number, n: number,
  w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(scene, 0, 0, w, h);
  const dim = flickerAt(film, t);
  if (dim > 0) {
    ctx.globalAlpha = dim;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  }
  if (film.grain > 0) {
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
