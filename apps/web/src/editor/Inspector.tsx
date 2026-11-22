import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Crop,
  FlipHorizontal2,
  FoldVertical,
  ImagePlus,
  ShieldCheck,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  DPI_GOOD,
  DPI_MIN,
  fontStack,
  getBuiltinOrnament,
  isHexColor,
  MASK_LABELS,
  photoDpi,
  resolveColor,
  THEME_TOKEN_LABELS,
  type CardElement,
  type ColorRef,
  type MaskShape,
  type PhotoElement,
  type ScrimElement,
  type ShapeElement,
  type TextElement,
  type ThemeColors,
} from '@homecard/shared';
import { ColorField, Section, Segmented, Slider, Toggle } from '@/components/ui';
import { alignToCard, clearFrame, deleteElements, moveInsideSafe, smartCrop } from '@/lib/actions';
import { useAssets } from '@/lib/assets';
import { useEditor, useProject, useSelected } from '@/store/editor';
import { useUi } from '@/store/ui';
import { CompareButton } from './panels/PolishPanel';
import { elementLabel } from './panels/LayersPanel';

const TOKENS: Array<keyof ThemeColors> = ['text', 'textMuted', 'accent', 'accent2', 'onPhoto', 'background', 'surface', 'scrim'];

/** Properties of the selected element. */
export function Inspector() {
  const project = useProject();
  const el = useSelected();
  const selection = useEditor((s) => s.selection);
  if (!project || !el) return null;
  const upd = (patch: Partial<CardElement> | ((e: CardElement) => void), key?: string | null) => useEditor.getState().updateElement(el.id, patch, key);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="panel-title">{el.type === 'scrim' ? 'Shade' : el.type[0].toUpperCase() + el.type.slice(1)}</div>
          <div className="truncate text-[13px] font-medium">{elementLabel(el, project)}</div>
        </div>
        {selection.length > 1 && <span className="chip">{selection.length} selected</span>}
        <button className="icon-btn hover:!text-bad" title="Delete" onClick={() => deleteElements(selection)}>
          <Trash2 size={16} />
        </button>
      </div>
      {el.type === 'text' && <TextProps el={el} upd={upd} />}
      {el.type === 'photo' && <PhotoProps el={el} upd={upd} />}
      {el.type === 'ornament' && (
        <Section title="Colour">
          <ColorRefPicker label="Main" value={el.color} onChange={(c, k) => upd({ color: c }, k)} />
          {(el.asset.startsWith('builtin:') ? getBuiltinOrnament(el.asset.slice(8))?.twoTone : true) && (
            <div className="mt-2">
              <ColorRefPicker label="Second" value={el.color2 ?? el.color} onChange={(c, k) => upd({ color2: c }, k)} />
            </div>
          )}
          <button className="btn btn-sm mt-3" onClick={() => upd({ flipX: !el.flipX }, null)}>
            <FlipHorizontal2 size={14} /> Mirror
          </button>
        </Section>
      )}
      {el.type === 'sticker' && (
        <Section title="Sticker">
          <button className="btn btn-sm" onClick={() => upd({ flipX: !el.flipX }, null)}>
            <FlipHorizontal2 size={14} /> Mirror
          </button>
        </Section>
      )}
      {el.type === 'shape' && <ShapeProps el={el} upd={upd} />}
      {el.type === 'scrim' && <ScrimProps el={el} upd={upd} />}
      <Section title="Position & size">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="X" unit="in" value={el.x} step={0.0625} onChange={(v) => upd({ x: v }, `geo:${el.id}`)} />
          <NumField label="Y" unit="in" value={el.y} step={0.0625} onChange={(v) => upd({ y: v }, `geo:${el.id}`)} />
          <NumField label="Width" unit="in" value={el.w} step={0.0625} min={0.05} onChange={(v) => upd({ w: v }, `geo:${el.id}`)} />
          <NumField label="Height" unit="in" value={el.h} step={0.0625} min={0.02} onChange={(v) => upd({ h: v }, `geo:${el.id}`)} />
          <NumField label="Rotate" unit="°" value={el.rotation} step={1} onChange={(v) => upd({ rotation: ((v % 360) + 360) % 360 > 180 ? (((v % 360) + 360) % 360) - 360 : ((v % 360) + 360) % 360 }, `geo:${el.id}`)} />
          <NumField label="Opacity" unit="%" value={Math.round(el.opacity * 100)} step={5} min={0} max={100} onChange={(v) => upd({ opacity: v / 100 }, `op:${el.id}`)} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1">
          <button className="btn btn-sm" title="Centre horizontally on the card" onClick={() => alignToCard(selection, 'x')}>
            <AlignCenterVertical size={14} /> Centre
          </button>
          <button className="btn btn-sm" title="Centre vertically on the card" onClick={() => alignToCard(selection, 'y')}>
            <AlignCenterHorizontal size={14} /> Middle
          </button>
          {el.type !== 'scrim' && el.type !== 'photo' && (
            <button className="btn btn-sm" title="Move fully inside the 1/4&quot; safe area" onClick={() => moveInsideSafe(el.id)}>
              <ShieldCheck size={14} /> Inside safe area
            </button>
          )}
        </div>
      </Section>
    </div>
  );
}

type Upd = (patch: Partial<CardElement> | ((e: CardElement) => void), key?: string | null) => void;

/* ---------------- Text ---------------- */

function TextProps({ el, upd }: { el: TextElement; upd: Upd }) {
  const project = useProject()!;
  const fonts = useAssets((s) => s.fonts);
  const overflow = useUi((s) => s.textOverflow[el.id]);
  const contrast = useUi((s) => s.textContrast[el.id]);
  const themeFont = project.theme.fonts[el.fontRole];
  const family = el.fontFamily ?? themeFont.family;
  const fam = fonts.find((f) => f.family === family);
  const weights = fam ? [...new Set(fam.faces.map((f) => f.weight))].sort((a, b) => a - b) : [el.fontWeight ?? themeFont.weight];
  const t = (recipe: (x: TextElement) => void, key?: string | null) => upd((e) => e.type === 'text' && recipe(e), key);

  return (
    <>
      <Section title="Text">
        <textarea
          className="input min-h-[60px] resize-y text-[13px]"
          value={el.text}
          onChange={(e) => t((x) => {
            x.text = e.target.value;
            x.isPlaceholder = false;
          }, `text:${el.id}`)}
        />
        {overflow && (
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-warn-soft px-2 py-1.5 text-xs text-warn">
            Text is too long for its box.
            <button className="btn btn-sm" onClick={() => t((x) => void (x.autoFit = true), null)}>
              Shrink to fit
            </button>
          </div>
        )}
        {contrast !== undefined && contrast < 3 && <div className="mt-1.5 rounded-lg bg-warn-soft px-2 py-1.5 text-xs text-warn">Hard to read here (contrast {contrast.toFixed(1)}:1). Try a shadow, a shade, or another colour.</div>}
      </Section>
      <Section title="Font">
        <div className="mb-2">
          <Segmented
            size="sm"
            value={el.fontRole}
            onChange={(v) => t((x) => {
              x.fontRole = v;
              x.fontFamily = undefined;
              x.fontWeight = undefined;
            }, null)}
            options={[
              { value: 'display', label: 'Greeting' },
              { value: 'body', label: 'Message' },
              { value: 'accent', label: 'Accent' },
            ]}
          />
        </div>
        <div className="grid grid-cols-[1fr_72px] gap-1.5">
          <select
            className="input"
            value={el.fontFamily ?? ''}
            style={{ fontFamily: fontStack(family) }}
            onChange={(e) => t((x) => {
              x.fontFamily = e.target.value || undefined;
              const f = fonts.find((ff) => ff.family === e.target.value);
              if (f && x.fontWeight && !f.faces.some((fc) => fc.weight === x.fontWeight)) x.fontWeight = undefined;
            }, null)}
          >
            <option value="">Theme font ({themeFont.family})</option>
            {fonts.map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
                {f.source === 'custom' ? ' ★' : ''}
              </option>
            ))}
          </select>
          <select className="input" value={el.fontWeight ?? themeFont.weight} onChange={(e) => t((x) => void (x.fontWeight = Number(e.target.value)), null)}>
            {weights.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <Slider label="Size" min={6} max={160} step={0.5} value={el.fontSize} format={(v) => `${v.toFixed(1)} pt`} onChange={(v) => t((x) => void (x.fontSize = v), `fs:${el.id}`)} />
        <Slider label="Line spacing" min={0.7} max={2.2} step={0.01} value={el.lineHeight} format={(v) => v.toFixed(2)} onChange={(v) => t((x) => void (x.lineHeight = v), `lh:${el.id}`)} />
        <Slider
          label="Letter spacing"
          min={-0.05}
          max={0.5}
          step={0.01}
          value={el.letterSpacing ?? themeFont.letterSpacing ?? 0}
          format={(v) => `${v.toFixed(2)} em`}
          onChange={(v) => t((x) => void (x.letterSpacing = v), `ls:${el.id}`)}
          onReset={() => t((x) => void (x.letterSpacing = undefined), null)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Segmented
            size="sm"
            value={el.align}
            onChange={(v) => t((x) => void (x.align = v), null)}
            options={[
              { value: 'left', label: <AlignLeft size={14} />, title: 'Left' },
              { value: 'center', label: <AlignCenter size={14} />, title: 'Centre' },
              { value: 'right', label: <AlignRight size={14} />, title: 'Right' },
            ]}
          />
          <Segmented
            size="sm"
            value={el.vAlign}
            onChange={(v) => t((x) => void (x.vAlign = v), null)}
            options={[
              { value: 'top', label: <ArrowUpToLine size={14} />, title: 'Top' },
              { value: 'middle', label: <FoldVertical size={14} />, title: 'Middle' },
              { value: 'bottom', label: <ArrowDownToLine size={14} />, title: 'Bottom' },
            ]}
          />
          <Segmented
            size="sm"
            value={el.transform ?? 'theme'}
            onChange={(v) => t((x) => void (x.transform = v), null)}
            options={[
              { value: 'theme', label: 'Auto', title: 'Follow the font pairing' },
              { value: 'none', label: 'Aa' },
              { value: 'uppercase', label: 'AA' },
            ]}
          />
          <button className={clsx('btn btn-sm', el.italic && 'chip-on')} onClick={() => t((x) => void (x.italic = !x.italic), null)} title="Italic">
            <i>I</i>
          </button>
        </div>
      </Section>
      <Section title="Colour & effects">
        <Segmented
          size="sm"
          value={el.fill}
          onChange={(v) => t((x) => void (x.fill = v), null)}
          options={[
            { value: 'color', label: 'Ink colour' },
            { value: 'foil', label: 'Metallic foil' },
          ]}
        />
        {el.fill === 'color' ? (
          <div className="mt-2">
            <ColorRefPicker value={el.color} onChange={(c, k) => t((x) => void (x.color = c), k)} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-3">Uses the card’s foil ({project.theme.foil}). Change it under Style → Foil & paper.</p>
        )}
        <div className="mt-2 space-y-1">
          <Toggle checked={el.shadow} onChange={(v) => t((x) => void (x.shadow = v), null)} label="Soft shadow" hint="Lifts text off busy photos." />
          <Toggle checked={el.autoFit} onChange={(v) => t((x) => void (x.autoFit = v), null)} label="Shrink to fit box" hint="Long names shrink instead of overflowing." />
        </div>
      </Section>
    </>
  );
}

/* ---------------- Photo ---------------- */

function PhotoProps({ el, upd }: { el: PhotoElement; upd: Upd }) {
  const dpi = photoDpi(el);
  const p = (recipe: (x: PhotoElement) => void, key?: string | null) => upd((e) => e.type === 'photo' && recipe(e), key);
  const sev = dpi === null ? null : dpi >= DPI_GOOD ? 'ok' : dpi >= DPI_MIN ? 'warn' : 'bad';
  return (
    <>
      <Section title="Photo">
        {el.fill ? (
          <>
            <div className={clsx('mb-2.5 flex items-center justify-between rounded-lg px-2.5 py-2 text-xs', sev === 'ok' ? 'bg-ok-soft text-ok' : sev === 'warn' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad')}>
              <span>
                <b>{Math.round(dpi!)} DPI</b> at this size
              </span>
              <span>{sev === 'ok' ? 'Sharp' : sev === 'warn' ? 'Slightly soft' : 'Will look blurry'}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-sm" onClick={() => useUi.getState().set({ cropId: el.id })}>
                <Crop size={13} /> Crop
              </button>
              <button className="btn btn-sm" onClick={() => smartCrop(el.id)} title="Re-frame around faces">
                <Wand2 size={13} /> Smart crop
              </button>
              <button className="btn btn-sm" onClick={() => useUi.getState().set({ picker: { elementId: el.id, multiple: false } })}>
                <ImagePlus size={13} /> Replace
              </button>
              <CompareButton elementId={el.id} label="Compare" />
              <button className="btn btn-sm btn-ghost" onClick={() => clearFrame(el.id)}>
                Empty frame
              </button>
            </div>
            <button className="mt-2 text-xs font-medium text-brand hover:underline" onClick={() => useUi.getState().set(useUi.getState().mode === 'studio' ? { tab: 'polish' } : { step: 3 })}>
              Polish this photo →
            </button>
          </>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => useUi.getState().set({ picker: { elementId: el.id, multiple: false } })}>
            <ImagePlus size={13} /> Choose photo
          </button>
        )}
      </Section>
      <Section title="Frame">
        <div className="label">Shape</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {(Object.keys(MASK_LABELS) as MaskShape[]).map((m) => (
            <button key={m} className={clsx('chip', el.mask === m && 'chip-on')} onClick={() => p((x) => {
              x.mask = m;
              if (m === 'rounded' && !x.radius) x.radius = 0.2;
            }, null)}>
              {MASK_LABELS[m]}
            </button>
          ))}
        </div>
        {el.mask === 'rounded' && <Slider label="Corner radius" min={0} max={1.5} value={el.radius} format={(v) => `${v.toFixed(2)}"`} onChange={(v) => p((x) => void (x.radius = v), `rad:${el.id}`)} />}
        <div className="label mt-2">Style</div>
        <Segmented
          size="sm"
          value={el.frameStyle}
          onChange={(v) => p((x) => void (x.frameStyle = v), null)}
          options={[
            { value: 'none', label: 'Plain' },
            { value: 'polaroid', label: 'Instant photo' },
            { value: 'mat', label: 'Mat' },
          ]}
        />
        <div className="mt-2 space-y-1">
          <Toggle checked={el.shadow} onChange={(v) => p((x) => void (x.shadow = v), null)} label="Drop shadow" />
          <Toggle checked={!!el.border} onChange={(v) => p((x) => void (x.border = v ? { width: 0.04, color: '@surface' } : null), null)} label="Border" />
        </div>
        {el.border && (
          <div className="mt-1">
            <Slider label="Border width" min={0.01} max={0.3} value={el.border.width} format={(v) => `${v.toFixed(2)}"`} onChange={(v) => p((x) => void (x.border!.width = v), `bw:${el.id}`)} />
            <ColorRefPicker value={el.border.color} onChange={(c, k) => p((x) => void (x.border!.color = c), k)} />
          </div>
        )}
      </Section>
    </>
  );
}

/* ---------------- Shape & scrim ---------------- */

function ShapeProps({ el, upd }: { el: ShapeElement; upd: Upd }) {
  const s = (recipe: (x: ShapeElement) => void, key?: string | null) => upd((e) => e.type === 'shape' && recipe(e), key);
  return (
    <Section title="Shape">
      <Toggle checked={el.fill !== null} onChange={(v) => s((x) => void (x.fill = v ? '@surface' : null), null)} label="Fill" />
      {el.fill !== null && <ColorRefPicker value={el.fill} onChange={(c, k) => s((x) => void (x.fill = c), k)} />}
      <div className="mt-2">
        <Toggle checked={!!el.stroke} onChange={(v) => s((x) => void (x.stroke = v ? { width: 0.02, color: '@accent' } : null), null)} label="Outline" />
      </div>
      {el.stroke && (
        <>
          <Slider label="Outline width" min={0.005} max={0.25} step={0.005} value={el.stroke.width} format={(v) => `${(v * 72).toFixed(1)} pt`} onChange={(v) => s((x) => void (x.stroke!.width = v), `sw:${el.id}`)} />
          <ColorRefPicker value={el.stroke.color} onChange={(c, k) => s((x) => void (x.stroke!.color = c), k)} />
        </>
      )}
      {el.shape === 'rect' && <Slider label="Corner radius" min={0} max={1.5} value={el.radius} format={(v) => `${v.toFixed(2)}"`} onChange={(v) => s((x) => void (x.radius = v), `rad:${el.id}`)} />}
    </Section>
  );
}

function ScrimProps({ el, upd }: { el: ScrimElement; upd: Upd }) {
  const s = (recipe: (x: ScrimElement) => void, key?: string | null) => upd((e) => e.type === 'scrim' && recipe(e), key);
  return (
    <Section title="Shade">
      <div className="mb-2 flex flex-wrap gap-1">
        {(
          [
            ['to-top', 'Fade up'],
            ['to-bottom', 'Fade down'],
            ['to-left', 'Fade left'],
            ['to-right', 'Fade right'],
            ['radial', 'Spotlight'],
            ['solid', 'Even'],
          ] as Array<[ScrimElement['direction'], string]>
        ).map(([d, label]) => (
          <button key={d} className={clsx('chip', el.direction === d && 'chip-on')} onClick={() => s((x) => void (x.direction = d), null)}>
            {label}
          </button>
        ))}
      </div>
      <ColorRefPicker value={el.color} onChange={(c, k) => s((x) => void (x.color = c), k)} />
      <Slider label="Strength" min={0} max={1} value={el.strength} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s((x) => void (x.strength = v), `str:${el.id}`)} />
      {el.direction !== 'solid' && <Slider label="Solid part" min={0} max={0.9} value={el.extent} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => s((x) => void (x.extent = v), `ext:${el.id}`)} />}
    </Section>
  );
}

/* ---------------- Shared inputs ---------------- */

/** Theme-token swatches (stay in sync with palette changes) plus a custom colour. */
export function ColorRefPicker({ value, onChange, label }: { value: ColorRef; onChange: (c: ColorRef, key: string | null) => void; label?: string }) {
  const project = useProject()!;
  const theme = project.theme;
  return (
    <div>
      {label && <div className="label">{label}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        {TOKENS.map((tk) => (
          <button
            key={tk}
            title={`${THEME_TOKEN_LABELS[tk]} (follows palette)`}
            onClick={() => onChange(`@${tk}`, null)}
            className={clsx('h-6 w-6 rounded-full border transition', value === `@${tk}` ? 'ring-2 ring-brand ring-offset-2' : 'hover:scale-110')}
            style={{ background: theme.colors[tk], borderColor: 'rgba(0,0,0,.15)' }}
          />
        ))}
      </div>
      <div className="mt-1.5">
        <ColorField value={resolveColor(value, theme, '#000000').slice(0, 7)} onChange={(hex) => isHexColor(hex) && onChange(hex, 'color-custom')} />
      </div>
    </div>
  );
}

export function NumField({ label, value, onChange, step = 0.01, min, max, unit }: { label: ReactNode; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = (s: string) => {
    let v = Number(s);
    if (!Number.isFinite(v)) return setText(fmt(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(Math.round(v * 1000) / 1000);
  };
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2 focus-within:border-brand">
      <span className="w-12 shrink-0 text-[11px] font-medium text-ink-3">{label}</span>
      <input
        className="w-full min-w-0 bg-transparent py-1.5 text-right text-[13px] tabular-nums outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(String(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
          }
        }}
      />
      {unit && <span className="text-[11px] text-ink-3">{unit}</span>}
    </label>
  );
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
