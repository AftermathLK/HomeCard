import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, Copy, Palette, Sparkles, Wallpaper, Wand2 } from 'lucide-react';
import {
  BUILTIN_FOILS,
  FONT_PAIRINGS,
  fontStack,
  getOccasion,
  harmonyThemes,
  mergePalettes,
  resolveColor,
  resolveTokens,
  THEME_TOKEN_LABELS,
  THEME_TOKENS,
  type FontPairing,
  type FontRole,
  type HarmonyTheme,
  type PaletteColor,
  type ThemeColors,
} from '@homecard/shared';
import { ColorField, Section, Segmented, Slider, Spinner, Swatch } from '@/components/ui';
import { allFoils, useAssets } from '@/lib/assets';
import { analyzeImage } from '@/lib/image';
import { useEditor, useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

/* ---------------- Colours ---------------- */

export function PalettePanel() {
  const project = useProject();
  const packs = useAssets((s) => s.packs);
  const [harmony, setHarmony] = useState<{ palette: PaletteColor[]; themes: HarmonyTheme[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);
  if (!project) return null;
  const ed = useEditor.getState();
  const occ = getOccasion(project.occasionId);
  const packPalettes = packs
    .filter((p) => p.palettes.length)
    .sort((a, b) => Number(b.occasions.includes(project.occasionId)) - Number(a.occasions.includes(project.occasionId)));

  const applyColors = (colors: ThemeColors, id: string, name: string) =>
    ed.edit((d) => {
      d.theme.colors = { ...colors };
      d.theme.paletteId = id;
      d.theme.paletteName = name;
    });

  const runHarmony = async () => {
    const refs = [
      ...new Set([
        ...project.surfaces.flatMap((s) => s.elements.flatMap((e) => (e.type === 'photo' && e.fill ? [e.fill.ref] : []))),
        ...project.photos.map((p) => p.ref),
      ]),
    ].slice(0, 6);
    if (!refs.length) {
      useUi.getState().toast('Add a photo first — Color Harmony builds themes from your photos.', 'info');
      return;
    }
    setBusy(true);
    try {
      const results = await Promise.all(refs.map((r) => analyzeImage(r).catch(() => null)));
      // The front photos weigh more than the tray.
      const pals = results.filter(Boolean).map((r, i) => r!.palette.map((c) => ({ ...c, weight: c.weight * (i === 0 ? 2 : 1) })));
      const palette = mergePalettes(pals, 5);
      setHarmony({ palette, themes: harmonyThemes(palette) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Color Harmony"
        actions={
          <button className="btn btn-sm" onClick={runHarmony} disabled={busy}>
            {busy ? <Spinner size={13} /> : <Wand2 size={13} />} {harmony ? 'Refresh' : 'Match my photos'}
          </button>
        }
      >
        {!harmony ? (
          <p className="text-xs text-ink-3">Pulls the five main colours out of your photos and turns them into card themes with readable, print-safe contrast.</p>
        ) : (
          <>
            <div className="mb-2.5 flex h-7 overflow-hidden rounded-lg border border-line">
              {harmony.palette.map((c) => (
                <div key={c.hex} style={{ background: c.hex, flex: Math.max(0.6, c.weight * 5) }} title={`${c.hex} · ${Math.round(c.weight * 100)}%`} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {harmony.themes.map((t) => (
                <ThemeTile
                  key={t.id}
                  name={t.name}
                  hint={t.description}
                  colors={t.colors}
                  active={project.theme.paletteId === `harmony:${t.id}`}
                  onClick={() => applyColors(t.colors, `harmony:${t.id}`, t.name)}
                />
              ))}
            </div>
          </>
        )}
      </Section>
      <Section title={`${occ.name} palettes`}>
        <div className="grid grid-cols-2 gap-2">
          {occ.palettes.map((p) => (
            <ThemeTile key={p.id} name={p.name} colors={p.colors} active={project.theme.paletteId === p.id} onClick={() => applyColors(p.colors, p.id, p.name)} />
          ))}
        </div>
      </Section>
      {packPalettes.map((pack) => (
        <Section key={pack.id} title={pack.name}>
          <div className="grid grid-cols-2 gap-2">
            {pack.palettes.map((p) => {
              const id = p.id;
              return <ThemeTile key={id} name={p.name} colors={p.colors} active={project.theme.paletteId === id} onClick={() => applyColors(p.colors, id, p.name)} />;
            })}
          </div>
        </Section>
      ))}
      <Section
        title="Fine-tune colours"
        actions={
          <button className="btn btn-ghost btn-sm" onClick={() => setCustom((v) => !v)}>
            <Palette size={13} /> {custom ? 'Hide' : 'Edit'}
          </button>
        }
      >
        {custom ? (
          <div className="space-y-1.5">
            {THEME_TOKENS.map((k) => (
              <ColorField
                key={k}
                label={THEME_TOKEN_LABELS[k]}
                value={project.theme.colors[k].slice(0, 7)}
                onChange={(hex) =>
                  ed.edit((d) => {
                    d.theme.colors[k] = hex;
                    d.theme.paletteName = 'Custom';
                  }, `theme:${k}`)
                }
              />
            ))}
            <p className="pt-1 text-xs text-ink-3">The Print Guardian warns if text colours get too close to what’s behind them.</p>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {THEME_TOKENS.slice(0, 6).map((k) => (
              <Swatch key={k} color={project.theme.colors[k]} title={THEME_TOKEN_LABELS[k]} size={22} />
            ))}
            <span className="ml-1 truncate text-xs text-ink-3">{project.theme.paletteName ?? 'Custom'}</span>
          </div>
        )}
      </Section>
    </>
  );
}

function ThemeTile({ name, hint, colors, active, onClick }: { name: string; hint?: string; colors: ThemeColors; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={hint} className={clsx('overflow-hidden rounded-lg border text-left transition', active ? 'border-brand ring-2 ring-brand' : 'border-line hover:border-line-2')}>
      <div className="flex h-12 items-center justify-center gap-1 px-2" style={{ background: colors.background }}>
        <span className="font-display text-[15px]" style={{ color: colors.text }}>
          Aa
        </span>
        <span className="h-3 w-3 rounded-full" style={{ background: colors.accent }} />
        <span className="h-3 w-3 rounded-full" style={{ background: colors.accent2 }} />
      </div>
      <div className="flex items-center justify-between bg-white px-2 py-1">
        <span className="truncate text-[11px] font-medium">{name}</span>
        {active && <Check size={12} className="text-brand" />}
      </div>
    </button>
  );
}

/* ---------------- Fonts ---------------- */

export function FontsPanel() {
  const project = useProject();
  const packs = useAssets((s) => s.packs);
  const fonts = useAssets((s) => s.fonts);
  const [fine, setFine] = useState(false);
  const pairings = useMemo(() => [...FONT_PAIRINGS, ...packs.flatMap((p) => p.fontPairings)], [packs]);
  if (!project) return null;
  const ed = useEditor.getState();
  const occ = getOccasion(project.occasionId);
  const sampleHead = occ.greetings.short[0]?.headline ?? occ.name;
  const sampleNames = resolveTokens('{{family}}', project);
  const t = project.theme;

  const applyPairing = (p: FontPairing) =>
    ed.edit((d) => {
      d.theme.pairingId = p.id;
      d.theme.fonts = { display: { ...p.display }, body: { ...p.body }, accent: { ...p.accent } };
    });

  return (
    <>
      <Section title="Designer font pairings">
        <div className="space-y-1.5">
          {pairings.map((p) => {
            const on = t.pairingId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPairing(p)}
                className={clsx('w-full rounded-lg border px-3 py-2 text-left transition', on ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2')}
              >
                <div className="truncate text-[22px] leading-tight" style={{ fontFamily: fontStack(p.display.family), fontWeight: p.display.weight, fontStyle: p.display.style, letterSpacing: `${p.display.letterSpacing ?? 0}em`, textTransform: p.display.transform === 'uppercase' ? 'uppercase' : 'none' }}>
                  {sampleHead}
                </div>
                <div className="mt-0.5 truncate text-[11px]" style={{ fontFamily: fontStack(p.accent.family), fontWeight: p.accent.weight, fontStyle: p.accent.style, letterSpacing: `${p.accent.letterSpacing ?? 0}em`, textTransform: p.accent.transform === 'uppercase' ? 'uppercase' : 'none' }}>
                  {sampleNames}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                  <span>{p.name}</span>
                  <span>{p.mood}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Section>
      <Section
        title="Fine-tune fonts"
        actions={
          <button className="btn btn-ghost btn-sm" onClick={() => setFine((v) => !v)}>
            {fine ? 'Hide' : 'Edit'}
          </button>
        }
      >
        {fine ? (
          <div className="space-y-3">
            {(['display', 'body', 'accent'] as FontRole[]).map((role) => {
              const spec = t.fonts[role];
              const fam = fonts.find((f) => f.family === spec.family);
              const weights = fam ? [...new Set(fam.faces.map((x) => x.weight))].sort((a, b) => a - b) : [spec.weight];
              return (
                <div key={role}>
                  <div className="label">{role === 'display' ? 'Greeting font' : role === 'body' ? 'Message font' : 'Names & accents font'}</div>
                  <div className="grid grid-cols-[1fr_76px] gap-1.5">
                    <select
                      className="input"
                      value={spec.family}
                      style={{ fontFamily: fontStack(spec.family) }}
                      onChange={(e) =>
                        ed.edit((d) => {
                          const f = fonts.find((x) => x.family === e.target.value);
                          const ws = f ? f.faces.map((x) => x.weight) : [400];
                          d.theme.fonts[role].family = e.target.value;
                          if (!ws.includes(d.theme.fonts[role].weight)) d.theme.fonts[role].weight = ws.reduce((a, b) => (Math.abs(b - 400) < Math.abs(a - 400) ? b : a), ws[0]);
                          d.theme.pairingId = undefined;
                        })
                      }
                    >
                      {['serif', 'sans', 'script', 'handwritten', 'display', 'custom'].map((cat) => {
                        const list = fonts.filter((f) => (cat === 'custom' ? f.source === 'custom' : f.source === 'bundled' && f.category === cat));
                        if (!list.length) return null;
                        return (
                          <optgroup key={cat} label={cat === 'custom' ? 'Your fonts (/data/fonts)' : cat[0].toUpperCase() + cat.slice(1)}>
                            {list.map((f) => (
                              <option key={f.family} value={f.family}>
                                {f.family}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                      {!fam && <option value={spec.family}>{spec.family} (missing)</option>}
                    </select>
                    <select className="input" value={spec.weight} onChange={(e) => ed.edit((d) => void (d.theme.fonts[role].weight = Number(e.target.value)))}>
                      {weights.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Segmented
                      size="sm"
                      value={spec.style}
                      onChange={(v) => ed.edit((d) => void (d.theme.fonts[role].style = v))}
                      options={[
                        { value: 'normal', label: 'Regular' },
                        { value: 'italic', label: <i>Italic</i> },
                      ]}
                    />
                    <Segmented
                      size="sm"
                      value={spec.transform ?? 'none'}
                      onChange={(v) => ed.edit((d) => void (d.theme.fonts[role].transform = v))}
                      options={[
                        { value: 'none', label: 'Aa' },
                        { value: 'uppercase', label: 'AA' },
                      ]}
                    />
                  </div>
                  <Slider
                    label="Letter spacing"
                    min={-0.05}
                    max={0.4}
                    step={0.01}
                    value={spec.letterSpacing ?? 0}
                    format={(v) => `${v.toFixed(2)} em`}
                    onChange={(v) => ed.edit((d) => void (d.theme.fonts[role].letterSpacing = v), `ls:${role}`)}
                    onReset={() => ed.edit((d) => void (d.theme.fonts[role].letterSpacing = 0))}
                  />
                </div>
              );
            })}
            <p className="text-xs text-ink-3">Add your own .ttf / .otf / .woff2 fonts in Settings or the /data/fonts folder — they appear here and in the print renderer instantly.</p>
          </div>
        ) : (
          <div className="text-xs text-ink-3">
            {t.fonts.display.family} · {t.fonts.body.family} · {t.fonts.accent.family}
          </div>
        )}
      </Section>
    </>
  );
}

/* ---------------- Foils & background ---------------- */

export function FinishPanel() {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const packs = useAssets((s) => s.packs);
  const foils = useMemo(() => [...BUILTIN_FOILS, ...allFoils(packs)], [packs]);
  const backgrounds = useMemo(() => packs.flatMap((p) => p.backgrounds.map((b) => ({ ...b, pack: p.name }))), [packs]);
  if (!project) return null;
  const ed = useEditor.getState();
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  const bg = surface.background;
  const texts = project.surfaces.flatMap((s) => s.elements.filter((e) => e.type === 'text'));
  const foilCount = texts.filter((e) => e.type === 'text' && e.fill === 'foil').length;

  const setBg = (recipe: (b: typeof bg) => void, key?: string) => ed.updateSurface(surfaceId, (s) => recipe(s.background), key);

  return (
    <>
      <Section title="Metallic foil">
        <div className="grid grid-cols-4 gap-2">
          {foils.map((f) => (
            <button key={f.id} onClick={() => ed.edit((d) => void (d.theme.foil = f.id))} className="flex flex-col items-center gap-1" title={f.name}>
              <span className={clsx('h-10 w-10 rounded-full border shadow-sm', project.theme.foil === f.id ? 'ring-2 ring-brand ring-offset-2' : '')} style={{ background: f.gradient, borderColor: 'rgba(0,0,0,.15)' }} />
              <span className="w-full truncate text-center text-[10px] text-ink-2">{f.name.replace(/ foil$/i, '')}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            className="btn btn-sm"
            onClick={() =>
              ed.edit((d) => {
                for (const s of d.surfaces) for (const e of s.elements) if (e.type === 'text' && (e.role === 'headline' || e.role === 'year' || e.role === 'monogram')) e.fill = 'foil';
              })
            }
          >
            <Sparkles size={13} /> Foil the greeting
          </button>
          {foilCount > 0 && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                ed.edit((d) => {
                  for (const s of d.surfaces) for (const e of s.elements) if (e.type === 'text') e.fill = 'color';
                })
              }
            >
              Remove foil
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-3">Foil is printed as a rich metallic gradient (true foil stamping needs a specialty printer). It stays sharp vector text in PDFs.</p>
      </Section>
      <Section
        title="Background"
        actions={
          project.surfaces.length > 1 && (
            <button
              className="btn btn-ghost btn-sm"
              title="Use this background on every side"
              onClick={() =>
                ed.edit((d) => {
                  for (const s of d.surfaces) s.background = { ...bg };
                })
              }
            >
              <Copy size={13} /> All sides
            </button>
          )
        }
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {(['@background', '@surface', '@accent', '@accent2', '@text'] as const).map((tok) => (
            <Swatch key={tok} color={resolveColor(tok, project.theme)} active={bg.color === tok} onClick={() => setBg((b) => void (b.color = tok))} title={THEME_TOKEN_LABELS[tok.slice(1) as keyof ThemeColors]} />
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <ColorField value={resolveColor(bg.color, project.theme, '#ffffff').slice(0, 7)} onChange={(hex) => setBg((b) => void (b.color = hex), 'bg-color')} />
        </div>
        <div className="label mt-3">Paper & texture</div>
        <div className="grid grid-cols-4 gap-1.5">
          <button onClick={() => setBg((b) => void (b.texture = null))} className={clsx('flex aspect-square items-center justify-center rounded-lg border text-[11px] text-ink-3', !bg.texture ? 'border-brand ring-2 ring-brand' : 'border-line bg-white')}>
            None
          </button>
          {backgrounds.map((b) => (
            <button
              key={b.asset}
              title={`${b.name} — ${b.pack}`}
              onClick={() =>
                setBg((x) => {
                  x.texture = b.asset;
                  x.textureMode = b.mode;
                  x.textureScaleIn = b.tileSizeIn;
                  x.textureOpacity = 1;
                  // Pixel size, credit and Soften belong to the previous (stock) image.
                  x.textureWidth = undefined;
                  x.textureHeight = undefined;
                  x.credit = null;
                  x.creditUrl = null;
                  x.soften = false;
                })
              }
              className={clsx('aspect-square overflow-hidden rounded-lg border', bg.texture === b.asset ? 'border-brand ring-2 ring-brand' : 'border-line')}
              style={{ background: resolveColor(bg.color, project.theme, '#fff') }}
            >
              <img src={b.url} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
        {!backgrounds.length && <p className="mt-2 text-xs text-ink-3">Drop textures into /data/styles or upload them in Settings → Style packs.</p>}
        <button className="btn btn-sm mt-2 w-full" onClick={() => (useUi.getState().mode === 'guided' ? useUi.getState().set({ subTab: 'backgrounds' }) : useUi.getState().set({ tab: 'backgrounds' }))}>
          <Wallpaper size={13} /> Stock backgrounds & pattern studio
        </button>
        {bg.texture && (
          <div className="mt-2">
            <Slider label="Texture strength" min={0.05} max={1} value={bg.textureOpacity ?? 1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setBg((b) => void (b.textureOpacity = v), 'tex-op')} />
            {bg.textureMode !== 'cover' && (
              <Slider label="Pattern size" min={0.5} max={6} step={0.05} value={bg.textureScaleIn ?? 2} format={(v) => `${v.toFixed(2)}"`} onChange={(v) => setBg((b) => void (b.textureScaleIn = v), 'tex-scale')} />
            )}
            <Segmented
              size="sm"
              value={bg.textureMode ?? 'tile'}
              onChange={(v) => setBg((b) => void (b.textureMode = v))}
              options={[
                { value: 'tile', label: 'Repeat' },
                { value: 'cover', label: 'Stretch to fill' },
              ]}
            />
          </div>
        )}
      </Section>
    </>
  );
}

/** Studio "Style" tab: everything look-related in one scroll. */
export function StylePanel() {
  const [tab, setTab] = useState<'colors' | 'fonts' | 'finish'>('colors');
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-line bg-paper px-4 py-2.5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'colors', label: 'Colours' },
            { value: 'fonts', label: 'Fonts' },
            { value: 'finish', label: 'Foil & paper' },
          ]}
        />
      </div>
      {tab === 'colors' && <PalettePanel />}
      {tab === 'fonts' && <FontsPanel />}
      {tab === 'finish' && <FinishPanel />}
    </>
  );
}
