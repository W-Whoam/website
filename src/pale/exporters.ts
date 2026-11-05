// Client-side GIF + video export. Nothing leaves the browser.
// @ts-ignore - gifenc ships without types
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawFilmFrame, stateAt, type FilmScene } from './film';
import type { Film } from './model';

export interface Frame {
  scene: FilmScene;
  duration: number; // seconds
}
export type Progress = (p: number) => void;

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true })!;
}

function sceneIndexAt(frames: Frame[], starts: number[], t: number) {
  for (let i = 0; i < frames.length; i++) if (t < starts[i] + frames[i].duration) return i;
  return frames.length - 1;
}
function startTimes(frames: Frame[]) {
  const s: number[] = [];
  let acc = 0;
  for (const f of frames) { s.push(acc); acc += f.duration; }
  return { starts: s, total: acc };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function dither(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(src);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47;
      const o = (y * w + x) * 4;
      d[o] += b * 8;
      d[o + 1] += b * 4;
      d[o + 2] += b * 8;
    }
  }
  return d;
}

/**
 * GIF with the flicker (no grain: grain changes every pixel every frame and
 * would make the file several times bigger). Sampled at `fps`; runs of identical
 * frames are merged, and pixels that did not change are written as transparent.
 */
export async function exportGif(frames: Frame[], film: Film, width: number, fps = 10, onProgress?: Progress): Promise<Blob> {
  const src = frames[0].scene.a;
  const w = even(width), h = even((width * src.height) / src.width);
  const { starts, total } = startTimes(frames);

  // runs of (scene, state) at the GIF frame rate
  const runs: { i: number; st: 'a' | 'b'; n: number }[] = [];
  const count = Math.max(1, Math.round(total * fps));
  for (let f = 0; f < count; f++) {
    const t = f / fps;
    const i = sceneIndexAt(frames, starts, t);
    const st = stateAt(film, t);
    const last = runs[runs.length - 1];
    if (last && last.i === i && last.st === st) last.n++;
    else runs.push({ i, st, n: 1 });
  }

  // one shared palette (255 colours + 1 transparent slot) from every distinct image
  const ctx = canvas2d(w, h);
  const distinct = new Map<string, Uint8ClampedArray>();
  for (const r of runs) {
    const k = r.i + r.st;
    if (distinct.has(k)) continue;
    ctx.drawImage(r.st === 'b' ? frames[r.i].scene.b : frames[r.i].scene.a, 0, 0, w, h);
    distinct.set(k, dither(ctx.getImageData(0, 0, w, h).data, w, h));
  }
  const sample: number[] = [];
  for (const d of distinct.values()) for (let p = 0; p < d.length; p += 4 * 7) sample.push(d[p], d[p + 1], d[p + 2], 255);
  // indices come from the 255-colour palette only, so no real pixel ever maps to the transparent slot
  const colours: number[][] = quantize(new Uint8Array(sample), 255, { format: 'rgb565' });
  const TRANSPARENT = colours.length;
  const palette = [...colours, [0, 0, 0]];

  const gif = GIFEncoder();
  let prev: Uint8Array | null = null;
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    const index: Uint8Array = applyPalette(distinct.get(r.i + r.st)!, colours, 'rgb565');
    let out = index;
    if (prev) {
      out = new Uint8Array(index);
      for (let p = 0; p < out.length; p++) if (out[p] === prev[p]) out[p] = TRANSPARENT;
    }
    gif.writeFrame(out, w, h, {
      palette, delay: Math.round((r.n / fps) * 1000), repeat: 0,
      transparent: !!prev, transparentIndex: TRANSPARENT, dispose: 1,
    });
    prev = index;
    onProgress?.((k + 1) / runs.length);
    if (k % 4 === 0) await tick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

const CODECS: { codec: string; mux: 'avc' | 'vp9' | 'av1' }[] = [
  { codec: 'avc1.640028', mux: 'avc' },
  { codec: 'avc1.4d0028', mux: 'avc' },
  { codec: 'avc1.42e028', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
];

export interface VideoResult {
  blob: Blob;
  ext: string;
  codec: string;
}

/** Video with flicker + grain. WebCodecs (fast, frame exact); falls back to real-time MediaRecorder. */
export async function exportVideo(frames: Frame[], film: Film, width: number, fps = 30, onProgress?: Progress): Promise<VideoResult> {
  const src = frames[0].scene.a;
  const w = even(width), h = even((width * src.height) / src.width);
  if (typeof (window as any).VideoEncoder === 'function') {
    for (const c of CODECS) {
      const cfg: VideoEncoderConfig = { codec: c.codec, width: w, height: h, bitrate: 3_500_000, framerate: fps };
      try {
        const sup = await VideoEncoder.isConfigSupported(cfg);
        if (sup.supported) return await encodeWebCodecs(frames, film, w, h, fps, cfg, c.mux, onProgress);
      } catch {
        /* try next */
      }
    }
  }
  return recordRealtime(frames, film, w, h, fps, onProgress);
}

async function encodeWebCodecs(frames: Frame[], film: Film, w: number, h: number, fps: number, cfg: VideoEncoderConfig,
  mux: 'avc' | 'vp9' | 'av1', onProgress?: Progress): Promise<VideoResult> {
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: mux, width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let failure: unknown = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  enc.configure(cfg);
  const ctx = canvas2d(w, h);
  const { starts, total } = startTimes(frames);
  const count = Math.max(1, Math.round(total * fps));
  for (let f = 0; f < count; f++) {
    if (failure) throw failure;
    const t = f / fps;
    drawFilmFrame(ctx, frames[sceneIndexAt(frames, starts, t)].scene, film, t, f, w, h, true);
    const vf = new VideoFrame(ctx.canvas, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
    vf.close();
    if (enc.encodeQueueSize > 12) await new Promise((r) => setTimeout(r, 2));
    if (f % 15 === 0) { onProgress?.(f / count); await tick(); }
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', codec: cfg.codec };
}

async function recordRealtime(frames: Frame[], film: Film, w: number, h: number, fps: number, onProgress?: Progress): Promise<VideoResult> {
  const ctx = canvas2d(w, h);
  const canvas = ctx.canvas;
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
  if (!mime) throw new Error('This browser cannot record video.');
  const stream = (canvas as any).captureStream(fps) as MediaStream;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  const { starts, total } = startTimes(frames);
  rec.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      const n = Math.floor(t * fps);
      drawFilmFrame(ctx, frames[sceneIndexAt(frames, starts, Math.min(t, total - 1e-3))].scene, film, t, n, w, h, true);
      onProgress?.(Math.min(1, t / total));
      if (t >= total) resolve(); else requestAnimationFrame(step);
    };
    step();
  });
  rec.stop();
  await done;
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext, codec: mime };
}
