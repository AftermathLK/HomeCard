import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { BookOpen, RotateCcw } from 'lucide-react';
import { mixHex, type CardProject, type SurfaceId } from '@homecard/shared';
import { MiniCard } from '@/components/MiniCard';
import { Segmented } from '@/components/ui';
import { useProject } from '@/store/editor';

type Scene = 'desk' | 'envelope' | 'studio';

/**
 * Photoreal-ish preview of the finished card (trimmed, no guides), rendered with the same
 * renderer as the export. Flat cards flip front/back; folded cards can be opened.
 */
export function MockupView() {
  const project = useProject();
  const [scene, setScene] = useState<Scene>('desk');
  const [flipped, setFlipped] = useState(false);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 900, h: 700 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!project) return null;
  const f = project.format;
  const folded = f.fold === 'folded';
  const has = (id: SurfaceId) => project.surfaces.some((s) => s.id === id);
  const backId: SurfaceId | null = has('back') ? 'back' : null;

  // Card size on screen
  const spread = folded && open;
  const aspectW = spread ? (f.widthIn <= f.heightIn ? f.widthIn * 2 : f.widthIn) : f.widthIn;
  const aspectH = spread ? (f.widthIn <= f.heightIn ? f.heightIn : f.heightIn * 2) : f.heightIn;
  const scale = Math.min((vp.w * (scene === 'envelope' ? 0.5 : 0.62)) / aspectW, (vp.h * 0.72) / aspectH);
  const cw = f.widthIn * scale, ch = f.heightIn * scale;

  return (
    <div className="relative flex h-full flex-col">
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-white/90 p-1 shadow-card backdrop-blur">
        <Segmented
          size="sm"
          value={scene}
          onChange={setScene}
          options={[
            { value: 'desk', label: 'Desk' },
            { value: 'envelope', label: 'With envelope' },
            { value: 'studio', label: 'Studio' },
          ]}
        />
        {folded ? (
          <button className={clsx('btn btn-sm', open && 'chip-on')} onClick={() => { setOpen((v) => !v); setFlipped(false); }}>
            <BookOpen size={14} /> {open ? 'Close card' : 'Open card'}
          </button>
        ) : null}
        {(backId || folded) && !open && (
          <button className="btn btn-sm" onClick={() => setFlipped((v) => !v)}>
            <RotateCcw size={14} /> {flipped ? 'Show front' : 'Flip over'}
          </button>
        )}
      </div>
      <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden" style={sceneStyle(scene, project)}>
        <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: 2200 }}>
          {scene === 'envelope' && !open && <Envelope project={project} w={cw * 1.08} h={ch * 1.04} />}
          {spread ? (
            <OpenCard project={project} cw={cw} ch={ch} />
          ) : (
            <div
              className="relative transition-transform duration-700"
              style={{
                width: cw,
                height: ch,
                transformStyle: 'preserve-3d',
                transform: `${scene === 'envelope' ? `translateX(${cw * 0.32}px) rotate(4deg)` : scene === 'desk' ? 'rotate(-2.5deg)' : ''} rotateY(${flipped ? 180 : 0}deg)`,
              }}
            >
              <Face>
                <PaperCard project={project} surfaceId="front" w={cw} h={ch} />
              </Face>
              <Face back>
                {backId || folded ? <PaperCard project={project} surfaceId={backId ?? 'back'} w={cw} h={ch} /> : <BlankBack w={cw} h={ch} />}
              </Face>
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-[11px] text-white/80 drop-shadow">
          Preview shows the trimmed card. Exports include bleed and are rendered at full print resolution.
        </div>
      </div>
    </div>
  );
}

function Face({ back, children }: { back?: boolean; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: back ? 'rotateY(180deg)' : undefined }}>
      {children}
    </div>
  );
}

function PaperCard({ project, surfaceId, w, h }: { project: CardProject; surfaceId: SurfaceId; w: number; h: number }) {
  const surface = project.surfaces.find((s) => s.id === surfaceId);
  return (
    <div className="relative" style={{ width: w, height: h, boxShadow: '0 1px 1px rgba(0,0,0,.12), 0 18px 40px -12px rgba(0,0,0,.55), 0 4px 10px rgba(0,0,0,.18)' }}>
      {surface ? <MiniCard project={project} surface={surface} width={w} height={h} shadow={false} showEmptySlots={false} /> : <BlankBack w={w} h={h} />}
      {/* paper sheen */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(125deg, rgba(255,255,255,.16) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0) 65%, rgba(0,0,0,.07) 100%)' }} />
    </div>
  );
}

function BlankBack({ w, h }: { w: number; h: number }) {
  return <div style={{ width: w, height: h, background: '#fbfaf7' }} />;
}

function OpenCard({ project, cw, ch }: { project: CardProject; cw: number; ch: number }) {
  const side = project.format.widthIn <= project.format.heightIn;
  const left = project.surfaces.find((s) => s.id === 'inside-left');
  const right = project.surfaces.find((s) => s.id === 'inside-right');
  return (
    <div className={clsx('relative flex', side ? 'flex-row' : 'flex-col')} style={{ transformStyle: 'preserve-3d', transform: 'rotateX(8deg)', filter: 'drop-shadow(0 22px 30px rgba(0,0,0,.45))' }}>
      <div style={{ transformOrigin: side ? 'right center' : 'center bottom', transform: side ? 'rotateY(14deg)' : 'rotateX(-14deg)' }} className="relative">
        {left && <MiniCard project={project} surface={left} width={cw} height={ch} shadow={false} showEmptySlots={false} />}
        <div className="pointer-events-none absolute inset-0" style={{ background: side ? 'linear-gradient(to left, rgba(0,0,0,.18), rgba(0,0,0,0) 18%)' : 'linear-gradient(to top, rgba(0,0,0,.18), rgba(0,0,0,0) 18%)' }} />
      </div>
      <div className="relative">
        {right && <MiniCard project={project} surface={right} width={cw} height={ch} shadow={false} showEmptySlots={false} />}
        <div className="pointer-events-none absolute inset-0" style={{ background: side ? 'linear-gradient(to right, rgba(0,0,0,.14), rgba(0,0,0,0) 12%)' : 'linear-gradient(to bottom, rgba(0,0,0,.14), rgba(0,0,0,0) 12%)' }} />
      </div>
    </div>
  );
}

function Envelope({ project, w, h }: { project: CardProject; w: number; h: number }) {
  const base = mixHex(project.theme.colors.accent2 || '#c9a54a', '#f5efe2', 0.55);
  const dark = mixHex(base, '#000000', 0.12);
  return (
    <div className="absolute" style={{ width: w, height: h, transform: `translateX(${-w * 0.32}px) rotate(-5deg)`, filter: 'drop-shadow(0 16px 26px rgba(0,0,0,.4))' }}>
      <div className="absolute inset-0 rounded-[3px]" style={{ background: base }} />
      {/* open flap */}
      <div className="absolute left-0 right-0" style={{ top: -h * 0.42, height: h * 0.44, background: dark, clipPath: 'polygon(0 100%, 50% 4%, 100% 100%)' }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${mixHex(base, '#ffffff', 0.2)} 0%, ${base} 50%, ${dark} 100%)`, clipPath: 'polygon(0 0, 50% 52%, 100% 0, 100% 100%, 0 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top right, rgba(0,0,0,.08), transparent 50%)', clipPath: 'polygon(0 100%, 50% 48%, 100% 100%)' }} />
    </div>
  );
}

function sceneStyle(scene: Scene, project: CardProject): React.CSSProperties {
  if (scene === 'studio')
    return { background: `radial-gradient(ellipse at 50% 40%, ${mixHex(project.theme.colors.background, '#ffffff', 0.35)} 0%, ${mixHex(project.theme.colors.background, '#6b6258', 0.55)} 100%)` };
  if (scene === 'envelope')
    return { background: 'radial-gradient(ellipse at 40% 30%, #efe9df 0%, #d9cfc0 60%, #bfb3a2 100%)' };
  // warm oak desk: layered grain gradients + vignette
  return {
    background: [
      'radial-gradient(ellipse at 50% 45%, rgba(255,240,215,.25) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,.35) 100%)',
      'repeating-linear-gradient(92deg, rgba(255,255,255,.035) 0px, rgba(255,255,255,.035) 2px, rgba(0,0,0,.04) 3px, rgba(0,0,0,0) 9px)',
      'repeating-linear-gradient(88deg, rgba(0,0,0,.05) 0px, rgba(0,0,0,0) 40px, rgba(255,255,255,.03) 80px)',
      'linear-gradient(180deg, #9a6a43 0%, #8a5c37 50%, #7a4f2e 100%)',
    ].join(','),
  };
}
