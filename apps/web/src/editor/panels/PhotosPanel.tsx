import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { ImagePlus, LayoutGrid, Plus, RefreshCw, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { DPI_GOOD, DPI_MIN, photoDpi, type PhotoElement, type PhotoRecord } from '@homecard/shared';
import { Dropzone, Section } from '@/components/ui';
import { addPhotoFrame, addToTray, autoFill, placeIntoFrame, refitAll, removeFromTray, resolvePhotos } from '@/lib/actions';
import { upload } from '@/lib/api';
import { thumbUrl } from '@/lib/image';
import { PHOTO_MIME } from '@/editor/Canvas';
import { useEditor, useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

/** The card's photo tray: everything picked for this card, ready to drag into frames. */
export function PhotosPanel({ compact }: { compact?: boolean }) {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const selection = useEditor((s) => s.selection);
  const [uploading, setUploading] = useState<number | null>(null);

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    if (!project) return m;
    for (const s of project.surfaces) for (const e of s.elements) if (e.type === 'photo' && e.fill) m.set(e.fill.ref, (m.get(e.fill.ref) ?? 0) + 1);
    return m;
  }, [project]);

  const frames = useMemo(() => {
    if (!project) return { total: 0, empty: 0, low: 0 };
    let total = 0, empty = 0, low = 0;
    for (const s of project.surfaces)
      for (const e of s.elements)
        if (e.type === 'photo') {
          total++;
          if (!e.fill) empty++;
          else if ((photoDpi(e) ?? 999) < DPI_GOOD) low++;
        }
    return { total, empty, low };
  }, [project]);

  if (!project) return null;
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;

  const place = (rec: PhotoRecord) => {
    const sel = surface.elements.find((e) => e.id === selection[0]);
    const target = (sel?.type === 'photo' ? sel : null) ?? (surface.elements.find((e) => e.type === 'photo' && !e.fill) as PhotoElement | undefined);
    if (target) placeIntoFrame(surface.id, target.id, rec);
    else addPhotoFrame(rec);
  };

  const onFiles = async (files: File[]) => {
    setUploading(0);
    try {
      const r = await upload<{ items: Array<{ ref: string }>; rejected: string[] }>('/api/uploads', files, setUploading);
      const recs = await resolvePhotos(r.items);
      addToTray(recs);
      if (r.rejected.length) useUi.getState().toast(`Skipped unsupported files: ${r.rejected.join(', ')}`, 'error');
      else useUi.getState().toast(`Added ${recs.length} photo${recs.length === 1 ? '' : 's'}.`, 'ok');
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setUploading(null);
    }
  };

  return (
    <>
      <Section
        title="Your photos"
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => useUi.setState({ picker: { elementId: null, multiple: true } })}>
            <ImagePlus size={14} /> Add photos
          </button>
        }
      >
        {!project.photos.length ? (
          <Dropzone onFiles={onFiles} accept="image/*,.heic,.heif,.tif,.tiff" className="py-8">
            <Upload size={24} className="mx-auto mb-2 text-brand" />
            <div className="text-[13px] font-medium">Drop photos here</div>
            <div className="mt-1 text-xs text-ink-3">or use “Add photos” to browse Immich and your photo folder</div>
          </Dropzone>
        ) : (
          <>
            <div className={clsx('grid gap-1.5', compact ? 'grid-cols-3' : 'grid-cols-3')}>
              {project.photos.map((rec) => {
                const used = usage.get(rec.ref) ?? 0;
                return (
                  <div
                    key={rec.ref}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(PHOTO_MIME, JSON.stringify({ record: rec }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => place(rec)}
                    className="group relative aspect-square cursor-grab overflow-hidden rounded-lg bg-paper-3 active:cursor-grabbing"
                    title={`${rec.name} — ${rec.width}×${rec.height}px. Click to place, or drag onto a frame.`}
                  >
                    <img src={thumbUrl(rec.ref)} alt="" className="h-full w-full object-cover" draggable={false} />
                    {used > 0 && <span className="absolute bottom-1 left-1 rounded bg-brand px-1 text-[10px] font-semibold text-white">On card</span>}
                    {rec.faces && rec.faces.length > 0 && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/45 px-1 text-[10px] text-white" title="Faces found — used for smart cropping">
                        {rec.faces.length} face{rec.faces.length > 1 ? 's' : ''}
                      </span>
                    )}
                    <button
                      className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white group-hover:flex"
                      title="Remove from this card's tray"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromTray(rec.ref);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <Dropzone onFiles={onFiles} accept="image/*,.heic,.heif,.tif,.tiff" className="flex aspect-square items-center justify-center !p-1">
                {uploading !== null ? <span className="text-xs text-ink-3">{Math.round(uploading * 100)}%</span> : <Plus size={20} className="text-ink-3" />}
              </Dropzone>
            </div>
            <p className="mt-2 text-xs text-ink-3">Click a photo to drop it into the selected (or next empty) frame, or drag it onto any frame. Drag between frames to swap.</p>
          </>
        )}
      </Section>
      <Section title="Frames">
        <div className="mb-2 text-[13px] text-ink-2">
          {frames.total} photo frame{frames.total === 1 ? '' : 's'} · {frames.empty ? <span className="font-medium text-warn">{frames.empty} empty</span> : 'all filled'}
          {frames.low > 0 && <span className="text-warn"> · {frames.low} below {DPI_GOOD} DPI</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn btn-sm" disabled={!project.photos.length || !frames.empty} onClick={() => autoFill()} title="Fill empty frames with tray photos, best matches first">
            <Sparkles size={14} /> Auto-fill frames
          </button>
          <button className="btn btn-sm" onClick={() => refitAll()} title="Re-run face-aware framing on every auto-cropped photo">
            <Wand2 size={14} /> Re-frame faces
          </button>
          <button className="btn btn-sm" onClick={() => addPhotoFrame()}>
            <LayoutGrid size={14} /> Add frame
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Photos are framed automatically around faces. Under {DPI_MIN} DPI prints visibly soft; {DPI_GOOD}+ is ideal. Double-click a photo on the card to adjust the crop.
        </p>
      </Section>
      {!compact && <RecentHint />}
    </>
  );
}

function RecentHint() {
  return (
    <Section>
      <p className="flex items-start gap-2 text-xs text-ink-3">
        <RefreshCw size={13} className="mt-0.5 shrink-0" />
        Immich originals (HEIC, RAW, WebP) are fetched and converted on the server only when you export, so the editor stays fast.
      </p>
    </Section>
  );
}
