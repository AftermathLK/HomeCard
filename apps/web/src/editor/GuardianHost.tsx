import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { runGuardian, type CardProject, type GuardianReport, type RectIn } from '@homecard/shared';
import { useAssets } from '@/lib/assets';
import { measureContrast } from '@/lib/guardian';
import { CardSurface, RenderEnvContext, type RenderEnv, type TextMeasure } from '@/render/CardSurface';
import { useUi } from '@/store/ui';

/**
 * Lays out every surface of the card off-screen at 1:1 to measure text (ink box, overflow),
 * then computes contrast. Results feed the Print Guardian.
 */
export function GuardianHost({ project }: { project: CardProject }) {
  const packs = useAssets((s) => s.packs);
  const measures = useRef(new Map<string, TextMeasure>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contrastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const env = useMemo<RenderEnv>(
    () => ({
      mode: 'editor',
      dpi: 96,
      showEmptySlots: false,
      onTextMeasure: (id, m) => {
        measures.current.set(id, m);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(flush, 120);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function flush() {
    const ink: Record<string, RectIn | undefined> = {};
    const overflow: Record<string, boolean | undefined> = {};
    for (const [id, m] of measures.current) {
      ink[id] = m.ink ?? undefined;
      overflow[id] = m.overflow;
    }
    useUi.setState({ textInk: ink, textOverflow: overflow });
    scheduleContrast();
  }

  function scheduleContrast() {
    if (contrastTimer.current) clearTimeout(contrastTimer.current);
    contrastTimer.current = setTimeout(async () => {
      const p = projectRef.current;
      const ink = useUi.getState().textInk;
      const out: Record<string, number | undefined> = {};
      for (const s of p.surfaces)
        for (const e of s.elements) {
          if (e.type !== 'text' || e.hidden || !ink[e.id]) continue;
          out[e.id] = await measureContrast(p, s, e, ink[e.id]!, useAssets.getState().packs).catch(() => undefined);
        }
      useUi.setState({ textContrast: out });
    }, 350);
  }

  // Contrast also depends on photos/colours that don't change text layout.
  useEffect(() => {
    scheduleContrast();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Forget measurements for deleted elements.
  useEffect(() => {
    const ids = new Set(project.surfaces.flatMap((s) => s.elements.map((e) => e.id)));
    for (const id of [...measures.current.keys()]) if (!ids.has(id)) measures.current.delete(id);
  }, [project]);

  return createPortal(
    <div aria-hidden style={{ position: 'fixed', left: -20000, top: 0, visibility: 'hidden', pointerEvents: 'none', contain: 'strict', width: 1, height: 1, overflow: 'hidden' }}>
      <RenderEnvContext.Provider value={env}>
        {project.surfaces.map((s) => (
          <div key={s.id} style={{ position: 'absolute', left: 0, top: 0 }}>
            <CardSurface project={project} surface={s} packs={packs} />
          </div>
        ))}
      </RenderEnvContext.Provider>
    </div>,
    document.body,
  );
}

export function useGuardian(project: CardProject | null): GuardianReport | null {
  const textInk = useUi((s) => s.textInk);
  const textOverflow = useUi((s) => s.textOverflow);
  const textContrast = useUi((s) => s.textContrast);
  const failedRefs = useUi((s) => s.failedRefs);
  const fonts = useAssets((s) => s.fonts);
  const packs = useAssets((s) => s.packs);
  const stylesLoaded = useAssets((s) => s.stylesLoaded);
  const availableAssets = useMemo(
    () => (stylesLoaded ? packs.flatMap((p) => [...p.ornaments, ...p.stickers, ...p.backgrounds].map((a) => a.asset)) : undefined),
    [packs, stylesLoaded],
  );
  return useMemo(
    () =>
      project
        ? runGuardian(project, {
            textBounds: textInk,
            textOverflow,
            textContrast,
            failedRefs,
            availableFonts: fonts.map((f) => f.family),
            availableAssets,
          })
        : null,
    [project, textInk, textOverflow, textContrast, failedRefs, fonts, availableAssets],
  );
}
