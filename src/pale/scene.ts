// Composes one scene image: background + face + answer boxes + text.
import { resolveText, type Variation } from './data';
import type { AnswerState, Assets, Face, Model } from './model';
import { drawText, textWidth } from './text';

export interface ResolvedScene {
  face: Face;
  text: string;
  answers: AnswerState;
  left: string;
  right: string;
  duration: number;
}

export function resolveScenes(v: Variation): ResolvedScene[] {
  return v.scenes.map((s) => ({
    face: s.face,
    text: resolveText(s.text, v.lines),
    answers: s.face === 'door' ? 'hidden' : s.answers,
    left: v.lines.left,
    right: v.lines.right,
    duration: s.duration,
  }));
}

export function sceneKey(s: ResolvedScene): string {
  return JSON.stringify([s.face, s.text, s.answers, s.answers === 'hidden' ? '' : s.left, s.answers === 'hidden' ? '' : s.right]);
}

/** Split dialogue into slots: one line on D_ic, or two lines on D_t1/D_t2. */
export function layoutDialogue(model: Model, text: string): { slot: string; text: string }[] {
  const parts = text.replace(/\r/g, '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return [];
  if (parts.length >= 2) return [{ slot: 'D_t1', text: parts[0] }, { slot: 'D_t2', text: parts.slice(1).join(' ') }];
  const one = parts[0];
  const ic = model.slots.D_ic, t1 = model.slots.D_t1;
  const maxw = textWidth(t1.orig, t1.weight, model.size, model.ss) + 4;
  const w = (t: string) => textWidth(t, ic.weight, model.size, model.ss);
  if (w(one) <= maxw) return [{ slot: 'D_ic', text: one }];
  const words = one.split(/\s+/);
  let best: [number, string, string] | null = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' '), l2 = words.slice(i).join(' ');
    const w1 = w(l1);
    if (w1 > maxw) break;
    const score = Math.abs(w1 - 1.6 * w(l2));
    if (!best || score < best[0]) best = [score, l1, l2];
  }
  if (!best) return [{ slot: 'D_ic', text: one }];
  return [{ slot: 'D_t1', text: best[1] }, { slot: 'D_t2', text: best[2] }];
}

export function renderScene(a: Assets, s: ResolvedScene): HTMLCanvasElement {
  const m = a.model;
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (s.face === 'door') {
    ctx.drawImage(a.door, 0, 0);
  } else {
    ctx.drawImage(a.base, 0, 0);
    if (s.face === 'smirk' || s.face === 'stare') ctx.drawImage(a.faces[s.face], m.layers.face.x, m.layers.face.y);
    if (s.answers !== 'hidden') ctx.drawImage(a.answers[s.answers], m.layers.answers.x, m.layers.answers.y);
  }
  const img = ctx.getImageData(0, 0, m.width, m.height);
  for (const l of layoutDialogue(m, s.text)) drawText(img, m, m.slots[l.slot], l.text);
  if (s.answers !== 'hidden') {
    drawText(img, m, m.slots[s.answers === 'left' ? 'A_Lh' : 'A_Lu'], s.left);
    drawText(img, m, m.slots[s.answers === 'right' ? 'A_Rh' : 'A_Ru'], s.right);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
