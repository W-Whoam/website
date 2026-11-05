// Variation data model, default template, JSON import/export, share links.
import type { AnswerState, Face } from './model';

export const LINE_KEYS = ['open', 'question', 'left', 'right', 'reply', 'whisper', 'close'] as const;
export type LineKey = (typeof LINE_KEYS)[number];
export type Lines = Record<LineKey, string>;

export interface Scene {
  face: Face;
  /** May contain {open} {question} {left} {right} {reply} {whisper} {close}; "\n" breaks the line */
  text: string;
  answers: AnswerState;
  /** seconds */
  duration: number;
}

export interface Variation {
  id: string;
  name: string;
  notes?: string;
  lines: Lines;
  scenes: Scene[];
}

export interface Pack {
  format: 'pale-guy-meme';
  version: 1;
  variations: Variation[];
}

export const FACES: Face[] = ['smirk', 'grin', 'stare', 'door'];
export const ANSWER_STATES: AnswerState[] = ['hidden', 'none', 'right', 'left'];

/** The original game lines. */
export const GAME_LINES: Lines = {
  open: 'Pekiiiii...',
  question: 'Yalnız mısın?',
  left: 'Hayır, yalnız değilim',
  right: 'Evet, yalnızım',
  reply: 'Şanslı günündesin.',
  whisper: 'İçeriden fısıltı sesi geliyor.',
  close: 'Tabii, birkaç gün sonra nerede olurlar\nbilemiyorum.',
};

/** Timeline of the long clip, re-timed (~18 s). */
export function templateScenes(): Scene[] {
  return [
    { face: 'smirk', text: '{open}', answers: 'hidden', duration: 2.0 },
    { face: 'grin', text: '{question}', answers: 'hidden', duration: 1.6 },
    { face: 'grin', text: '{question}', answers: 'none', duration: 1.6 },
    { face: 'grin', text: '{question}', answers: 'right', duration: 1.0 },
    { face: 'grin', text: '{question}', answers: 'left', duration: 1.7 },
    { face: 'stare', text: '{reply}', answers: 'hidden', duration: 2.4 },
    { face: 'stare', text: '{whisper}', answers: 'hidden', duration: 2.7 },
    { face: 'smirk', text: '{close}', answers: 'hidden', duration: 3.6 },
    { face: 'door', text: '', answers: 'hidden', duration: 1.2 },
  ];
}

export function newId(): string {
  return 'v' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

function normScene(s: any): Scene | null {
  if (!s || typeof s !== 'object') return null;
  const face = FACES.includes(s.face) ? s.face : 'grin';
  const answers = ANSWER_STATES.includes(s.answers) ? s.answers : 'hidden';
  let duration = Number(s.duration);
  if (!isFinite(duration) || duration <= 0) duration = 2;
  duration = Math.min(30, Math.max(0.1, duration));
  return { face, answers, duration, text: str(s.text) };
}

export function normVariation(v: any): Variation | null {
  if (!v || typeof v !== 'object') return null;
  const lines = { ...GAME_LINES } as Lines;
  if (v.lines && typeof v.lines === 'object') {
    for (const k of LINE_KEYS) if (typeof v.lines[k] === 'string') lines[k] = v.lines[k];
  }
  const scenes = Array.isArray(v.scenes) ? (v.scenes.map(normScene).filter(Boolean) as Scene[]) : templateScenes();
  return {
    id: str(v.id) || newId(),
    name: str(v.name, 'İsimsiz').slice(0, 120) || 'İsimsiz',
    notes: str(v.notes) || undefined,
    lines,
    scenes: scenes.length ? scenes.slice(0, 40) : templateScenes(),
  };
}

/** Accepts a pack, an array of variations or a single variation. */
export function parseImport(text: string): Variation[] {
  const j = JSON.parse(text);
  const list = Array.isArray(j) ? j : Array.isArray(j?.variations) ? j.variations : [j];
  const out = list.map(normVariation).filter(Boolean) as Variation[];
  if (!out.length) throw new Error('no variations');
  return out;
}

export function toPack(variations: Variation[]): Pack {
  return { format: 'pale-guy-meme', version: 1, variations };
}

export function resolveText(text: string, lines: Lines): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in lines ? lines[k as LineKey] : m));
}

// ---- share links (#v=base64url(json)) ----
function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function shareHash(v: Variation): string {
  const { id: _id, ...rest } = v;
  return '#v=' + b64urlEncode(new TextEncoder().encode(JSON.stringify(rest)));
}

export function readShareHash(hash: string): Variation | null {
  const m = /[#&]v=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    return normVariation({ ...JSON.parse(new TextDecoder().decode(b64urlDecode(m[1]))), id: newId() });
  } catch {
    return null;
  }
}
