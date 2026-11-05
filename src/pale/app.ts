import {
  ANSWER_STATES, FACES, GAME_LINES, LINE_KEYS, newId, normVariation, parseImport, readShareHash, shareHash,
  templateScenes, toPack, type LineKey, type Variation,
} from './data';
import { exportGif, exportVideo } from './exporters';
import { setLang, t, getLang, type Lang } from './i18n';
import { loadAssets, type Assets } from './model';
import { renderScene, resolveScenes, sceneKey, type ResolvedScene } from './scene';
import { drawFilmFrame } from './film';

const ROOT = '/pale-guy/';
const LS_KEY = 'paleguy:v1';
const LS_LANG = 'paleguy:lang';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface State { variations: Variation[]; selected: string; }
let state: State = { variations: [], selected: '' };
let assets: Assets | null = null;

// ---------------- persistence ----------------
function lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => lsSet(LS_KEY, JSON.stringify(state)), 300);
}

const current = (): Variation => state.variations.find((v) => v.id === state.selected) ?? state.variations[0];

// ---------------- status line ----------------
let toastTimer = 0;
function toast(msg: string) {
  const el = $('status');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.textContent = ''), 3200);
}
function progress(label: string | null, p = 0) {
  const el = $('status');
  clearTimeout(toastTimer);
  el.textContent = label === null ? '' : `${label}… ${Math.round(p * 100)}%`;
}

// ---------------- rendering cache ----------------
const cache = new Map<string, HTMLCanvasElement>();
let scenes: ResolvedScene[] = [];
let frames: (HTMLCanvasElement | null)[] = [];
let renderToken = 0;

function cacheGet(k: string) {
  const c = cache.get(k);
  if (c) { cache.delete(k); cache.set(k, c); }
  return c;
}
function cachePut(k: string, c: HTMLCanvasElement) {
  cache.set(k, c);
  while (cache.size > 80) cache.delete(cache.keys().next().value!);
}

async function renderAll(priority?: number) {
  if (!assets) return;
  const token = ++renderToken;
  scenes = resolveScenes(current());
  frames = scenes.map((s) => cacheGet(sceneKey(s)) ?? null);
  buildTimeline();
  const order = scenes.map((_, i) => i);
  if (priority !== undefined && priority < order.length) order.sort((a, b) => (a === priority ? -1 : b === priority ? 1 : a - b));
  for (const i of order) {
    if (frames[i]) continue;
    await new Promise((r) => setTimeout(r, 0));
    if (token !== renderToken) return;
    const k = sceneKey(scenes[i]);
    const c = cacheGet(k) ?? renderScene(assets, scenes[i]);
    cachePut(k, c);
    frames[i] = c;
    shown = -2;
  }
  $('loading').hidden = true;
}

let renderTimer = 0;
function scheduleRender(priority?: number) {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => renderAll(priority), 160);
}

// ---------------- player ----------------
let playing = true;
let time = 0;
let last = performance.now();
let shown = -1;
let shownFrame = -1;
const total = () => scenes.reduce((s, x) => s + x.duration, 0);

function sceneAt(tt: number): number {
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) { acc += scenes[i].duration; if (tt < acc) return i; }
  return Math.max(0, scenes.length - 1);
}
function startOf(i: number) { return scenes.slice(0, i).reduce((s, x) => s + x.duration, 0); }

function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const T = total();
  if (playing && T > 0) { time += dt; if (time >= T) time = 0; }
  const idx = sceneAt(time);
  const canvas = $<HTMLCanvasElement>('preview');
  const f = frames[idx];
  const film = assets?.model.film;
  // the film effect runs even while paused, like the original clip
  const n = Math.floor((now / 1000) * (film?.fps ?? 30));
  if (f && film && (n !== shownFrame || idx !== shown || shown === -2)) {
    drawFilmFrame(canvas.getContext('2d')!, f, film, now / 1000, n, canvas.width, canvas.height);
    shownFrame = n;
  }
  if (idx !== shown || shown === -2) {
    if (f) {
      shown = idx;
      $('loading').hidden = true;
    } else {
      $('loading').hidden = false;
    }
    document.querySelectorAll('#timeline .seg').forEach((el, i) => el.classList.toggle('on', i === idx));
  }
  requestAnimationFrame(loop);
}

function setPlaying(p: boolean) {
  playing = p;
  const b = $('play');
  b.textContent = p ? t('pause') : t('play');
}

function jumpTo(i: number) {
  setPlaying(false);
  time = startOf(i) + 0.001;
  shown = -2;
}

function buildTimeline() {
  const tl = $('timeline');
  const T = total() || 1;
  tl.querySelectorAll('.seg').forEach((e) => e.remove());
  scenes.forEach((s, i) => {
    const seg = document.createElement('button');
    seg.className = 'seg';
    seg.style.flexGrow = String(s.duration / T);
    seg.title = `${i + 1}: ${t(('face_' + s.face) as any)}, ${s.duration} ${t('seconds')}`;
    seg.setAttribute('aria-label', seg.title);
    seg.onclick = () => jumpTo(i);
    tl.appendChild(seg);
  });
  shown = -2;
}

// ---------------- list ----------------
function renderList() {
  const sel = $<HTMLSelectElement>('v-select');
  sel.innerHTML = '';
  for (const v of state.variations) option(sel, v.id, v.name || t('untitled'));
  sel.value = state.selected;
  sel.onchange = () => select(sel.value);
  $<HTMLButtonElement>('v-del').disabled = state.variations.length <= 1;
}

function select(id: string) {
  state.selected = id;
  save();
  renderList();
  renderEditor();
  time = 0;
  setPlaying(true);
  scheduleRender(0);
}

// ---------------- editor ----------------
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function changed(priority?: number) {
  save();
  scheduleRender(priority);
}

function option(sel: HTMLSelectElement, value: string, label: string) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  sel.appendChild(o);
}

function renderEditor() {
  const v = current();
  if (!v) return;
  const name = $<HTMLInputElement>('f-name');
  name.value = v.name;
  name.oninput = () => { v.name = name.value; save(); renderList(); };

  const lines = $('f-lines');
  lines.innerHTML = '';
  for (const k of LINE_KEYS) {
    const row = document.createElement('label');
    row.className = 'row';
    const span = document.createElement('span');
    span.textContent = t(('line_' + k) as any);
    const ta = document.createElement('textarea');
    ta.rows = 1;
    ta.value = v.lines[k];
    ta.spellcheck = false;
    if (k === 'left' || k === 'right') ta.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    ta.oninput = () => {
      v.lines[k as LineKey] = ta.value;
      autoGrow(ta);
      const first = v.scenes.findIndex((s) => s.text.includes('{' + k + '}') || ((k === 'left' || k === 'right') && s.answers !== 'hidden'));
      if (first >= 0 && !playing) jumpTo(first);
      changed(first >= 0 ? first : undefined);
    };
    row.append(span, ta);
    lines.appendChild(row);
    requestAnimationFrame(() => autoGrow(ta));
  }
  renderScenes();
}

function renderScenes() {
  const v = current();
  const ol = $('scenes');
  ol.innerHTML = '';
  v.scenes.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'scene';
    const num = document.createElement('button');
    num.className = 'num';
    num.textContent = String(i + 1);
    num.onclick = () => jumpTo(i);

    const face = document.createElement('select');
    FACES.forEach((f) => option(face, f, t(('face_' + f) as any)));
    face.value = s.face;
    face.onchange = () => { s.face = face.value as any; jumpTo(i); changed(i); };

    const ans = document.createElement('select');
    ANSWER_STATES.forEach((a) => option(ans, a, t(('ans_' + a) as any)));
    ans.value = s.answers;
    ans.onchange = () => { s.answers = ans.value as any; jumpTo(i); changed(i); };

    const dur = document.createElement('input');
    dur.type = 'number';
    dur.min = '0.1';
    dur.max = '30';
    dur.step = '0.1';
    dur.value = String(s.duration);
    dur.className = 'dur';
    dur.oninput = () => {
      const n = parseFloat(dur.value);
      if (isFinite(n) && n > 0) { s.duration = Math.min(30, n); changed(i); }
    };

    const text = document.createElement('textarea');
    text.rows = 1;
    text.value = s.text;
    text.placeholder = t('sceneText');
    text.spellcheck = false;
    text.oninput = () => { s.text = text.value; autoGrow(text); jumpTo(i); changed(i); };
    requestAnimationFrame(() => autoGrow(text));

    const mk = (label: string, key: any, fn: () => void, dis = false) => {
      const b = document.createElement('button');
      b.className = 'icon';
      b.textContent = label;
      b.title = t(key);
      b.setAttribute('aria-label', b.title);
      b.disabled = dis;
      b.onclick = fn;
      return b;
    };
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.append(
      mk('↑', 'up', () => { [v.scenes[i - 1], v.scenes[i]] = [v.scenes[i], v.scenes[i - 1]]; renderScenes(); changed(); }, i === 0),
      mk('↓', 'down', () => { [v.scenes[i + 1], v.scenes[i]] = [v.scenes[i], v.scenes[i + 1]]; renderScenes(); changed(); }, i === v.scenes.length - 1),
      mk('✕', 'remove', () => { v.scenes.splice(i, 1); renderScenes(); changed(); }, v.scenes.length <= 1),
    );
    li.append(num, face, ans, dur, tools, text);
    ol.appendChild(li);
  });
}

// ---------------- actions ----------------
function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const slug = (s: string) =>
  (s || 'pale-guy').toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'pale-guy';

async function readyFrames() {
  await renderAll();
  return frames.map((c, i) => ({ canvas: c!, duration: scenes[i].duration }));
}

let busy = false;
async function doExport(kind: 'gif' | 'video') {
  if (busy || !assets) return;
  busy = true;
  document.body.classList.add('busy');
  const v = current();
  try {
    const fr = await readyFrames();
    if (kind === 'gif') {
      const blob = await exportGif(fr, 640, (p) => progress(t('exportingGif'), p));
      download(blob, `${slug(v.name)}.gif`);
    } else {
      const slow = typeof (window as any).VideoEncoder !== 'function';
      const res = await exportVideo(fr, assets.model.film, 1280, 30, (p) => progress(slow ? t('realtimeNote') : t('exportingVideo'), p));
      download(res.blob, `${slug(v.name)}.${res.ext}`);
    }
    toast(t('done'));
  } catch (e) {
    console.error(e);
    toast(`${t('failed')}: ${(e as Error)?.message ?? e}`);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}

/**
 * replace: drop everything and use `list`
 * merge:   same id -> overwrite in place, new ids -> append (re-importing an edited file updates it)
 * keep:    same id -> leave the existing one alone, new ids -> append (used for "add examples")
 * new:     always append as new copies
 */
function addVariations(list: Variation[], mode: 'replace' | 'merge' | 'keep' | 'new') {
  if (mode === 'replace') {
    state.variations = list;
  } else {
    for (const v of list) {
      const i = state.variations.findIndex((x) => x.id === v.id);
      if (i < 0) state.variations.push(v);
      else if (mode === 'merge') state.variations[i] = v;
      else if (mode === 'new') { v.id = newId(); state.variations.push(v); }
    }
  }
  select(list[0].id);
}

function openImport() {
  const dlg = $<HTMLDialogElement>('import-dialog');
  const ta = $<HTMLTextAreaElement>('import-text');
  const err = $('import-error');
  err.textContent = '';
  ta.value = '';
  $<HTMLInputElement>('import-file').value = '';
  dlg.showModal();
}

async function importFrom(replace: boolean) {
  const ta = $<HTMLTextAreaElement>('import-text');
  const file = $<HTMLInputElement>('import-file').files?.[0];
  const err = $('import-error');
  try {
    const text = file ? await file.text() : ta.value;
    const list = parseImport(text);
    addVariations(list, replace ? 'replace' : 'merge');
    $<HTMLDialogElement>('import-dialog').close();
    toast(`${list.length} ${t('importOk')}`);
  } catch {
    err.textContent = t('importBad');
  }
}

async function loadDefaults(): Promise<Variation[]> {
  try {
    return parseImport(await (await fetch(ROOT + 'variations.json')).text());
  } catch {
    return [normVariation({ name: 'Orijinal', lines: GAME_LINES })!];
  }
}

function wire() {
  $('play').onclick = () => setPlaying(!playing);
  $('preview').onclick = () => setPlaying(!playing);
  $('scenes').closest('details')!.addEventListener('toggle', () =>
    document.querySelectorAll<HTMLTextAreaElement>('#scenes textarea').forEach(autoGrow));
  $('v-new').onclick = () => addVariations([{ id: newId(), name: t('untitled'), lines: { ...GAME_LINES }, scenes: templateScenes() }], 'new');
  $('v-dup').onclick = () => {
    const v = structuredClone(current());
    v.id = newId();
    v.name = v.name + ' 2';
    addVariations([v], 'new');
  };
  let delArmed = 0;
  $('v-del').onclick = () => {
    const b = $('v-del');
    if (!delArmed) {
      b.textContent = t('confirmDelete');
      delArmed = window.setTimeout(() => { delArmed = 0; b.textContent = t('delete'); }, 2500);
      return;
    }
    clearTimeout(delArmed); delArmed = 0; b.textContent = t('delete');
    if (state.variations.length <= 1) return;
    const i = state.variations.findIndex((v) => v.id === state.selected);
    state.variations.splice(i, 1);
    select(state.variations[Math.max(0, i - 1)].id);
  };
  $('json-import').onclick = openImport;
  $('import-add').onclick = () => importFrom(false);
  $('import-replace').onclick = () => importFrom(true);
  $('import-cancel').onclick = () => $<HTMLDialogElement>('import-dialog').close();
  $('json-export').onclick = () =>
    download(new Blob([JSON.stringify(toPack(state.variations), null, 2)], { type: 'application/json' }), 'pale-guy-varyasyonlar.json');
  $('s-add').onclick = () => {
    const v = current();
    const lastScene = v.scenes[v.scenes.length - 1];
    v.scenes.push({ ...(lastScene ?? templateScenes()[0]), text: '', duration: 2 });
    renderScenes();
    jumpTo(v.scenes.length - 1);
    changed(v.scenes.length - 1);
  };
  let resetArmed = 0;
  $('s-reset').onclick = () => {
    const b = $('s-reset');
    if (!resetArmed) {
      b.textContent = t('resetScenesConfirm');
      resetArmed = window.setTimeout(() => { resetArmed = 0; b.textContent = t('resetScenes'); }, 2500);
      return;
    }
    clearTimeout(resetArmed); resetArmed = 0; b.textContent = t('resetScenes');
    current().scenes = templateScenes();
    renderScenes();
    changed();
  };
  $('dl-gif').onclick = () => doExport('gif');
  $('dl-mp4').onclick = () => doExport('video');
  $('share').onclick = async () => {
    const url = location.origin + location.pathname + shareHash(current());
    try { await navigator.clipboard.writeText(url); toast(t('copied')); }
    catch { $<HTMLInputElement>('share-url').value = url; $('share-url').hidden = false; ($('share-url') as HTMLInputElement).select(); }
  };
  $('lang').onclick = () => {
    const next: Lang = getLang() === 'tr' ? 'en' : 'tr';
    lsSet(LS_LANG, next);
    applyLang(next);
  };
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && tag !== 'BUTTON') {
      e.preventDefault();
      setPlaying(!playing);
    }
  });
}

function applyLang(l: Lang) {
  setLang(l);
  $('lang').textContent = l === 'tr' ? 'EN' : 'TR';
  setPlaying(playing);
  renderList();
  renderEditor();
  buildTimeline();
}

async function init() {
  const storedLang = lsGet(LS_LANG) as Lang | null;
  const l: Lang = storedLang === 'en' || storedLang === 'tr' ? storedLang : navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  setLang(l);
  $('lang').textContent = l === 'tr' ? 'EN' : 'TR';
  wire();

  let restored: State | null = null;
  try {
    const raw = lsGet(LS_KEY);
    if (raw) {
      const j = JSON.parse(raw);
      const list = (j.variations ?? []).map(normVariation).filter(Boolean) as Variation[];
      if (list.length) restored = { variations: list, selected: j.selected };
    }
  } catch { /* ignore */ }
  state = restored ?? { variations: await loadDefaults(), selected: '' };
  if (!state.variations.some((v) => v.id === state.selected)) state.selected = state.variations[0].id;

  const shared = readShareHash(location.hash);
  if (shared) {
    state.variations.push(shared);
    state.selected = shared.id;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => toast(t('sharedLoaded')), 300);
  }
  save();
  renderList();
  renderEditor();
  setPlaying(true);
  requestAnimationFrame(loop);
  try {
    assets = await loadAssets(ROOT);
    $('app').classList.add('ready');
    await renderAll(0);
  } catch (e) {
    console.error(e);
    $('loading').textContent = t('failed');
  }
}

init();
