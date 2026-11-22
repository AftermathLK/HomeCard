import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import clsx from 'clsx';
import {
  clampCrop,
  effectiveDpi,
  MAX_ZOOM,
  photoContentBox,
  placeImage,
  resolveTokens,
  rotatedBounds,
  type CardElement,
  type PhotoElement,
  type PhotoRecord,
  type TextElement,
} from '@homecard/shared';
import { Check, Copy, Crop, Eye, ImagePlus, Lock, MoveDown, MoveUp, Pencil, ScanFace, Trash2, Unlock } from 'lucide-react';
import { addPhotoFrame, deleteElements, duplicateElements, nudge, placeIntoFrame, reorder, resolvePhotos, smartCrop, swapPhotos } from '@/lib/actions';
import { upload } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { previewUrl } from '@/lib/image';
import { CardSurface, RenderEnvContext, textFont, type RenderEnv } from '@/render/CardSurface';
import { findElement, useEditor, useProject, useSurface } from '@/store/editor';
import { useUi } from '@/store/ui';
import { PX, resizeBox, round3, snapBox, snapLines } from './geometry';

export const PHOTO_MIME = 'application/x-homecard-photo';

type Gesture =
  | { kind: 'move'; ids: string[]; start: Map<string, { x: number; y: number }>; sx: number; sy: number; moved: boolean; clickId: string | null }
  | { kind: 'resize'; id: string; hx: number; hy: number; start: { x: number; y: number; w: number; h: number; rotation: number }; sx: number; sy: number }
  | { kind: 'rotate'; id: string; cx: number; cy: number; start: number; a0: number }
  | { kind: 'pan-crop'; id: string; sx: number; sy: number; start: { cx: number; cy: number } }
  | { kind: 'scroll'; sx: number; sy: number; left: number; top: number };

const HANDLES: Array<{ id: string; hx: number; hy: number; cursor: string }> = [
  { id: 'nw', hx: -1, hy: -1, cursor: 'nwse-resize' },
  { id: 'n', hx: 0, hy: -1, cursor: 'ns-resize' },
  { id: 'ne', hx: 1, hy: -1, cursor: 'nesw-resize' },
  { id: 'e', hx: 1, hy: 0, cursor: 'ew-resize' },
  { id: 'se', hx: 1, hy: 1, cursor: 'nwse-resize' },
  { id: 's', hx: 0, hy: 1, cursor: 'ns-resize' },
  { id: 'sw', hx: -1, hy: 1, cursor: 'nesw-resize' },
  { id: 'w', hx: -1, hy: 0, cursor: 'ew-resize' },
];

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Canvas() {
  const project = useProject();
  const surface = useSurface();
  const selection = useEditor((s) => s.selection);
  const packs = useAssets((s) => s.packs);
  const zoomPref = useUi((s) => s.zoom);
  const showGuides = useUi((s) => s.showGuides);
  const cropId = useUi((s) => s.cropId);
  const editingId = useUi((s) => s.editingTextId);
  const compareIds = useUi((s) => s.compareIds);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 900, h: 700 });
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const f = project?.format;
  const b = f?.bleedIn ?? 0;
  const bw = f ? (f.widthIn + 2 * b) * PX : 1;
  const bh = f ? (f.heightIn + 2 * b) * PX : 1;
  const fit = Math.max(0.1, Math.min((viewport.w - 96) / bw, (viewport.h - 120) / bh));
  const z = zoomPref === 'fit' ? fit : zoomPref;
  const sheetW = Math.max(viewport.w, bw * z + 160);
  const sheetH = Math.max(viewport.h, bh * z + 200);
  const ox = (sheetW - bw * z) / 2;
  const oy = Math.max(56, (sheetH - bh * z) / 2);
  const k = PX * z; // screen px per inch

  // expose the fit level for the zoom control
  useEffect(() => {
    (window as any).__hcFitZoom = fit;
  }, [fit]);

  const toScreen = useCallback((x: number, y: number) => ({ x: ox + (b + x) * k, y: oy + (b + y) * k }), [ox, oy, b, k]);
  const fromClient = useCallback(
    (cx: number, cy: number) => {
      const r = scrollRef.current!.getBoundingClientRect();
      const sx = cx - r.left + scrollRef.current!.scrollLeft;
      const sy = cy - r.top + scrollRef.current!.scrollTop;
      return { x: (sx - ox) / k - b, y: (sy - oy) / k - b };
    },
    [ox, oy, b, k],
  );

  const env = useMemo<RenderEnv>(
    () => ({ mode: 'editor', dpi: 96, compareIds, hiddenIds: editingId ? new Set([editingId]) : undefined, showEmptySlots: true }),
    [compareIds, editingId],
  );

  const selectedEls = useMemo(() => (surface ? surface.elements.filter((e) => selection.includes(e.id)) : []), [surface, selection]);
  const single = selectedEls.length === 1 ? selectedEls[0] : null;

  /* ---------------- hit testing ---------------- */

  const elementAt = useCallback(
    (clientX: number, clientY: number, opts: { photosOnly?: boolean; includeLocked?: boolean } = {}): CardElement | null => {
      if (!surface || !stageRef.current) return null;
      const stack = document.elementsFromPoint(clientX, clientY);
      for (const node of stack) {
        if (!stageRef.current.contains(node)) continue;
        const host = (node as HTMLElement).closest('[data-el]') as HTMLElement | null;
        if (!host) continue;
        const el = surface.elements.find((e) => e.id === host.dataset.el);
        if (!el) continue;
        if (el.type === 'scrim') continue;
        if (el.locked && !opts.includeLocked) continue;
        if (opts.photosOnly && el.type !== 'photo') continue;
        return el;
      }
      return null;
    },
    [surface],
  );

  /* ---------------- pointer gestures ---------------- */

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!project || !surface || e.button === 1) {
      if (e.button === 1 && scrollRef.current) {
        gesture.current = { kind: 'scroll', sx: e.clientX, sy: e.clientY, left: scrollRef.current.scrollLeft, top: scrollRef.current.scrollTop };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }
      return;
    }
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest('[data-handle]') as HTMLElement | null;
    const ed = useEditor.getState();

    if (cropId) {
      const found = findElement(project, cropId);
      if (found && found.el.type === 'photo' && found.el.fill && target.closest('[data-crop-surface]')) {
        gesture.current = { kind: 'pan-crop', id: cropId, sx: e.clientX, sy: e.clientY, start: { cx: found.el.fill.crop.cx, cy: found.el.fill.crop.cy } };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      if (!target.closest('[data-toolbar]')) useUi.setState({ cropId: null });
      return;
    }

    if (handle && single) {
      const h = handle.dataset.handle!;
      if (h === 'rotate') {
        const c = toScreen(single.x + single.w / 2, single.y + single.h / 2);
        const r = scrollRef.current!.getBoundingClientRect();
        const cx = c.x - scrollRef.current!.scrollLeft + r.left;
        const cy = c.y - scrollRef.current!.scrollTop + r.top;
        gesture.current = { kind: 'rotate', id: single.id, cx, cy, start: single.rotation || 0, a0: Math.atan2(e.clientY - cy, e.clientX - cx) };
      } else {
        const def = HANDLES.find((x) => x.id === h)!;
        gesture.current = { kind: 'resize', id: single.id, hx: def.hx, hy: def.hy, start: { x: single.x, y: single.y, w: single.w, h: single.h, rotation: single.rotation || 0 }, sx: e.clientX, sy: e.clientY };
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (target.closest('[data-toolbar]') || target.closest('[data-text-editor]')) return;
    if (editingId) useUi.setState({ editingTextId: null });

    const el = elementAt(e.clientX, e.clientY);
    if (!el) {
      ed.select(null);
      return;
    }
    let ids = selection;
    if (e.shiftKey) {
      ids = selection.includes(el.id) ? selection.filter((x) => x !== el.id) : [...selection, el.id];
      ed.select(ids);
    } else if (!selection.includes(el.id)) {
      ids = [el.id];
      ed.select(ids);
    }
    const movable = surface.elements.filter((x) => ids.includes(x.id) && !x.locked);
    gesture.current = {
      kind: 'move',
      ids: movable.map((x) => x.id),
      start: new Map(movable.map((x) => [x.id, { x: x.x, y: x.y }])),
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      clickId: el.id,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) {
      if (!project || cropId) return;
      const el = elementAt(e.clientX, e.clientY);
      const id = el?.id ?? null;
      if (id !== hoverId) setHoverId(id);
      return;
    }
    if (!project || !surface) return;
    const ed = useEditor.getState();
    const tol = 7 / k;
    if (g.kind === 'scroll') {
      scrollRef.current!.scrollLeft = g.left - (e.clientX - g.sx);
      scrollRef.current!.scrollTop = g.top - (e.clientY - g.sy);
      return;
    }
    if (g.kind === 'move') {
      const dx = (e.clientX - g.sx) / k;
      const dy = (e.clientY - g.sy) / k;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 3) return;
      g.moved = true;
      if (!g.ids.length) return;
      const lead = surface.elements.find((x) => x.id === g.ids[0])!;
      const s0 = g.start.get(lead.id)!;
      let ddx = dx, ddy = dy;
      if (!e.altKey) {
        const lines = snapLines(project.format, surface.elements, new Set(g.ids));
        const r0 = rotatedBounds({ x: s0.x + dx, y: s0.y + dy, w: lead.w, h: lead.h }, lead.rotation || 0);
        const snapped = snapBox(r0, lines, tol);
        ddx += snapped.rect.x - r0.x;
        ddy += snapped.rect.y - r0.y;
        setGuides({ x: snapped.guidesX, y: snapped.guidesY });
      } else setGuides({ x: [], y: [] });
      ed.edit((d) => {
        const s = d.surfaces.find((x) => x.id === surface.id)!;
        for (const el of s.elements) {
          const st = g.start.get(el.id);
          if (st) {
            el.x = round3(st.x + ddx);
            el.y = round3(st.y + ddy);
          }
        }
      }, `move:${g.ids.join(',')}`);
      return;
    }
    if (g.kind === 'resize') {
      const el = surface.elements.find((x) => x.id === g.id);
      if (!el) return;
      const dX = (e.clientX - g.sx) / k;
      const dY = (e.clientY - g.sy) / k;
      const keepAspect = (el.type === 'ornament' || el.type === 'sticker') ? !e.shiftKey : e.shiftKey;
      let r = resizeBox(g.start, g.hx, g.hy, dX, dY, keepAspect, 0.1);
      if (!g.start.rotation && !e.altKey && !keepAspect) {
        const lines = snapLines(project.format, surface.elements, new Set([g.id]));
        const snapEdge = (v: number, axis: 'x' | 'y') => {
          let best = tol, out = v;
          for (const l of axis === 'x' ? lines.xs : lines.ys) if (Math.abs(l.v - v) < best) { best = Math.abs(l.v - v); out = l.v; }
          return out;
        };
        let { x, y, w, h } = r;
        if (g.hx === 1) w = snapEdge(x + w, 'x') - x;
        if (g.hx === -1) { const nx = snapEdge(x, 'x'); w += x - nx; x = nx; }
        if (g.hy === 1) h = snapEdge(y + h, 'y') - y;
        if (g.hy === -1) { const ny = snapEdge(y, 'y'); h += y - ny; y = ny; }
        r = { x, y, w: Math.max(0.1, w), h: Math.max(0.1, h) };
      }
      ed.updateElement(g.id, (d) => {
        d.x = round3(r.x);
        d.y = round3(r.y);
        d.w = round3(r.w);
        d.h = round3(r.h);
        if (d.type === 'photo' && d.fill) {
          const box = photoContentBox(d);
          d.fill.crop = { ...clampCrop(box.w, box.h, d.fill.width, d.fill.height, d.fill.crop) };
        }
      }, `resize:${g.id}`);
      return;
    }
    if (g.kind === 'rotate') {
      const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      let deg = g.start + ((a - g.a0) * 180) / Math.PI;
      deg = ((deg % 360) + 540) % 360 - 180;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(deg - s) < 3) deg = s;
      ed.updateElement(g.id, { rotation: Math.round(deg * 10) / 10 }, `rotate:${g.id}`);
      return;
    }
    if (g.kind === 'pan-crop') {
      const found = findElement(project, g.id);
      if (!found || found.el.type !== 'photo' || !found.el.fill) return;
      const el = found.el as PhotoElement;
      const fill = el.fill!;
      const th = ((el.rotation || 0) * Math.PI) / 180;
      const dX = (e.clientX - g.sx) / k, dY = (e.clientY - g.sy) / k;
      const lx = dX * Math.cos(th) + dY * Math.sin(th);
      const ly = -dX * Math.sin(th) + dY * Math.cos(th);
      const box = photoContentBox(el);
      const pl = placeImage(box.w, box.h, fill.width, fill.height, fill.crop);
      const next = clampCrop(box.w, box.h, fill.width, fill.height, { ...fill.crop, cx: g.start.cx - lx / pl.width, cy: g.start.cy - ly / pl.height, mode: 'manual' });
      ed.updateElement(g.id, (d) => {
        if (d.type === 'photo' && d.fill) d.fill.crop = next;
      }, `crop:${g.id}`);
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setGuides({ x: [], y: [] });
    if (!g || !project || !surface) return;
    if (g.kind === 'move' && !g.moved && g.clickId) {
      const el = surface.elements.find((x) => x.id === g.clickId);
      if (el?.type === 'photo' && !el.fill && !e.shiftKey) useUi.setState({ picker: { elementId: el.id, multiple: false } });
    }
    if (g.kind === 'resize') {
      // Re-run smart crop for auto-cropped photos at the new frame size.
      const el = surface.elements.find((x) => x.id === g.id);
      if (el?.type === 'photo' && el.fill && el.fill.crop.mode === 'auto') smartCrop(el.id);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!surface) return;
    const el = elementAt(e.clientX, e.clientY);
    if (!el) return;
    if (el.type === 'text') useUi.setState({ editingTextId: el.id });
    if (el.type === 'photo') {
      if (el.fill) useUi.setState({ cropId: el.id });
      else useUi.setState({ picker: { elementId: el.id, multiple: false } });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (cropId && project) {
      e.preventDefault();
      const found = findElement(project, cropId);
      if (!found || found.el.type !== 'photo' || !found.el.fill) return;
      const el = found.el;
      const fill = el.fill!;
      const box = photoContentBox(el);
      const zoom = Math.min(MAX_ZOOM, Math.max(1, fill.crop.zoom * Math.exp(-e.deltaY * 0.0015)));
      useEditor.getState().updateElement(el.id, (d) => {
        if (d.type === 'photo' && d.fill) d.fill.crop = clampCrop(box.w, box.h, fill.width, fill.height, { ...fill.crop, zoom, mode: 'manual' });
      }, `crop:${el.id}`);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const nz = Math.min(6, Math.max(0.15, z * Math.exp(-e.deltaY * 0.002)));
      useUi.setState({ zoom: nz });
    }
  };

  // Prevent page zoom on ctrl+wheel (React's onWheel is passive).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || useUi.getState().cropId) e.preventDefault();
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  /* ---------------- drag & drop ---------------- */

  const onDragOver = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(PHOTO_MIME) && !types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const el = elementAt(e.clientX, e.clientY, { photosOnly: true });
    setDropId(el?.id ?? null);
  };

  const placeRecord = (rec: PhotoRecord, target: CardElement | null) => {
    const ed = useEditor.getState();
    const s = useEditor.getState().project?.surfaces.find((x) => x.id === ed.surfaceId);
    if (!s) return;
    const frame = (target?.type === 'photo' ? target : null) ?? (s.elements.find((x) => x.type === 'photo' && !x.fill) as PhotoElement | undefined);
    if (frame) placeIntoFrame(s.id, frame.id, rec);
    else addPhotoFrame(rec);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropId(null);
    const target = elementAt(e.clientX, e.clientY, { photosOnly: true });
    const json = e.dataTransfer.getData(PHOTO_MIME);
    if (json) {
      const payload = JSON.parse(json) as { record: PhotoRecord; fromElement?: string };
      if (payload.fromElement && target && payload.fromElement !== target.id) swapPhotos(payload.fromElement, target.id);
      else placeRecord(payload.record, target);
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((f) => /^image\//.test(f.type) || /\.(heic|heif|tiff?)$/i.test(f.name));
    if (!files.length) return;
    const toast = useUi.getState().toast;
    toast(`Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…`);
    try {
      const r = await upload<{ items: Array<{ ref: string }>; rejected: string[] }>('/api/uploads', files);
      const recs = await resolvePhotos(r.items);
      const ed = useEditor.getState();
      ed.edit((d) => {
        for (const rec of recs) if (!d.photos.some((x) => x.ref === rec.ref)) d.photos.push(rec);
      });
      if (recs[0]) placeRecord(recs[0], target);
      if (r.rejected.length) toast(`Skipped: ${r.rejected.join(', ')}`, 'error');
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const ed = useEditor.getState();
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;
      const sel = ed.selection;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) ed.redo();
        else ed.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        ed.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && sel.length) {
        e.preventDefault();
        duplicateElements(sel);
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void ed.saveNow();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        ui.set({ zoom: Math.min(6, (ui.zoom === 'fit' ? (window as any).__hcFitZoom ?? 1 : ui.zoom) * 1.2) });
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        ui.set({ zoom: Math.max(0.15, (ui.zoom === 'fit' ? (window as any).__hcFitZoom ?? 1 : ui.zoom) / 1.2) });
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        ui.set({ zoom: 'fit' });
        return;
      }
      if (e.key === 'Escape') {
        if (ui.cropId) ui.set({ cropId: null });
        else if (ui.editingTextId) ui.set({ editingTextId: null });
        else ed.select(null);
        return;
      }
      if (!sel.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteElements(sel);
        return;
      }
      if (e.key === 'Enter' && sel.length === 1) {
        const found = ed.project && findElement(ed.project, sel[0]);
        if (found?.el.type === 'text') ui.set({ editingTextId: sel[0] });
        if (found?.el.type === 'photo' && found.el.fill) ui.set({ cropId: sel[0] });
        return;
      }
      const step = e.shiftKey ? 0.25 : 1 / 32;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key]) {
        e.preventDefault();
        nudge(sel, ...arrows[e.key]);
        return;
      }
      if (e.key === ']') reorder(sel[0], e.shiftKey ? 'top' : 'up');
      if (e.key === '[') reorder(sel[0], e.shiftKey ? 'bottom' : 'down');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!project || !surface || !f) return <div ref={scrollRef} className="flex-1" />;

  const showOverlay = showGuides;
  const hover = hoverId && !selection.includes(hoverId) ? surface.elements.find((e) => e.id === hoverId) : null;
  const cropEl = cropId ? (surface.elements.find((e) => e.id === cropId) as PhotoElement | undefined) : undefined;
  const editingEl = editingId ? (surface.elements.find((e) => e.id === editingId) as TextElement | undefined) : undefined;

  const elScreen = (el: CardElement): CSSProperties => {
    const p = toScreen(el.x, el.y);
    return { position: 'absolute', left: p.x, top: p.y, width: el.w * k, height: el.h * k, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined, transformOrigin: 'center' };
  };

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_50%_40%,#f1ece4,#e6dfd3)]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHoverId(null)}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onDragOver={onDragOver}
      onDragLeave={() => setDropId(null)}
      onDrop={onDrop}
      style={{ touchAction: 'none' }}
    >
      <div style={{ position: 'relative', width: sheetW, height: sheetH }}>
        {/* Card stage (scaled). The bleed box is the visible paper. */}
        <div
          ref={stageRef}
          data-stage
          style={{
            position: 'absolute',
            left: ox,
            top: oy,
            width: bw * z,
            height: bh * z,
            overflow: 'hidden',
            boxShadow: '0 1px 2px rgba(0,0,0,.08), 0 18px 50px -12px rgba(40,30,20,.35)',
            background: '#fff',
          }}
        >
          <div style={{ position: 'absolute', left: 0, top: 0, width: bw, height: bh, transform: `scale(${z})`, transformOrigin: '0 0' }}>
            <div style={{ position: 'absolute', left: b * PX, top: b * PX }}>
              <RenderEnvContext.Provider value={env}>
                <CardSurface project={project} surface={surface} packs={packs} />
              </RenderEnvContext.Provider>
            </div>
          </div>
        </div>

        {/* Print guides: bleed (trimmed away), trim line, safe zone. */}
        <svg
          width={sheetW}
          height={sheetH}
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          {(() => {
            const tl = toScreen(0, 0);
            const br = toScreen(f.widthIn, f.heightIn);
            const sl = toScreen(f.safeIn, f.safeIn);
            const sr = toScreen(f.widthIn - f.safeIn, f.heightIn - f.safeIn);
            const bl = toScreen(-b, -b);
            const bb = toScreen(f.widthIn + b, f.heightIn + b);
            return (
              <g>
                {b > 0 && (
                  <path
                    d={`M${bl.x} ${bl.y}H${bb.x}V${bb.y}H${bl.x}Z M${tl.x} ${tl.y}V${br.y}H${br.x}V${tl.y}Z`}
                    fill={showOverlay ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.0)'}
                    fillRule="evenodd"
                  />
                )}
                <rect x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y} fill="none" stroke="rgba(30,25,20,0.55)" strokeWidth={1} />
                {showOverlay && (
                  <>
                    <rect x={sl.x} y={sl.y} width={sr.x - sl.x} height={sr.y - sl.y} fill="none" stroke="#2b7a9c" strokeWidth={1} strokeDasharray="5 4" opacity={0.75} />
                    {b > 0 && z > 0.35 && (
                      <text x={bl.x + 4} y={bl.y + 11} fontSize={9.5} fill="#b4533c" fontFamily="system-ui">
                        BLEED — trimmed off
                      </text>
                    )}
                    {z > 0.35 && (
                      <text x={sl.x + 4} y={sl.y + 12} fontSize={9.5} fill="#2b7a9c" fontFamily="system-ui">
                        SAFE ZONE
                      </text>
                    )}
                  </>
                )}
                {guides.x.map((gx) => {
                  const p = toScreen(gx, 0);
                  return <line key={`gx${gx}`} x1={p.x} x2={p.x} y1={bl.y - 20} y2={bb.y + 20} stroke="#e0368a" strokeWidth={1} />;
                })}
                {guides.y.map((gy) => {
                  const p = toScreen(0, gy);
                  return <line key={`gy${gy}`} y1={p.y} y2={p.y} x1={bl.x - 20} x2={bb.x + 20} stroke="#e0368a" strokeWidth={1} />;
                })}
              </g>
            );
          })()}
        </svg>

        {/* Hover + drop outlines */}
        {hover && !cropId && <div style={{ ...elScreen(hover), outline: '1px solid rgba(47,93,80,.55)', pointerEvents: 'none' }} />}
        {dropId && (() => {
          const el = surface.elements.find((e) => e.id === dropId);
          return el ? <div style={{ ...elScreen(el), outline: '3px solid #2f5d50', background: 'rgba(47,93,80,.15)', pointerEvents: 'none' }} /> : null;
        })()}

        {/* Selection */}
        {!cropId &&
          selectedEls.map((el) => (
            <div key={el.id} style={{ ...elScreen(el), outline: `1.5px solid ${el.locked ? '#999' : '#2f5d50'}`, pointerEvents: 'none' }}>
              {single && single.id === el.id && !el.locked && !editingId && (
                <>
                  {HANDLES.map((h) => (
                    <div
                      key={h.id}
                      data-handle={h.id}
                      style={{
                        position: 'absolute',
                        left: `${(h.hx + 1) * 50}%`,
                        top: `${(h.hy + 1) * 50}%`,
                        width: 11,
                        height: 11,
                        marginLeft: -5.5,
                        marginTop: -5.5,
                        background: '#fff',
                        border: '1.5px solid #2f5d50',
                        borderRadius: h.hx && h.hy ? 3 : 6,
                        cursor: h.cursor,
                        pointerEvents: 'auto',
                      }}
                    />
                  ))}
                  <div style={{ position: 'absolute', left: '50%', top: -26, width: 1, height: 20, background: '#2f5d50' }} />
                  <div
                    data-handle="rotate"
                    title="Rotate (Shift = 15° steps)"
                    style={{ position: 'absolute', left: '50%', top: -34, width: 14, height: 14, marginLeft: -7, borderRadius: 7, background: '#fff', border: '1.5px solid #2f5d50', cursor: 'grab', pointerEvents: 'auto' }}
                  />
                </>
              )}
            </div>
          ))}

        {/* Crop mode */}
        {cropEl && cropEl.fill && <CropOverlay el={cropEl} style={elScreen(cropEl)} k={k} />}

        {/* Inline text editing */}
        {editingEl && <InlineTextEditor el={editingEl} style={elScreen(editingEl)} k={k} />}

        {/* Contextual toolbar */}
        {single && !editingId && (
          <FloatingToolbar el={single} anchor={(() => {
            const r = rotatedBounds({ x: single.x, y: single.y, w: single.w, h: single.h }, single.rotation || 0);
            const p = toScreen(r.x + r.w / 2, r.y);
            const q = toScreen(r.x + r.w / 2, r.y + r.h);
            return { x: p.x, top: p.y, bottom: q.y };
          })()} cropping={!!cropId} />
        )}
      </div>
    </div>
  );
}

/* ---------------- Crop overlay ---------------- */

function CropOverlay({ el, style, k }: { el: PhotoElement; style: CSSProperties; k: number }) {
  const fill = el.fill!;
  const box = photoContentBox(el);
  const pl = placeImage(box.w, box.h, fill.width, fill.height, fill.crop);
  const dpi = effectiveDpi(box.w, box.h, fill.width, fill.height, fill.crop.zoom);
  return (
    <div style={{ ...style, pointerEvents: 'none' }}>
      <div data-crop-surface style={{ position: 'absolute', left: box.x * k, top: box.y * k, width: box.w * k, height: box.h * k, pointerEvents: 'auto', cursor: 'move' }}>
        <img
          src={previewUrl(fill.ref)}
          alt=""
          draggable={false}
          style={{ position: 'absolute', left: pl.left * k, top: pl.top * k, width: pl.width * k, height: pl.height * k, maxWidth: 'none', opacity: 0.38, pointerEvents: 'none' }}
        />
        <div style={{ position: 'absolute', inset: 0, outline: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.4)' }} />
        {/* rule of thirds */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
          {[1, 2].map((i) => (
            <g key={i} stroke="rgba(255,255,255,.7)" strokeWidth={1}>
              <line x1={`${(i * 100) / 3}%`} x2={`${(i * 100) / 3}%`} y1="0" y2="100%" />
              <line y1={`${(i * 100) / 3}%`} y2={`${(i * 100) / 3}%`} x1="0" x2="100%" />
            </g>
          ))}
          {(fill.faces ?? []).map((fc, i) => (
            <rect
              key={i}
              x={(pl.left + fc.x * pl.width) * k}
              y={(pl.top + fc.y * pl.height) * k}
              width={fc.w * pl.width * k}
              height={fc.h * pl.height * k}
              fill="none"
              stroke="#ffd166"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              rx={4}
            />
          ))}
        </svg>
      </div>
      <div
        data-toolbar
        style={{ position: 'absolute', left: '50%', bottom: -54, transform: 'translateX(-50%)', pointerEvents: 'auto' }}
        className="flex items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-white px-3 py-2 shadow-pop"
      >
        <span className="text-xs text-ink-3">Zoom</span>
        <input
          type="range"
          className="range w-32"
          min={0}
          max={1}
          step={0.001}
          value={Math.log(fill.crop.zoom) / Math.log(MAX_ZOOM)}
          style={{ ['--fill' as any]: `${(Math.log(fill.crop.zoom) / Math.log(MAX_ZOOM)) * 100}%` }}
          onChange={(e) => {
            const zoom = Math.pow(MAX_ZOOM, Number(e.target.value));
            useEditor.getState().updateElement(el.id, (d) => {
              if (d.type === 'photo' && d.fill) d.fill.crop = clampCrop(box.w, box.h, fill.width, fill.height, { ...d.fill.crop, zoom, mode: 'manual' });
            }, `crop:${el.id}`);
          }}
        />
        <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-semibold', dpi >= 250 ? 'bg-ok-soft text-ok' : dpi >= 180 ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad')}>
          {Math.round(dpi)} DPI
        </span>
        <button className="btn btn-sm" onClick={() => smartCrop(el.id)} title="Face-aware automatic framing">
          <ScanFace size={14} /> Smart crop
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => useUi.setState({ cropId: null })}>
          <Check size={14} /> Done
        </button>
      </div>
    </div>
  );
}

/* ---------------- Inline text editor ---------------- */

function InlineTextEditor({ el, style, k }: { el: TextElement; style: CSSProperties; k: number }) {
  const project = useProject()!;
  const ref = useRef<HTMLTextAreaElement>(null);
  const font = textFont(el, project.theme);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [el.id]);
  const hasTokens = /\{\{/.test(el.text);
  return (
    <div data-text-editor style={{ ...style, display: 'flex', flexDirection: 'column', justifyContent: el.vAlign === 'top' ? 'flex-start' : el.vAlign === 'bottom' ? 'flex-end' : 'center' }}>
      <textarea
        ref={ref}
        value={el.text}
        spellCheck
        onChange={(e) => useEditor.getState().updateElement(el.id, { text: e.target.value, isPlaceholder: false } as Partial<TextElement>, `text:${el.id}`)}
        onBlur={() => useUi.setState({ editingTextId: null })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            useUi.setState({ editingTextId: null });
          }
          e.stopPropagation();
        }}
        style={{
          width: '100%',
          height: '100%',
          resize: 'none',
          background: 'rgba(255,255,255,0.82)',
          outline: '2px solid #2f5d50',
          border: 'none',
          borderRadius: 4,
          padding: 0,
          color: '#1f1b16',
          fontFamily: `"${font.family}", serif`,
          fontWeight: font.weight,
          fontStyle: font.style,
          fontSize: el.fontSize * (96 / 72) * (k / 96),
          lineHeight: el.lineHeight,
          letterSpacing: font.letterSpacing ? `${font.letterSpacing}em` : undefined,
          textTransform: font.transform === 'uppercase' ? 'uppercase' : 'none',
          textAlign: el.align,
          overflow: 'hidden',
        }}
      />
      {hasTokens && (
        <div className="absolute -bottom-7 left-0 whitespace-nowrap rounded bg-ink px-2 py-0.5 text-[11px] text-white">
          Shows as: {resolveTokens(el.text, project).slice(0, 60)}
        </div>
      )}
    </div>
  );
}

/* ---------------- Floating toolbar ---------------- */

function FloatingToolbar({ el, anchor, cropping }: { el: CardElement; anchor: { x: number; top: number; bottom: number }; cropping: boolean }) {
  if (cropping) return null;
  const top = anchor.top - 64 < 4 ? anchor.bottom + 16 : anchor.top - 58;
  const ui = useUi.getState();
  const hasPolish = el.type === 'photo' && !!el.fill;
  return (
    <div
      data-toolbar
      className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-white p-1 shadow-pop fade-in"
      style={{ left: anchor.x, top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {el.type === 'photo' && (
        <>
          <button className="icon-btn" title="Replace photo" onClick={() => ui.set({ picker: { elementId: el.id, multiple: false } })}>
            <ImagePlus size={16} />
          </button>
          {el.fill && (
            <button className="icon-btn" title="Crop & position (double-click)" onClick={() => ui.set({ cropId: el.id })}>
              <Crop size={16} />
            </button>
          )}
          {hasPolish && (
            <button
              className="icon-btn"
              title="Hold to compare with the original"
              onPointerDown={(e) => {
                e.stopPropagation();
                useUi.getState().setCompare(el.id, true);
              }}
              onPointerUp={() => useUi.getState().setCompare(el.id, false)}
              onPointerLeave={() => useUi.getState().setCompare(el.id, false)}
            >
              <Eye size={16} />
            </button>
          )}
        </>
      )}
      {el.type === 'text' && (
        <button className="icon-btn" title="Edit text (double-click / Enter)" onClick={() => ui.set({ editingTextId: el.id })}>
          <Pencil size={16} />
        </button>
      )}
      <div className="mx-0.5 h-5 w-px bg-line" />
      <button className="icon-btn" title="Bring forward ( ] )" onClick={() => reorder(el.id, 'up')}>
        <MoveUp size={16} />
      </button>
      <button className="icon-btn" title="Send backward ( [ )" onClick={() => reorder(el.id, 'down')}>
        <MoveDown size={16} />
      </button>
      <button className="icon-btn" title="Duplicate (Ctrl+D)" onClick={() => duplicateElements([el.id])}>
        <Copy size={16} />
      </button>
      <button
        className="icon-btn"
        title={el.locked ? 'Unlock' : 'Lock position'}
        onClick={() => useEditor.getState().updateElement(el.id, { locked: !el.locked }, null)}
      >
        {el.locked ? <Unlock size={16} /> : <Lock size={16} />}
      </button>
      <button className="icon-btn hover:!text-bad" title="Delete (Del)" onClick={() => deleteElements([el.id])}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}
