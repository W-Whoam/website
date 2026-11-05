// Shared types + asset loading for the Pale Guy meme renderer.

export type Face = 'smirk' | 'grin' | 'stare' | 'door';
export type AnswerState = 'hidden' | 'none' | 'left' | 'right';

export interface Slot {
  weight: number;
  /** x0, y0 (baseline-left on screen), theta, shear, scale, perspective */
  params: [number, number, number, number, number, number];
  /** per channel (r,g,b) coefficients for [core, glow 2.5, glow 10, glow 24] */
  coefs: number[][];
  /** original text that was fitted; used to centre new text */
  orig: string;
  /** max width as a multiple of the original width before shrinking */
  maxw: number;
}

export interface Model {
  version: number;
  width: number;
  height: number;
  size: number;
  ss: number;
  blur: number;
  glow: number[];
  falloff: { x: number; y: number; slope: number; width: number; floor: [number, number, number] };
  layers: {
    base: string;
    door: string;
    face: { x: number; y: number; smirk: string; stare: string };
    answers: { x: number; y: number; none: string; left: string; right: string };
  };
  slots: Record<string, Slot>;
  /** The original clip's flicker: per-frame 'a'/'b' states at `fps`, b = colours through `matrix`; grain strength 0..1. */
  film: Film;
}

export interface Film {
  pattern: string;
  fps: number;
  /** rows = input channel, columns = output channel */
  matrix: number[][];
  grain: number;
}

export interface Assets {
  model: Model;
  base: HTMLImageElement;
  door: HTMLImageElement;
  faces: Record<'smirk' | 'stare', HTMLImageElement>;
  answers: Record<'none' | 'left' | 'right', HTMLImageElement>;
}

export const FONT_FAMILY = 'PaleGuyChakra';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed: ' + src));
    img.src = src;
  });
}

async function loadFonts(root: string) {
  const faces = [
    new FontFace(FONT_FAMILY, `url(${root}fonts/ChakraPetch-SemiBold.woff2) format("woff2")`, { weight: '600' }),
    new FontFace(FONT_FAMILY, `url(${root}fonts/ChakraPetch-Bold.woff2) format("woff2")`, { weight: '700' }),
  ];
  await Promise.all(faces.map(async (f) => {
    await f.load();
    document.fonts.add(f);
  }));
}

export async function loadAssets(root: string): Promise<Assets> {
  const model: Model = await (await fetch(root + 'model.json')).json();
  const L = model.layers;
  const fonts = loadFonts(root);
  const [base, door, smirk, stare, none, left, right] = await Promise.all([
    loadImage(root + L.base), loadImage(root + L.door),
    loadImage(root + L.face.smirk), loadImage(root + L.face.stare),
    loadImage(root + L.answers.none), loadImage(root + L.answers.left), loadImage(root + L.answers.right),
  ]);
  await fonts;
  return { model, base, door, faces: { smirk, stare }, answers: { none, left, right } };
}
