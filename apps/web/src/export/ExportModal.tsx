import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileImage, FileText, Maximize2, Printer, Share2, Trash2, X, ZoomIn } from 'lucide-react';
import {
  DEFAULT_EXPORT_OPTIONS,
  DPI_GOOD,
  DPI_MIN,
  formatBytes,
  getVendor,
  pagePixels,
  buildRenderPages,
  SURFACE_INFO,
  shareDpi,
  type CardProject,
  type ExportFileInfo,
  type ExportFormat,
  type ExportOptions,
  type ExportRecord,
} from '@homecard/shared';
import { Modal, ProgressBar, Section, Segmented, Slider, Spinner, Toggle } from '@/components/ui';
import { useGuardian } from '@/editor/GuardianHost';
import { TrafficLight } from '@/editor/GuardianPanel';
import { api, enc, onServerEvent } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useEditor, useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

const FORMATS: Array<{ id: ExportFormat; name: string; hint: string; icon: React.ReactNode }> = [
  { id: 'pdf', name: 'Print PDF', hint: '300 DPI, vector text, bleed & trim boxes. Best for print shops and most labs.', icon: <FileText size={18} /> },
  { id: 'png', name: 'PNG 300 DPI', hint: 'Lossless images, one per side. Accepted everywhere.', icon: <FileImage size={18} /> },
  { id: 'jpeg', name: 'JPEG 300 DPI', hint: 'Maximum-quality 4:4:4 JPEG — what Mpix, Shutterfly & Costco expect.', icon: <Printer size={18} /> },
  { id: 'share', name: 'Digital Share Pack', hint: '1080 px images for texting, email and social. No bleed.', icon: <Share2 size={18} /> },
];

const fileUrl = (rec: ExportRecord, f: ExportFileInfo, download = false) => `/api/exports/${enc(rec.id)}/files/${enc(f.name)}${download ? '?download=1' : ''}`;
const proofUrl = (rec: ExportRecord, name: string) => `/api/exports/${enc(rec.id)}/proof/${enc(name)}`;

export function ExportModal() {
  const open = useUi((s) => s.exportOpen);
  const project = useProject();
  if (!open || !project) return null;
  return <ExportDialog project={project} />;
}

function ExportDialog({ project }: { project: CardProject }) {
  const close = () => useUi.setState({ exportOpen: false });
  const health = useAssets((s) => s.health);
  const report = useGuardian(project);
  const vendor = getVendor(project.format.vendorId);
  const allSurfaces = project.surfaces.map((s) => s.id);
  const [opts, setOpts] = useState<ExportOptions>(() => ({
    ...DEFAULT_EXPORT_OPTIONS,
    format: vendor.recommendedFormat,
    colorProfile: 'srgb',
    surfaces: allSurfaces,
    layout: project.format.fold === 'folded' ? 'spreads' : 'panels',
  }));
  const [history, setHistory] = useState<ExportRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmRed, setConfirmRed] = useState(false);
  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));

  useEffect(() => {
    void useAssets.getState().loadHealth(true).catch(() => null);
    api.get<ExportRecord[]>(`/api/exports?projectId=${enc(project.id)}`).then((list) => {
      setHistory(list);
      if (list[0]) setActiveId((id) => id ?? list[0].id);
    });
    return onServerEvent((type, data: ExportRecord) => {
      if (type !== 'export' || data.projectId !== project.id) return;
      setHistory((h) => {
        const i = h.findIndex((x) => x.id === data.id);
        if (i < 0) return [data, ...h];
        const next = h.slice();
        next[i] = data;
        return next;
      });
    });
  }, [project.id]);

  const active = history.find((h) => h.id === activeId) ?? null;
  const ghostscript = !!health?.ghostscript.available;
  const cmykProfiles = (health?.iccProfiles ?? []).filter((p) => p.colorSpace === 'cmyk');

  // Predicted output size, using the same page builder the renderer uses.
  const predicted = useMemo(() => {
    if (opts.format === 'share') {
      const dpi = shareDpi(project.format);
      return buildRenderPages(project.format, { surfaces: opts.surfaces, includeBleed: false, cropMarks: false, layout: 'panels' }).map((p) => ({ label: p.label, ...pagePixels(p, dpi), dpi }));
    }
    return buildRenderPages(project.format, { surfaces: opts.surfaces, includeBleed: opts.includeBleed, cropMarks: opts.cropMarks, layout: opts.layout }).map((p) => ({
      label: p.label,
      ...pagePixels(p, opts.dpi),
      dpi: opts.dpi,
    }));
  }, [opts, project.format]);

  const start = async () => {
    if (report?.status === 'red' && !confirmRed) {
      setConfirmRed(true);
      return;
    }
    setStarting(true);
    try {
      await useEditor.getState().saveNow();
      const rec = await api.post<ExportRecord>('/api/exports', { projectId: project.id, options: opts });
      setHistory((h) => [rec, ...h.filter((x) => x.id !== rec.id)]);
      setActiveId(rec.id);
      setConfirmRed(false);
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal open onClose={close} width="max-w-[1180px]" bodyClass="p-0" title="Export for print" subtitle={`${project.name} · ${project.format.widthIn}×${project.format.heightIn}" ${project.format.fold} · ${vendor.name}`}>
      <div className="grid min-h-[560px] grid-cols-[360px_1fr]">
        {/* ---------- Options ---------- */}
        <div className="max-h-[78vh] overflow-auto border-r border-line bg-paper-2/40">
          <Section title="File type">
            <div className="space-y-1.5">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => set({ format: f.id })}
                  className={clsx('flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition', opts.format === f.id ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2')}
                >
                  <span className={clsx('mt-0.5', opts.format === f.id ? 'text-brand' : 'text-ink-3')}>{f.icon}</span>
                  <span>
                    <span className="block text-[13px] font-medium">
                      {f.name}
                      {f.id === vendor.recommendedFormat && <span className="ml-1.5 rounded bg-brand px-1 py-px text-[10px] font-semibold uppercase text-white">{vendor.id === 'generic' ? 'Recommended' : `Best for ${vendor.name}`}</span>}
                    </span>
                    <span className="block text-[11px] text-ink-3">{f.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>
          <Section title="Sides">
            <div className="flex flex-wrap gap-1">
              {allSurfaces.map((sid) => {
                const on = opts.surfaces.includes(sid);
                return (
                  <button
                    key={sid}
                    className={clsx('chip', on && 'chip-on')}
                    onClick={() => set({ surfaces: on ? opts.surfaces.filter((x) => x !== sid) : allSurfaces.filter((x) => x === sid || opts.surfaces.includes(x)) })}
                  >
                    {SURFACE_INFO[sid].label}
                  </button>
                );
              })}
            </div>
            {project.format.fold === 'folded' && opts.format !== 'share' && (
              <div className="mt-2.5">
                <Segmented
                  size="sm"
                  value={opts.layout}
                  onChange={(v) => set({ layout: v })}
                  options={[
                    { value: 'spreads', label: 'Print spreads', title: 'Outside + inside sheets, ready to fold' },
                    { value: 'panels', label: 'Separate panels' },
                  ]}
                />
                <p className="mt-1 text-[11px] text-ink-3">{opts.layout === 'spreads' ? 'Two sheets (outside, inside) with fold marks — what a print shop needs.' : 'Each panel as its own page.'}</p>
              </div>
            )}
          </Section>
          {opts.format !== 'share' ? (
            <Section title="Print settings">
              <Toggle checked={opts.includeBleed} onChange={(v) => set({ includeBleed: v })} label={`Include ${project.format.bleedIn}" bleed`} hint="Background extends past the trim so there are no white slivers. Leave on unless your printer says otherwise." />
              <Toggle checked={opts.cropMarks} onChange={(v) => set({ cropMarks: v })} label="Crop marks" hint="Adds trim marks in a white margin — for print shops that cut by hand. Labs like Mpix don’t want them." />
              {opts.format === 'pdf' && (
                <div className="mt-2">
                  <div className="label">Colour</div>
                  <Segmented
                    size="sm"
                    value={opts.colorProfile}
                    onChange={(v) => set({ colorProfile: v })}
                    options={[
                      { value: 'srgb', label: 'sRGB (labs)' },
                      { value: 'cmyk', label: 'CMYK (press)', title: ghostscript ? 'Convert with Ghostscript' : 'Needs Ghostscript' },
                    ]}
                  />
                  {opts.colorProfile === 'cmyk' && (
                    <div className="mt-1.5">
                      {!ghostscript ? (
                        <p className="text-[11px] text-bad">Ghostscript isn’t available on the server, so CMYK conversion can’t run. The Docker image includes it.</p>
                      ) : (
                        <>
                          <select className="input" value={opts.iccProfile ?? ''} onChange={(e) => set({ iccProfile: e.target.value || null })}>
                            <option value="">Ghostscript default CMYK</option>
                            {cmykProfiles.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-ink-3">Only use CMYK if your printer asks for it. Put their .icc profile in /data/config/icc to target it exactly.</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              {opts.format === 'jpeg' && <Slider label="JPEG quality" min={98} max={100} step={1} value={opts.jpegQuality} format={(v) => `${v}%`} onChange={(v) => set({ jpegQuality: v })} />}
            </Section>
          ) : (
            <Section title="Share pack">
              <Segmented
                size="sm"
                value={opts.shareFormat}
                onChange={(v) => set({ shareFormat: v })}
                options={[
                  { value: 'jpeg', label: 'JPEG' },
                  { value: 'png', label: 'PNG' },
                ]}
              />
              <p className="mt-1 text-[11px] text-ink-3">Trimmed (no bleed), 1080 px on the short edge, plus a side-by-side image of all sides.</p>
            </Section>
          )}
          <Section title="You’ll get">
            <div className="space-y-0.5 text-[12px]">
              {predicted.map((p, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="text-ink-2">{p.label}</span>
                  <span className="tabular-nums text-ink">
                    {p.w.toLocaleString()} × {p.h.toLocaleString()} px @ {Math.round(p.dpi)} DPI
                  </span>
                </div>
              ))}
            </div>
          </Section>
          <div className="sticky bottom-0 border-t border-line bg-paper p-4">
            {report && report.status !== 'green' && (
              <div className={clsx('mb-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs', report.status === 'red' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')}>
                <TrafficLight status={report.status} small />
                {report.status === 'red'
                  ? confirmRed
                    ? 'The Print Guardian found problems. Click again to export anyway.'
                    : `The Print Guardian found ${report.issues.filter((i) => i.severity === 'error').length} problem(s).`
                  : 'Printable — the Print Guardian has a few notes.'}
              </div>
            )}
            <button className="btn btn-primary btn-lg w-full" disabled={!opts.surfaces.length || starting || (opts.format === 'pdf' && opts.colorProfile === 'cmyk' && !ghostscript)} onClick={start}>
              {starting ? <Spinner className="text-white" /> : <Download size={16} />} {confirmRed ? 'Export anyway' : 'Export'}
            </button>
            {health && !health.renderer.available && <p className="mt-2 text-[11px] text-bad">Print renderer unavailable: {health.renderer.detail}</p>}
          </div>
        </div>
        {/* ---------- Verification ---------- */}
        <div className="flex max-h-[78vh] min-w-0 flex-col">
          {history.length > 1 && (
            <div className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2">
              {history.slice(0, 12).map((h) => (
                <button key={h.id} onClick={() => setActiveId(h.id)} className={clsx('chip shrink-0', h.id === activeId && 'chip-on')}>
                  {h.options.format.toUpperCase()} · {new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {h.status === 'error' && <AlertTriangle size={11} />}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {active ? (
              <ExportVerification
                rec={active}
                onDelete={async () => {
                  await api.del(`/api/exports/${enc(active.id)}`);
                  setHistory((h) => h.filter((x) => x.id !== active.id));
                  setActiveId(null);
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center text-ink-3">
                <Printer size={36} />
                <div className="font-medium text-ink-2">Pick your options and export</div>
                <p className="max-w-sm text-[13px]">Every export is rendered from full-resolution originals in a headless browser at true 300 DPI, then read back and verified here before you send it to the printer.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Verification ---------------- */

export function ExportVerification({ rec, onDelete }: { rec: ExportRecord; onDelete?: () => void }) {
  const viewable = rec.files.filter((f) => f.kind !== 'zip');
  const zip = rec.files.find((f) => f.kind === 'zip');
  const [viewer, setViewer] = useState<{ src: string; title: string; widthPx?: number; heightPx?: number; dpi?: number } | null>(null);

  if (rec.status === 'queued' || rec.status === 'rendering')
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10">
        <Spinner size={28} />
        <div className="font-medium">{rec.message ?? 'Rendering…'}</div>
        <ProgressBar value={rec.progress} className="w-72" />
        <p className="max-w-sm text-center text-xs text-ink-3">Fetching full-resolution originals and rendering at {rec.options.format === 'share' ? '1080 px' : `${rec.options.dpi} DPI`}.</p>
      </div>
    );
  if (rec.status === 'error')
    return (
      <div className="p-6">
        <div className="rounded-xl bg-bad-soft p-4 text-bad">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={16} /> Export failed
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-xs">{rec.error}</pre>
        </div>
      </div>
    );

  const photos = rec.report?.photos ?? [];
  const minDpi = photos.length ? Math.min(...photos.map((p) => p.effectiveDpi)) : null;
  const missingFonts = rec.report?.fonts.missing ?? [];
  const failed = rec.report?.failedImages ?? [];
  const allGood = !missingFonts.length && !failed.length && (minDpi === null || minDpi >= DPI_GOOD);

  return (
    <div className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className={clsx('mt-0.5', allGood ? 'text-ok' : 'text-warn')}>{allGood ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl">{allGood ? 'Verified — ready for the printer' : 'Exported — please review'}</div>
          <div className="text-xs text-ink-3">
            {new Date(rec.createdAt).toLocaleString()} · rendered in {((rec.durationMs ?? 0) / 1000).toFixed(1)} s · saved to <code>{rec.folder}</code>
          </div>
        </div>
        {zip && (
          <a className="btn btn-primary" href={fileUrl(rec, zip, true)}>
            <FileArchive size={15} /> Download all ({formatBytes(zip.bytes)})
          </a>
        )}
        {onDelete && (
          <button className="icon-btn" title="Delete this export" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {(rec.warnings.length > 0 || missingFonts.length > 0 || failed.length > 0) && (
        <div className="space-y-1 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          {missingFonts.length > 0 && <div>Missing fonts (a fallback was used): {missingFonts.join(', ')}</div>}
          {failed.length > 0 && <div>Images that failed to load: {failed.join(', ')}</div>}
          {rec.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {viewable.map((f) => {
          const thumb = f.kind === 'pdf' ? (rec.proofs?.[0] ? proofUrl(rec, rec.proofs[0]) : null) : fileUrl(rec, f);
          const ok = !f.verified || ((f.verified.widthPx === undefined || f.verified.widthPx === f.widthPx) && (f.verified.heightPx === undefined || f.verified.heightPx === f.heightPx));
          return (
            <div key={f.name} className="flex gap-3 rounded-xl border border-line bg-white p-3">
              <button
                className="checker relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                onClick={() => thumb && setViewer({ src: thumb, title: f.name, widthPx: f.widthPx, heightPx: f.heightPx, dpi: f.dpi })}
                title="Open at 100%"
              >
                {thumb ? <img src={thumb} alt="" className="max-h-full max-w-full object-contain shadow" loading="lazy" /> : <FileText size={28} className="text-ink-3" />}
                {thumb && (
                  <span className="absolute bottom-1 right-1 rounded bg-black/55 p-0.5 text-white">
                    <ZoomIn size={12} />
                  </span>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" title={f.name}>
                  {f.name}
                </div>
                <div className="mt-1 font-mono text-[15px] font-semibold tabular-nums text-ink">
                  {f.widthPx && f.heightPx ? `${f.widthPx.toLocaleString()} × ${f.heightPx.toLocaleString()} px` : f.pages ? `${f.pages} page${f.pages > 1 ? 's' : ''}` : ''}
                  {f.dpi ? ` @ ${Math.round(f.dpi)} DPI` : ''}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-2">
                  {f.widthIn && f.heightIn && (
                    <span>
                      {f.widthIn.toFixed(3).replace(/\.?0+$/, '')} × {f.heightIn.toFixed(3).replace(/\.?0+$/, '')} in
                    </span>
                  )}
                  <span>{formatBytes(f.bytes)}</span>
                  {f.colorSpace && <span>{f.colorSpace}</span>}
                  {f.surface && <span>{f.surface in SURFACE_INFO ? SURFACE_INFO[f.surface as keyof typeof SURFACE_INFO].label : f.surface.replace('spread-', 'Spread · ')}</span>}
                </div>
                {f.verified && (
                  <div className={clsx('mt-1 flex items-center gap-1 text-[11px]', ok ? 'text-ok' : 'text-bad')}>
                    {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                    Read back from file:
                    {f.verified.widthPx !== undefined && ` ${f.verified.widthPx}×${f.verified.heightPx}px`}
                    {f.verified.density !== undefined && ` · ${f.verified.density} DPI tag`}
                    {f.verified.pageSizesIn && ` · pages ${f.verified.pageSizesIn.map(([w, h]) => `${w}×${h}"`).join(', ')}`}
                    {f.verified.trimBox !== undefined && ` · TrimBox ${f.verified.trimBox ? '✓' : '✗'}`}
                    {f.verified.bleedBox !== undefined && ` · BleedBox ${f.verified.bleedBox ? '✓' : '✗'}`}
                  </div>
                )}
                {f.verified?.fonts && f.verified.fonts.length > 0 && (
                  <div className="mt-1 text-[11px] text-ink-3">
                    <span className="font-medium text-ink-2">Fonts in this PDF:</span>{' '}
                    {f.verified.fonts.map((ft, i) => (
                      <span key={`${ft.name}-${ft.subtype}`} className={clsx(!ft.embedded && 'font-medium text-bad')} title={`${ft.subtype}${ft.embedded ? ', embedded' : ', NOT embedded'}`}>
                        {i > 0 && ', '}
                        {ft.name}
                        {ft.embedded ? ' ✓' : ' (not embedded)'}
                      </span>
                    ))}
                  </div>
                )}
                {f.kind === 'pdf' && rec.proofs && rec.proofs.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {rec.proofs.map((p, i) => (
                      <button key={p} className="chip" onClick={() => setViewer({ src: proofUrl(rec, p), title: `${f.name} — page ${i + 1}`, dpi: rec.options.dpi })}>
                        <Maximize2 size={11} /> Page {i + 1}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <a className="btn btn-sm self-start" href={fileUrl(rec, f, true)}>
                <Download size={13} /> Download
              </a>
            </div>
          );
        })}
      </div>

      {photos.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-3">
          <div className="panel-title mb-2">Photo resolution in this file</div>
          <table className="w-full text-xs">
            <thead className="text-left text-ink-3">
              <tr>
                <th className="pb-1 font-medium">Photo</th>
                <th className="pb-1 font-medium">Page</th>
                <th className="pb-1 text-right font-medium">Pixels used</th>
                <th className="pb-1 text-right font-medium">Effective DPI</th>
              </tr>
            </thead>
            <tbody>
              {photos.map((p, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="max-w-[260px] py-1" title={p.name}>
                    <div className="truncate">{p.name}</div>
                    <div className="truncate text-[10.5px] text-ink-3">
                      {p.via}
                      {p.sourceWidth > 0 && ` · ${p.sourceWidth.toLocaleString()} px wide`}
                    </div>
                  </td>
                  <td className="py-1 text-ink-2">{p.page}</td>
                  <td className="py-1 text-right tabular-nums">
                    {p.deliveredPx.toLocaleString()} px{p.deliveredPx < p.requestedPx ? ` (of ${p.requestedPx.toLocaleString()} wanted)` : ''}
                  </td>
                  <td className={clsx('py-1 text-right font-semibold tabular-nums', p.effectiveDpi >= DPI_GOOD ? 'text-ok' : p.effectiveDpi >= DPI_MIN ? 'text-warn' : 'text-bad')}>
                    {Math.round(p.effectiveDpi)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-3">
            Photos are resampled from the original to exactly the printed pixel size (never upscaled). {DPI_GOOD}+ DPI is sharp; below {DPI_MIN} looks soft.
          </p>
        </div>
      )}

      {viewer && <PixelViewer {...viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

/** Zoomable inspector. "100%" maps one file pixel to one physical screen pixel. */
function PixelViewer({ src, title, widthPx, heightPx, dpi, onClose }: { src: string; title: string; widthPx?: number; heightPx?: number; dpi?: number; onClose: () => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<'fit' | '100' | '200' | 'print'>('fit');
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const dpr = window.devicePixelRatio || 1;
  const w = natural?.w ?? widthPx ?? 0;
  const h = natural?.h ?? heightPx ?? 0;
  const [vp, setVp] = useState({ w: 1000, h: 700 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cssW =
    mode === 'fit' ? Math.min(vp.w - 40, ((vp.h - 40) * w) / (h || 1)) : mode === '100' ? w / dpr : mode === '200' ? (2 * w) / dpr : dpi ? (w / dpi) * 96 : w / dpr; // "print" = physical size (96 CSS px per inch)

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#161412]/95 fade-in">
      <div className="flex items-center gap-3 px-4 py-2.5 text-white">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{title}</div>
          <div className="text-[11px] text-white/60">
            {w && h ? `${w.toLocaleString()} × ${h.toLocaleString()} px` : ''}
            {dpi ? ` @ ${Math.round(dpi)} DPI = ${(w / dpi).toFixed(3)} × ${(h / dpi).toFixed(3)} in` : ''}
          </div>
        </div>
        <div className="seg !bg-white/10">
          {(
            [
              ['fit', 'Fit'],
              ['print', 'Actual size'],
              ['100', '100% pixels'],
              ['200', '200%'],
            ] as const
          ).map(([m, l]) => (
            <button key={m} data-on={mode === m} onClick={() => setMode(m)} className="!text-white data-[on=true]:!bg-white/25">
              {l}
            </button>
          ))}
        </div>
        <button className="icon-btn !text-white hover:!bg-white/15" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div
        ref={box}
        className={clsx('min-h-0 flex-1 overflow-auto', mode !== 'fit' && 'cursor-grab active:cursor-grabbing')}
        onPointerDown={(e) => {
          const el = box.current!;
          drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const el = box.current!;
          el.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
          el.scrollTop = drag.current.st - (e.clientY - drag.current.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-5" style={{ width: mode === 'fit' ? undefined : cssW + 40 }}>
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ width: cssW || undefined, maxWidth: 'none', imageRendering: mode === '200' ? 'pixelated' : 'auto' }}
            className="shadow-2xl"
          />
        </div>
      </div>
      <div className="px-4 py-2 text-center text-[11px] text-white/50">
        “100% pixels” shows one file pixel per screen pixel — what the printer’s machine sees. “Actual size” approximates the printed size on a typical display.
      </div>
    </div>
  );
}
