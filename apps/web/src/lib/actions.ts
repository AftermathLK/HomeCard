/**
 * Higher-level editing operations shared by the canvas, panels and guided steps.
 */
import {
  applyTemplate,
  autoFillPhotos,
  clampCrop,
  defaultPolish,
  fillFromRecord,
  fitFill,
  getBuiltinOrnament,
  orientedFill,
  photoContentBox,
  placeImage,
  placePhoto,
  refitAllPhotos,
  turnFill,
  uid,
  type CardElement,
  type CardProject,
  type MediaInfo,
  type OrnamentElement,
  type PhotoElement,
  type PhotoItem,
  type PhotoRecord,
  type SurfaceId,
  type TextElement,
  type TurnOp,
} from '@homecard/shared';
import { useEditor } from '@/store/editor';
import { useUi } from '@/store/ui';
import { api } from './api';
import { detectFaces } from './faces';

/* ---------- Photos ---------- */

export function recordFromInfo(i: MediaInfo): PhotoRecord {
  return { ref: i.ref, name: i.name, width: i.width, height: i.height, faces: i.faces, facesSource: i.facesSource, focus: i.focus, takenAt: i.takenAt, mime: i.mime };
}

/** Resolve picked items into photo records (dimensions, faces, focus); runs local face detection when needed. */
export async function resolvePhotos(items: Array<Pick<PhotoItem, 'ref'>>): Promise<PhotoRecord[]> {
  if (!items.length) return [];
  const infos = await api.post<Array<MediaInfo | { ref: string; error: string }>>('/api/media/info', { refs: items.map((i) => i.ref) });
  const out: PhotoRecord[] = [];
  for (const i of infos) {
    if ('error' in i) {
      useUi.getState().toast(`Couldn’t read ${i.ref.replace(/^\w+:/, '')}: ${i.error}`, 'error');
      continue;
    }
    out.push(recordFromInfo(i));
  }
  // Local photos: detect faces in the browser once, store server-side, then patch records.
  for (const rec of out) {
    const info = infos.find((x) => x.ref === rec.ref) as MediaInfo;
    if (!info.facesKnown && rec.ref.startsWith('library:')) {
      detectFaces(rec.ref)
        .then(async (faces) => {
          await api.put('/api/media/faces', { ref: rec.ref, faces });
          applyFaces(rec.ref, faces);
        })
        .catch(() => undefined);
    }
  }
  return out;
}

/** When faces arrive after placement, re-run smart crop for frames still in auto mode. */
function applyFaces(ref: string, faces: PhotoRecord['faces']) {
  const st = useEditor.getState();
  const p = st.project;
  if (!p) return;
  const next: CardProject = {
    ...p,
    photos: p.photos.map((r) => (r.ref === ref ? { ...r, faces, facesSource: 'local' } : r)),
    surfaces: p.surfaces.map((s) => ({
      ...s,
      elements: s.elements.map((e) => {
        if (e.type !== 'photo' || !e.fill || e.fill.ref !== ref) return e;
        const fill = { ...e.fill, faces };
        return { ...e, fill: fill.crop.mode === 'auto' ? fitFill(e, fill, p.format) : fill };
      }),
    })),
  };
  // Not an undoable user action: merge silently into the current state.
  st.replaceSilently(next);
}

export function addToTray(records: PhotoRecord[]) {
  const ed = useEditor.getState();
  ed.edit((d) => {
    for (const r of records) if (!d.photos.some((x) => x.ref === r.ref)) d.photos.push(r);
  }, null);
}

/**
 * Add photos to the card's tray and drop them, in the order picked, into any empty frames
 * (front first). One undo step. Returns how many frames were filled.
 */
export function addPhotosAndFill(records: PhotoRecord[]): number {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return 0;
  const photos = [...p.photos];
  for (const r of records) if (!photos.some((x) => x.ref === r.ref)) photos.push(r);
  const filledCount = (proj: typeof p) => proj.surfaces.reduce((n, s) => n + s.elements.filter((e) => e.type === 'photo' && e.fill).length, 0);
  const next = autoFillPhotos({ ...p, photos }, records);
  ed.commit(next);
  return filledCount(next) - filledCount(p);
}

export function removeFromTray(ref: string) {
  useEditor.getState().edit((d) => {
    d.photos = d.photos.filter((r) => r.ref !== ref);
  });
}

export function placeIntoFrame(surfaceId: SurfaceId, elementId: string, rec: PhotoRecord) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  let next = placePhoto(p, surfaceId, elementId, rec);
  if (!next.photos.some((r) => r.ref === rec.ref)) next = { ...next, photos: [...next.photos, rec] };
  ed.commit(next);
}

export function autoFill() {
  const ed = useEditor.getState();
  if (ed.project) ed.commit(autoFillPhotos(ed.project));
}

export function clearFrame(elementId: string) {
  useEditor.getState().updateElement(elementId, (el) => {
    if (el.type === 'photo') el.fill = null;
  }, null);
}

export function refitPhoto(elementId: string) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  ed.updateElement(elementId, (el) => {
    if (el.type === 'photo' && el.fill) el.fill = fitFill(el, el.fill, p.format);
  }, `refit:${elementId}`);
}

export function smartCrop(elementId: string) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  ed.updateElement(elementId, (el) => {
    if (el.type === 'photo' && el.fill) el.fill = fitFill(el, { ...el.fill, crop: { ...el.fill.crop, mode: 'auto' } }, p.format);
  }, null);
}

/** Turn the photo a quarter turn or mirror it inside its frame ('reset' undoes both). */
export function turnPhoto(elementId: string, op: TurnOp | 'reset') {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  ed.updateElement(elementId, (el) => {
    if (el.type === 'photo' && el.fill) el.fill = fitFill(el, turnFill(el.fill, op), p.format);
  }, null);
}

/** Straighten: turn the photo by `angle` degrees inside its frame (it grows just enough to keep covering it). */
export function straightenPhoto(elementId: string, angle: number, key: string | null = `straighten:${elementId}`) {
  useEditor.getState().updateElement(elementId, (el) => {
    if (el.type !== 'photo' || !el.fill) return;
    const box = photoContentBox(el);
    const o = orientedFill(el.fill);
    el.fill.crop = clampCrop(box.w, box.h, o.width, o.height, { ...el.fill.crop, angle });
  }, key);
}

/** Back to the plain framing: centred, straight, zoomed all the way out (keeps any turn/mirror). */
export function resetFraming(elementId: string) {
  useEditor.getState().updateElement(elementId, (el) => {
    if (el.type !== 'photo' || !el.fill) return;
    const box = photoContentBox(el);
    const o = orientedFill(el.fill);
    el.fill.crop = clampCrop(box.w, box.h, o.width, o.height, { cx: 0.5, cy: 0.5, zoom: 1, mode: 'manual' });
  }, null);
}

/** Move the photo inside its frame by a fraction of the frame (arrow keys while cropping). */
export function panCrop(elementId: string, fx: number, fy: number) {
  useEditor.getState().updateElement(elementId, (el) => {
    if (el.type !== 'photo' || !el.fill) return;
    const box = photoContentBox(el);
    const o = orientedFill(el.fill);
    const pl = placeImage(box.w, box.h, o.width, o.height, el.fill.crop);
    const c = el.fill.crop;
    // Move along the frame's axes even when the photo is straightened.
    const t = (-(c.angle ?? 0) * Math.PI) / 180;
    const dx = fx * box.w, dy = fy * box.h;
    const ix = dx * Math.cos(t) - dy * Math.sin(t), iy = dx * Math.sin(t) + dy * Math.cos(t);
    el.fill.crop = clampCrop(box.w, box.h, o.width, o.height, { ...c, cx: c.cx - ix / pl.width, cy: c.cy - iy / pl.height, mode: 'manual' });
  }, `crop:${elementId}`);
}

/**
 * Reshape the frame to the photo's proportions so the whole picture shows uncropped.
 * Keeps the frame's centre and roughly its area; frame styles (instant photo, mat) are allowed for.
 */
export function fitFrameToPhoto(elementId: string) {
  useEditor.getState().updateElement(elementId, (el) => {
    if (el.type !== 'photo' || !el.fill) return;
    const o = orientedFill(el.fill);
    const box0 = photoContentBox(el);
    const aspect = o.width / Math.max(1, o.height);
    const area = box0.w * box0.h;
    const cw = Math.sqrt(area * aspect), ch = Math.sqrt(area / aspect);
    let w = el.w, h = el.h;
    for (let i = 0; i < 24; i++) {
      const b = photoContentBox({ w, h, frameStyle: el.frameStyle });
      w += cw - b.w;
      h += ch - b.h;
    }
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    el.w = r3(w);
    el.h = r3(h);
    el.x = r3(cx - w / 2);
    el.y = r3(cy - h / 2);
    const box = photoContentBox(el);
    el.fill.crop = clampCrop(box.w, box.h, o.width, o.height, { cx: 0.5, cy: 0.5, zoom: 1, mode: 'manual' });
  }, null);
}

export function swapPhotos(aId: string, bId: string) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  ed.edit((d) => {
    let a: PhotoElement | undefined, b: PhotoElement | undefined;
    for (const s of d.surfaces)
      for (const e of s.elements) {
        if (e.id === aId && e.type === 'photo') a = e;
        if (e.id === bId && e.type === 'photo') b = e;
      }
    if (!a || !b) return;
    const fa = a.fill, fb = b.fill;
    a.fill = fb ? fitFill(a, { ...fb, crop: { ...fb.crop, mode: 'auto' } }, d.format) : null;
    b.fill = fa ? fitFill(b, { ...fa, crop: { ...fa.crop, mode: 'auto' } }, d.format) : null;
  });
}

/* ---------- Templates ---------- */

export function applyTemplateTo(surfaceId: SurfaceId, templateId: string, params?: Record<string, number>) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  const surface = applyTemplate(p, surfaceId, templateId, { params });
  ed.commit({ ...p, surfaces: p.surfaces.map((s) => (s.id === surfaceId ? surface : s)) }, params ? `tpl-params:${surfaceId}` : null);
}

export function refitAll() {
  const ed = useEditor.getState();
  if (ed.project) ed.commit(refitAllPhotos(ed.project));
}

/* ---------- Elements ---------- */

function centerOf(p: CardProject) {
  return { cx: p.format.widthIn / 2, cy: p.format.heightIn / 2 };
}

export function addElement(el: CardElement) {
  const ed = useEditor.getState();
  ed.updateSurface(ed.surfaceId, (s) => {
    s.elements.push(el);
  }, null);
  ed.select(el.id);
}

export function addText(role: TextElement['role'] = 'custom', text = 'Your text here') {
  const p = useEditor.getState().project;
  if (!p) return;
  const { cx, cy } = centerOf(p);
  const w = Math.min(p.format.widthIn - 2 * p.format.safeIn, 3.5);
  const el: TextElement = {
    id: uid('el'), type: 'text', role, text, fontRole: role === 'headline' ? 'display' : role === 'names' || role === 'year' ? 'accent' : 'body',
    x: cx - w / 2, y: cy - 0.4, w, h: 0.8, rotation: 0, opacity: 1,
    fontSize: role === 'headline' ? 36 : 14, lineHeight: 1.25, align: 'center', vAlign: 'middle', color: '@text', fill: 'color', shadow: false, autoFit: true,
  };
  addElement(el);
  return el;
}

export function addOrnament(asset: string, opts: { aspect?: number; stretch?: boolean } = {}) {
  const p = useEditor.getState().project;
  if (!p) return;
  const { cx, cy } = centerOf(p);
  const def = asset.startsWith('builtin:') ? getBuiltinOrnament(asset.slice(8)) : undefined;
  const aspect = opts.aspect ?? def?.aspect ?? 1;
  const stretch = opts.stretch ?? def?.stretch ?? false;
  const W = p.format.widthIn, H = p.format.heightIn;
  let w: number, h: number;
  if (stretch) {
    w = W - 2 * p.format.safeIn * 0.6;
    h = H - 2 * p.format.safeIn * 0.6;
  } else {
    w = aspect >= 1 ? Math.min(2.2, W * 0.5) : 1.2 * aspect;
    h = w / aspect;
  }
  const el: OrnamentElement = { id: uid('el'), type: 'ornament', asset, color: '@accent', color2: '@accent2', x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0, opacity: 1 };
  addElement(el);
}

export function addSticker(asset: string, aspect = 1) {
  const p = useEditor.getState().project;
  if (!p) return;
  const { cx, cy } = centerOf(p);
  const w = aspect >= 1 ? 1.6 : 1.6 * aspect;
  const h = w / aspect;
  addElement({ id: uid('el'), type: 'sticker', asset, x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0, opacity: 1 });
}

export function addPhotoFrame(rec?: PhotoRecord) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p) return;
  const { cx, cy } = centerOf(p);
  const aspect = rec ? rec.width / rec.height : 4 / 3;
  const w = Math.min(p.format.widthIn * 0.6, 3);
  const h = w / aspect;
  const used = ed.project!.surfaces.find((s) => s.id === ed.surfaceId)!.elements.filter((e) => e.type === 'photo').length;
  const el: PhotoElement = {
    id: uid('el'), type: 'photo', slot: used, fill: null, mask: 'rect', radius: 0, border: null, frameStyle: 'none', shadow: false,
    x: cx - w / 2, y: cy - h / 2, w, h, rotation: 0, opacity: 1,
  };
  if (rec) el.fill = fitFill(el, { ...fillFromRecord(rec), polish: defaultPolish() }, p.format);
  addElement(el);
}

export function duplicateElements(ids: string[]) {
  const ed = useEditor.getState();
  const created: string[] = [];
  ed.edit((d) => {
    for (const s of d.surfaces) {
      const copies: CardElement[] = [];
      for (const e of s.elements)
        if (ids.includes(e.id)) {
          const c = JSON.parse(JSON.stringify(e)) as CardElement;
          c.id = uid('el');
          c.x += 0.15;
          c.y += 0.15;
          c.managed = false;
          copies.push(c);
          created.push(c.id);
        }
      s.elements.push(...copies);
    }
  });
  ed.select(created);
}

export function deleteElements(ids: string[]) {
  const ed = useEditor.getState();
  ed.edit((d) => {
    for (const s of d.surfaces) s.elements = s.elements.filter((e) => !ids.includes(e.id) || e.locked);
  });
  ed.select(null);
}

export function reorder(id: string, dir: 'up' | 'down' | 'top' | 'bottom') {
  useEditor.getState().edit((d) => {
    for (const s of d.surfaces) {
      const i = s.elements.findIndex((e) => e.id === id);
      if (i < 0) continue;
      const [el] = s.elements.splice(i, 1);
      const j = dir === 'top' ? s.elements.length : dir === 'bottom' ? 0 : dir === 'up' ? Math.min(s.elements.length, i + 1) : Math.max(0, i - 1);
      s.elements.splice(j, 0, el);
      return;
    }
  });
}

export function moveElementTo(id: string, toIndex: number) {
  useEditor.getState().edit((d) => {
    for (const s of d.surfaces) {
      const i = s.elements.findIndex((e) => e.id === id);
      if (i < 0) continue;
      const [el] = s.elements.splice(i, 1);
      s.elements.splice(Math.max(0, Math.min(s.elements.length, toIndex)), 0, el);
      return;
    }
  });
}

export function nudge(ids: string[], dx: number, dy: number) {
  useEditor.getState().edit((d) => {
    for (const s of d.surfaces)
      for (const e of s.elements)
        if (ids.includes(e.id) && !e.locked) {
          e.x = Math.round((e.x + dx) * 1000) / 1000;
          e.y = Math.round((e.y + dy) * 1000) / 1000;
        }
  }, `nudge:${ids.join(',')}`);
}

/** Centre the selection horizontally/vertically on the card. */
export function alignToCard(ids: string[], axis: 'x' | 'y') {
  useEditor.getState().edit((d) => {
    for (const s of d.surfaces)
      for (const e of s.elements)
        if (ids.includes(e.id)) {
          if (axis === 'x') e.x = Math.round((d.format.widthIn / 2 - e.w / 2) * 1000) / 1000;
          else e.y = Math.round((d.format.heightIn / 2 - e.h / 2) * 1000) / 1000;
        }
  });
}

/** Move an element fully inside the safe area (Guardian "move inside" fix). */
export function moveInsideSafe(id: string) {
  useEditor.getState().edit((d) => {
    const s = d.format.safeIn;
    for (const surf of d.surfaces)
      for (const e of surf.elements)
        if (e.id === id) {
          const maxW = d.format.widthIn - 2 * s, maxH = d.format.heightIn - 2 * s;
          if (e.w > maxW) e.w = maxW;
          if (e.h > maxH) e.h = maxH;
          e.x = Math.min(Math.max(e.x, s), d.format.widthIn - s - e.w);
          e.y = Math.min(Math.max(e.y, s), d.format.heightIn - s - e.h);
        }
  });
}

export type { PhotoRecord };
