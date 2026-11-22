import { useMemo } from 'react';
import clsx from 'clsx';
import { Plus, RefreshCw, Type } from 'lucide-react';
import {
  changeGreeting,
  getOccasion,
  GREETING_STYLES,
  PLACEHOLDER_FAMILY,
  resolveTokens,
  SURFACE_INFO,
  type GreetingStyle,
  type TextElement,
  type TextRole,
} from '@homecard/shared';
import { Section } from '@/components/ui';
import { addText } from '@/lib/actions';
import { useEditor, useProject } from '@/store/editor';
import { useUi } from '@/store/ui';

const ROLE_LABEL: Record<TextRole, string> = {
  headline: 'Greeting',
  subhead: 'Sub-greeting',
  names: 'Names / sign-off',
  year: 'Year',
  message: 'Message',
  body: 'Letter',
  small: 'Small print',
  monogram: 'Monogram',
  custom: 'Text',
};

/** Words: greeting library, family name & year tokens, and every text box on the card. */
export function TextPanel({ showAllSurfaces = false }: { showAllSurfaces?: boolean }) {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const selection = useEditor((s) => s.selection);
  const overflow = useUi((s) => s.textOverflow);
  const occasion = useMemo(() => (project ? getOccasion(project.occasionId) : null), [project?.occasionId]);
  if (!project || !occasion) return null;
  const ed = useEditor.getState();
  const style = project.greetingStyle;
  const variants = occasion.greetings[style]?.length ? occasion.greetings[style] : occasion.greetings.warm;
  const front = project.surfaces.find((s) => s.id === 'front');
  const currentHeadline = front?.elements.find((e): e is TextElement => e.type === 'text' && e.role === 'headline')?.text;

  const surfaces = showAllSurfaces ? project.surfaces : project.surfaces.filter((s) => s.id === surfaceId);

  return (
    <>
      <Section title="Your names">
        <label className="label">Family / sender name</label>
        <input
          className="input"
          value={project.familyName}
          placeholder={PLACEHOLDER_FAMILY}
          onChange={(e) => ed.edit((d) => void (d.familyName = e.target.value), 'family')}
        />
        <div className="mt-2 grid grid-cols-[1fr_auto] items-end gap-2">
          <div>
            <label className="label">Year</label>
            <input
              className="input"
              type="number"
              value={project.year}
              onChange={(e) => {
                const y = Number(e.target.value);
                if (Number.isFinite(y) && y > 1900 && y < 3000) ed.edit((d) => void (d.year = Math.round(y)), 'year');
              }}
            />
          </div>
          <span className="pb-2 text-xs text-ink-3">used wherever “{'{{year}}'}” appears</span>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Type <code>{'{{family}}'}</code>, <code>{'{{year}}'}</code> or <code>{'{{initial}}'}</code> in any text and it fills in automatically.
        </p>
      </Section>

      <Section title={`${occasion.name} greetings`}>
        <div className="mb-2 flex flex-wrap gap-1">
          {GREETING_STYLES.map((g) => (
            <button
              key={g.id}
              title={g.hint}
              className={clsx('chip', style === g.id && 'chip-on')}
              onClick={() => g.id !== style && ed.commit(changeGreeting(project, g.id as GreetingStyle, 0))}
            >
              {g.name}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {variants.map((v, i) => {
            const on = currentHeadline === v.headline;
            return (
              <button
                key={i}
                onClick={() => ed.commit(changeGreeting(project, style, i))}
                className={clsx('w-full rounded-lg border px-3 py-2 text-left transition', on ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-line-2')}
              >
                <div className="font-display text-[15px] leading-tight">{v.headline}</div>
                {v.subhead && <div className="text-xs text-ink-2">{v.subhead}</div>}
                {v.message && <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{v.message}</div>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1 text-xs text-ink-3">
          <RefreshCw size={11} /> Picking a greeting rewrites the card’s wording but keeps your layout and photos.
        </p>
      </Section>

      <Section
        title={showAllSurfaces ? 'All text on the card' : `Text on the ${SURFACE_INFO[surfaceId].label.toLowerCase()}`}
        actions={
          <div className="flex gap-1">
            <button className="btn btn-sm" onClick={() => addText('custom', 'Your text here')} title="Add a text box to this side">
              <Plus size={13} /> Text
            </button>
            <button className="btn btn-sm" onClick={() => addText('headline', occasion.greetings.short[0]?.headline ?? occasion.name)} title="Add a big greeting">
              <Type size={13} /> Greeting
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {surfaces.map((s) => {
            const texts = s.elements.filter((e): e is TextElement => e.type === 'text');
            if (!texts.length) return showAllSurfaces ? null : <p key={s.id} className="text-xs text-ink-3">No text on this side yet.</p>;
            return (
              <div key={s.id} className="space-y-2">
                {showAllSurfaces && <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{SURFACE_INFO[s.id].label}</div>}
                {texts.map((t) => {
                  const resolved = resolveTokens(t.text, project);
                  return (
                    <div key={t.id} className={clsx('rounded-lg border p-2', selection.includes(t.id) ? 'border-brand bg-brand-soft/50' : 'border-line bg-white')}>
                      <div className="mb-1 flex items-center justify-between">
                        <button
                          className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 hover:text-brand"
                          onClick={() => {
                            if (s.id !== useEditor.getState().surfaceId) ed.setSurface(s.id);
                            ed.select(t.id);
                          }}
                        >
                          {t.name || ROLE_LABEL[t.role]}
                        </button>
                        {overflow[t.id] && <span className="text-[11px] font-medium text-warn">doesn’t fit</span>}
                      </div>
                      <textarea
                        className="input min-h-[38px] resize-y text-[13px] leading-snug"
                        rows={Math.min(8, Math.max(1, t.text.split('\n').length + (t.text.length > 60 ? 1 : 0)))}
                        value={t.text}
                        onFocus={() => {
                          if (s.id !== useEditor.getState().surfaceId) ed.setSurface(s.id);
                          ed.select(t.id);
                        }}
                        onChange={(e) => ed.updateElement(t.id, (el) => {
                          if (el.type === 'text') {
                            el.text = e.target.value;
                            el.isPlaceholder = false;
                          }
                        }, `text:${t.id}`)}
                      />
                      {resolved !== t.text && <div className="mt-1 whitespace-pre-line text-[11px] text-ink-3">Prints as: {resolved}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
