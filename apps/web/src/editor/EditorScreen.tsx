import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  Download,
  Eye,
  Grid3x3,
  History,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Loader2,
  Minus,
  Palette,
  PenLine,
  Plus,
  Redo2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Type,
  Undo2,
  Wallpaper,
  Wand2,
} from 'lucide-react';
import { SURFACE_INFO, type CardProject, type GuardianReport } from '@homecard/shared';
import { MiniCard } from '@/components/MiniCard';
import { UserMenu } from '@/components/UserMenu';
import { Segmented, Spinner } from '@/components/ui';
import { api, enc } from '@/lib/api';
import { CardSetupPanel } from '@/setup/CardSetup';
import { useEditor, useProject } from '@/store/editor';
import { useUi, type StudioTab } from '@/store/ui';
import { Canvas } from './Canvas';
import { GuardianHost, useGuardian } from './GuardianHost';
import { GuardianPanel, TrafficLight } from './GuardianPanel';
import { Inspector } from './Inspector';
import { MockupView } from './MockupView';
import { BackgroundsPanel } from './panels/BackgroundsPanel';
import { DecorPanel } from './panels/DecorPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PhotosPanel } from './panels/PhotosPanel';
import { PolishPanel } from './panels/PolishPanel';
import { FinishPanel, FontsPanel, PalettePanel, StylePanel } from './panels/StylePanel';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { TextPanel } from './panels/TextPanel';

/* ====================================================================== */

export function EditorScreen({ projectId }: { projectId: string }) {
  const project = useProject();
  const loadError = useEditor((s) => s.loadError);
  const mode = useUi((s) => s.mode);
  const view = useUi((s) => s.view);
  const selection = useEditor((s) => s.selection);
  const report = useGuardian(project);

  useEffect(() => {
    if (useEditor.getState().project?.id !== projectId) void useEditor.getState().open(projectId);
    return () => {
      void useEditor.getState().saveNow();
    };
  }, [projectId]);

  if (loadError)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <CloudOff size={36} className="text-ink-3" />
        <div className="font-medium">Couldn’t open this card</div>
        <div className="text-[13px] text-ink-3">{loadError}</div>
        <button className="btn" onClick={() => useUi.getState().go({ name: 'home' })}>
          Back to my cards
        </button>
      </div>
    );
  if (!project || project.id !== projectId)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );

  const showInspector = selection.length > 0 && view === 'editor';
  return (
    <div className="flex h-full flex-col">
      <TopBar project={project} report={report} />
      <div className="flex min-h-0 flex-1">
        {mode === 'guided' ? <GuidedSidebar report={report} /> : <StudioSidebar report={report} />}
        <main className="relative flex min-w-0 flex-1 flex-col bg-paper-3/60">
          <div className="relative min-h-0 flex-1">{view === 'mockup' ? <MockupView /> : <Canvas />}</div>
          <PagesBar project={project} />
        </main>
        {(showInspector || (mode === 'studio' && view === 'editor')) && (
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line bg-paper">{showInspector ? <Inspector /> : <GuardianPanel report={report} />}</aside>
        )}
      </div>
      <GuardianHost project={project} />
    </div>
  );
}

/* ---------------- Top bar ---------------- */

function TopBar({ project, report }: { project: CardProject; report: GuardianReport | null }) {
  const ui = useUi();
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveState = useEditor((s) => s.saveState);
  const saveError = useEditor((s) => s.saveError);
  const ed = useEditor.getState();
  const errors = report?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warns = report?.issues.filter((i) => i.severity === 'warn').length ?? 0;

  const duplicate = async () => {
    await ed.saveNow();
    const p = await api.post<CardProject>(`/api/projects/${enc(project.id)}/duplicate`, {});
    ui.toast(`Created “${p.name}”.`, 'ok');
    ui.go({ name: 'editor', projectId: p.id });
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
      <button
        className="btn btn-ghost"
        onClick={async () => {
          await ed.saveNow();
          ui.go({ name: 'home' });
        }}
        title="All cards"
      >
        <ChevronLeft size={16} />
        <span className="hidden font-display text-[17px] text-brand xl:inline">HomeCard</span>
      </button>
      <div className="mx-1 h-6 w-px bg-line" />
      <input
        className="w-36 min-w-0 truncate lg:w-44 xl:w-56 rounded-md bg-transparent px-1.5 py-1 text-[14px] font-medium outline-none hover:bg-paper-2 focus:bg-white focus:ring-2 focus:ring-brand/20"
        value={project.name}
        onChange={(e) => ed.edit((d) => void (d.name = e.target.value), 'name')}
        title="Rename card"
      />
      <SaveBadge state={saveState} error={saveError} />
      <div className="ml-2 flex items-center">
        <button className="icon-btn" disabled={!canUndo} onClick={() => ed.undo()} title="Undo (Ctrl+Z)">
          <Undo2 size={17} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => ed.redo()} title="Redo (Ctrl+Shift+Z)">
          <Redo2 size={17} />
        </button>
        <VersionsMenu project={project} />
        <button className="icon-btn" onClick={duplicate} title="Duplicate card (make a variation)">
          <Copy size={16} />
        </button>
      </div>
      <div className="flex-1" />
      <Segmented
        value={ui.mode}
        onChange={(m) => ui.set({ mode: m })}
        options={[
          { value: 'guided', label: <span className="flex items-center gap-1"><Wand2 size={13} /> <span className="sr-only xl:not-sr-only">Guided</span></span>, title: 'Four easy steps' },
          { value: 'studio', label: <span className="flex items-center gap-1"><SquarePen size={13} /> <span className="sr-only xl:not-sr-only">Studio</span></span>, title: 'Freeform design tools' },
        ]}
      />
      <Segmented
        value={ui.view}
        onChange={(v) => ui.set({ view: v, cropId: null, editingTextId: null })}
        options={[
          { value: 'editor', label: <span className="flex items-center gap-1"><Grid3x3 size={13} /> <span className="sr-only xl:not-sr-only">Editor</span></span>, title: 'Edit with bleed, trim and safe-zone guides' },
          { value: 'mockup', label: <span className="flex items-center gap-1"><Eye size={13} /> <span className="sr-only xl:not-sr-only">Preview</span></span>, title: 'See the finished card' },
        ]}
      />
      <button
        className="btn btn-ghost"
        title="Print Guardian"
        onClick={() => (ui.mode === 'guided' ? ui.set({ step: 4 }) : ui.set({ tab: 'check' }))}
      >
        {report && <TrafficLight status={report.status} small />}
        <span className="whitespace-nowrap text-[13px]">{errors ? `${errors} to fix` : warns ? `${warns} note${warns > 1 ? 's' : ''}` : 'Print ready'}</span>
      </button>
      <button className="btn btn-primary shrink-0" onClick={() => ui.set({ exportOpen: true })}>
        <Download size={15} /> Export
      </button>
      <UserMenu compact />
    </header>
  );
}

function SaveBadge({ state, error }: { state: string; error: string | null }) {
  return (
    <span className={clsx('flex items-center gap-1 text-[11px]', state === 'error' ? 'text-bad' : 'text-ink-3')} title={error ?? 'Changes save automatically'}>
      {state === 'saving' || state === 'dirty' ? <Loader2 size={12} className="spin" /> : state === 'error' ? <CloudOff size={12} /> : <Check size={12} />}
      {state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved — retrying' : 'Saving…'}
    </span>
  );
}

interface VersionInfo {
  id: string;
  createdAt: string;
  label: string;
  auto: boolean;
  bytes: number;
}

function VersionsMenu({ project }: { project: CardProject }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    api.get<VersionInfo[]>(`/api/projects/${enc(project.id)}/versions`).then(setList, () => setList([]));
    const h = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', h);
    return () => window.removeEventListener('pointerdown', h);
  }, [open, project.id]);
  const ed = useEditor.getState();
  return (
    <div className="relative" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((v) => !v)} title="Version history">
        <History size={16} />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-80 rounded-xl border border-line bg-white p-2 shadow-pop fade-in">
          <div className="flex items-center justify-between px-1.5 pb-1.5">
            <span className="panel-title">Version history</span>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await ed.saveNow();
                const label = prompt('Name this snapshot', 'Before changes') ?? '';
                if (!label) return;
                await api.post(`/api/projects/${enc(project.id)}/versions`, { label });
                setList(await api.get<VersionInfo[]>(`/api/projects/${enc(project.id)}/versions`));
              }}
            >
              <Plus size={12} /> Snapshot
            </button>
          </div>
          <div className="max-h-80 overflow-auto">
            {list === null ? (
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            ) : !list.length ? (
              <p className="px-1.5 py-3 text-xs text-ink-3">No versions yet. HomeCard snapshots your card automatically every few minutes while you work.</p>
            ) : (
              list.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-paper-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{v.label}</div>
                    <div className="text-[11px] text-ink-3">
                      {new Date(v.createdAt).toLocaleString()} {v.auto ? '· auto' : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      await ed.saveNow();
                      const restored = await api.post<CardProject>(`/api/projects/${enc(project.id)}/versions/${enc(v.id)}/restore`, {});
                      // Make the restore itself undoable.
                      ed.commit(restored);
                      useUi.getState().toast(`Restored “${v.label}”. Undo brings back what you had.`, 'ok');
                      setOpen(false);
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Guided mode ---------------- */

const STEPS: Array<{ n: 1 | 2 | 3 | 4; title: string; hint: string }> = [
  { n: 1, title: 'Occasion', hint: 'Holiday, size & paper' },
  { n: 2, title: 'Photos', hint: 'Pick, place & polish' },
  { n: 3, title: 'Words & style', hint: 'Greeting, colours, fonts' },
  { n: 4, title: 'Check & print', hint: 'Print Guardian & export' },
];

const STEP_TABS: Record<number, Array<{ id: string; label: string }>> = {
  2: [
    { id: 'photos', label: 'Photos' },
    { id: 'layout', label: 'Layout' },
    { id: 'polish', label: 'Polish' },
  ],
  3: [
    { id: 'words', label: 'Words' },
    { id: 'colors', label: 'Colours' },
    { id: 'fonts', label: 'Fonts' },
    { id: 'backgrounds', label: 'Backgrounds' },
    { id: 'finish', label: 'Finish' },
  ],
};

function GuidedSidebar({ report }: { report: GuardianReport | null }) {
  const step = useUi((s) => s.step);
  const subTab = useUi((s) => s.subTab);
  const set = useUi((s) => s.set);
  const tabs = STEP_TABS[step];
  const tab = tabs?.some((t) => t.id === subTab) ? subTab : tabs?.[0].id;

  let body: ReactNode = null;
  if (step === 1) body = <CardSetupPanel />;
  else if (step === 2) body = tab === 'layout' ? <TemplatesPanel /> : tab === 'polish' ? <PolishPanel /> : <PhotosPanel />;
  else if (step === 3)
    body = tab === 'colors' ? <PalettePanel /> : tab === 'fonts' ? <FontsPanel /> : tab === 'backgrounds' ? <BackgroundsPanel /> : tab === 'finish' ? <FinishPanel /> : <TextPanel showAllSurfaces />;
  else body = <GuardianPanel report={report} />;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-r border-line bg-paper">
      <nav className="grid grid-cols-4 border-b border-line">
        {STEPS.map((s) => (
          <button
            key={s.n}
            onClick={() => set({ step: s.n, subTab: '' })}
            className={clsx('relative flex flex-col items-center gap-0.5 px-1 py-2.5 text-center transition', step === s.n ? 'text-brand' : 'text-ink-3 hover:text-ink')}
            title={s.hint}
          >
            <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold', step === s.n ? 'bg-brand text-white' : step > s.n ? 'bg-brand-soft text-brand' : 'bg-paper-3')}>
              {step > s.n ? <Check size={13} strokeWidth={3} /> : s.n}
            </span>
            <span className="text-[11px] font-medium leading-tight">{s.title}</span>
            {step === s.n && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded bg-brand" />}
          </button>
        ))}
      </nav>
      {tabs && (
        <div className="border-b border-line px-4 py-2">
          <Segmented value={tab!} onChange={(v) => set({ subTab: v })} options={tabs.map((t) => ({ value: t.id, label: t.label }))} />
        </div>
      )}
      <div key={`${step}:${tab ?? ""}`} className="min-h-0 flex-1 overflow-y-auto">
        {body}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-white/60 px-4 py-3">
        <button className="btn" disabled={step === 1} onClick={() => set({ step: (step - 1) as 1 | 2 | 3, subTab: '' })}>
          <ChevronLeft size={15} /> Back
        </button>
        <div className="flex-1" />
        {step < 4 ? (
          <button className="btn btn-primary" onClick={() => set({ step: (step + 1) as 2 | 3 | 4, subTab: '' })}>
            Next: {STEPS[step].title} <ChevronRight size={15} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => set({ exportOpen: true })}>
            <Download size={15} /> Export for print
          </button>
        )}
      </div>
    </aside>
  );
}

/* ---------------- Studio mode ---------------- */

const STUDIO_TABS: Array<{ id: StudioTab; label: string; icon: ReactNode }> = [
  { id: 'card', label: 'Card', icon: <PenLine size={19} /> },
  { id: 'templates', label: 'Layout', icon: <LayoutTemplate size={19} /> },
  { id: 'photos', label: 'Photos', icon: <ImageIcon size={19} /> },
  { id: 'text', label: 'Text', icon: <Type size={19} /> },
  { id: 'style', label: 'Style', icon: <Palette size={19} /> },
  { id: 'backgrounds', label: 'Backdrop', icon: <Wallpaper size={19} /> },
  { id: 'polish', label: 'Polish', icon: <Wand2 size={19} /> },
  { id: 'decor', label: 'Decor', icon: <Sparkles size={19} /> },
  { id: 'layers', label: 'Layers', icon: <Layers size={19} /> },
  { id: 'check', label: 'Check', icon: <ShieldCheck size={19} /> },
];

function StudioSidebar({ report }: { report: GuardianReport | null }) {
  const tab = useUi((s) => s.tab);
  const set = useUi((s) => s.set);
  return (
    <aside className="flex shrink-0 border-r border-line bg-paper">
      <nav className="flex w-[68px] flex-col items-center gap-0.5 border-r border-line py-2">
        {STUDIO_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => set({ tab: t.id })}
            className={clsx('flex w-[58px] flex-col items-center gap-0.5 rounded-lg py-2 text-[10.5px] font-medium transition', tab === t.id ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-paper-2 hover:text-ink')}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>
      <div key={tab} className="w-[330px] overflow-y-auto">
        {tab === 'card' && <CardSetupPanel />}
        {tab === 'templates' && <TemplatesPanel />}
        {tab === 'photos' && <PhotosPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'style' && <StylePanel />}
        {tab === 'backgrounds' && <BackgroundsPanel />}
        {tab === 'polish' && <PolishPanel />}
        {tab === 'decor' && <DecorPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'check' && <GuardianPanel report={report} />}
      </div>
    </aside>
  );
}

/* ---------------- Pages bar & zoom ---------------- */

function PagesBar({ project }: { project: CardProject }) {
  const surfaceId = useEditor((s) => s.surfaceId);
  const view = useUi((s) => s.view);
  const zoom = useUi((s) => s.zoom);
  const showGuides = useUi((s) => s.showGuides);
  const set = useUi((s) => s.set);
  const fit = (window as any).__hcFitZoom ?? 1;
  const z = zoom === 'fit' ? fit : zoom;
  return (
    <div className="flex h-[92px] shrink-0 items-center gap-3 border-t border-line bg-paper px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto py-2">
        {project.surfaces.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              useEditor.getState().setSurface(s.id);
              if (view === 'mockup') set({ view: 'editor' });
            }}
            className={clsx('flex shrink-0 flex-col items-center gap-1 rounded-lg p-1 transition', surfaceId === s.id && view === 'editor' ? 'bg-brand-soft ring-2 ring-brand' : 'hover:bg-paper-2')}
          >
            <MiniCard project={project} surface={s} width={64} height={52} />
            <span className="text-[10.5px] font-medium text-ink-2">{SURFACE_INFO[s.id].label}</span>
          </button>
        ))}
      </div>
      {view === 'editor' && (
        <div className="flex shrink-0 items-center gap-1">
          <button className={clsx('btn btn-sm', showGuides && 'chip-on')} onClick={() => set({ showGuides: !showGuides })} title="Bleed, trim & safe-zone guides">
            Guides
          </button>
          <div className="seg">
            <button onClick={() => set({ zoom: Math.max(0.15, z / 1.2) })} title="Zoom out (Ctrl −)">
              <Minus size={13} />
            </button>
            <button data-on={zoom === 'fit'} onClick={() => set({ zoom: 'fit' })} title="Fit (Ctrl 0)" className="min-w-[54px] tabular-nums">
              {zoom === 'fit' ? 'Fit' : `${Math.round(z * 100)}%`}
            </button>
            <button onClick={() => set({ zoom: Math.min(6, z * 1.2) })} title="Zoom in (Ctrl +)">
              <Plus size={13} />
            </button>
          </div>
          <button className="btn btn-sm" onClick={() => set({ zoom: 1 })} title="Actual size on screen (1 inch = 96 px)">
            1:1
          </button>
        </div>
      )}
    </div>
  );
}
