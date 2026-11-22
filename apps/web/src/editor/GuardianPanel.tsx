import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import {
  clampCrop,
  isLargeText,
  photoContentBox,
  SURFACE_INFO,
  type GuardianIssue,
  type GuardianReport,
  type Severity,
  type TextElement,
} from '@homecard/shared';
import { Section } from '@/components/ui';
import { moveInsideSafe, smartCrop } from '@/lib/actions';
import { useAssets } from '@/lib/assets';
import { findReadableColor, measureContrast } from '@/lib/guardian';
import { findElement, useEditor } from '@/store/editor';
import { useUi } from '@/store/ui';

const FIX_LABEL: Record<NonNullable<GuardianIssue['fix']>, string> = {
  'zoom-out': 'Zoom out',
  'replace-photo': 'Replace photo',
  'edit-text': 'Edit text',
  'move-inside': 'Move inside',
  'smart-crop': 'Re-frame faces',
  readability: 'Make readable',
  'fill-slot': 'Choose photo',
  'change-font': 'Use theme font',
  'fit-text': 'Shrink to fit',
  'soften-background': 'Soften background',
};

export function statusColor(s: GuardianReport['status'] | Severity) {
  return s === 'green' || s === 'ok' ? 'text-ok' : s === 'yellow' || s === 'warn' || s === 'info' ? 'text-warn' : 'text-bad';
}

export function SeverityIcon({ s, size = 15 }: { s: Severity; size?: number }) {
  if (s === 'ok') return <CheckCircle2 size={size} className="text-ok" />;
  if (s === 'info') return <Info size={size} className="text-ink-3" />;
  if (s === 'warn') return <AlertTriangle size={size} className="text-warn" />;
  return <AlertOctagon size={size} className="text-bad" />;
}

/** Jump to the element an issue is about. */
export function focusIssue(issue: GuardianIssue) {
  const ed = useEditor.getState();
  if (ed.surfaceId !== issue.surfaceId) ed.setSurface(issue.surfaceId);
  useUi.setState({ view: 'editor' });
  if (issue.elementId) ed.select(issue.elementId);
}

export function applyFix(issue: GuardianIssue) {
  const ed = useEditor.getState();
  const p = ed.project;
  if (!p || !issue.fix) return;
  focusIssue(issue);
  const id = issue.elementId;
  const found = id ? findElement(p, id) : null;
  switch (issue.fix) {
    case 'zoom-out':
      if (!found || found.el.type !== 'photo' || !found.el.fill) return;
      ed.updateElement(found.el.id, (el) => {
        if (el.type !== 'photo' || !el.fill) return;
        const box = photoContentBox(el);
        el.fill.crop = clampCrop(box.w, box.h, el.fill.width, el.fill.height, { ...el.fill.crop, zoom: 1, mode: 'manual' });
      }, null);
      useUi.getState().toast('Zoomed all the way out — if it’s still soft, make the frame smaller or use a larger original.', 'info');
      return;
    case 'replace-photo':
    case 'fill-slot':
      if (id) useUi.setState({ picker: { elementId: id, multiple: false } });
      return;
    case 'edit-text':
      if (id) useUi.setState({ editingTextId: id });
      return;
    case 'move-inside':
      if (id) moveInsideSafe(id);
      return;
    case 'smart-crop':
      if (id) smartCrop(id);
      return;
    case 'readability':
      if (found && found.el.type === 'text') void makeReadable(found.el.id);
      return;
    case 'change-font':
      if (found && found.el.type === 'text' && found.el.fontFamily) ed.updateElement(found.el.id, { fontFamily: undefined }, null);
      else useUi.getState().set({ mode: 'studio', tab: 'style' });
      return;
    case 'fit-text':
      if (id) ed.updateElement(id, { autoFit: true }, null);
      return;
    case 'soften-background':
      ed.updateSurface(issue.surfaceId, (s) => void (s.background.soften = true));
      return;
  }
}

/**
 * Fix low contrast by changing what actually decides it. Over a photo: the theme's
 * "text on photo" colour plus a soft shadow. Anywhere else (a solid panel, the card
 * background): the text's own colour, lightened or darkened just enough to pass.
 */
async function makeReadable(id: string) {
  const ed = useEditor.getState();
  const p = ed.project;
  const found = p ? findElement(p, id) : null;
  if (!p || !found || found.el.type !== 'text') return;
  const { el, surface } = found;
  const toast = useUi.getState().toast;
  if (el.fill === 'foil') {
    ed.updateElement(id, { shadow: true }, null);
    toast('Added a soft shadow. Foil stays metallic, so if it’s still hard to read, switch this text to ink colour.', 'info');
    return;
  }
  const target = (isLargeText(el) ? 3 : 4.5) + 0.1;
  const ink = useUi.getState().textInk[id] ?? { x: el.x, y: el.y, w: el.w, h: el.h };
  const packs = useAssets.getState().packs;
  const overPhoto = surface.elements.some(
    (o) => o.type === 'photo' && o.fill && o.x < el.x + el.w && o.x + o.w > el.x && o.y < el.y + el.h && o.y + o.h > el.y,
  );
  const base: TextElement = { ...el, shadow: overPhoto ? true : el.shadow };
  const apply = (color: string) =>
    ed.updateElement(id, (e) => {
      if (e.type !== 'text') return;
      e.color = color;
      if (overPhoto) e.shadow = true;
    }, null);

  if (overPhoto) {
    const r = await measureContrast(p, surface, { ...base, color: '@onPhoto' }, ink, packs).catch(() => undefined);
    if (r !== undefined && r >= target) {
      apply('@onPhoto');
      toast(`Switched to the theme’s text-on-photo colour with a soft shadow (${r.toFixed(1)}:1).`, 'info');
      return;
    }
  }
  const pick = await findReadableColor(p, surface, base, ink, packs, target).catch(() => null);
  if (!pick) {
    toast('Couldn’t measure what’s behind this text. Pick a lighter or darker colour in the panel on the right.', 'error');
    return;
  }
  apply(pick.color);
  toast(
    pick.ratio >= target
      ? `Adjusted the colour so it reads clearly (${pick.ratio.toFixed(1)}:1).`
      : `Made it as readable as this colour allows (${pick.ratio.toFixed(1)}:1). A shade behind the text would help more.`,
    'info',
  );
}

/** Print Guardian: traffic-light pre-flight with one-click fixes. */
export function GuardianPanel({ report }: { report: GuardianReport | null }) {
  if (!report) return null;
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warns = report.issues.filter((i) => i.severity === 'warn').length;
  return (
    <>
      <Section>
        <div className="flex items-center gap-3">
          <TrafficLight status={report.status} />
          <div>
            <div className="font-display text-lg leading-tight">
              {report.status === 'green' ? 'Ready to print' : report.status === 'yellow' ? 'Printable, with notes' : 'Fix before printing'}
            </div>
            <div className="text-xs text-ink-3">
              {errors ? `${errors} problem${errors > 1 ? 's' : ''}` : 'No problems'}
              {warns ? ` · ${warns} warning${warns > 1 ? 's' : ''}` : ''}
            </div>
          </div>
        </div>
      </Section>
      {report.issues.length > 0 && (
        <Section title="To check">
          <div className="space-y-1.5">
            {report.issues.map((issue) => (
              <div key={issue.id} className={clsx('rounded-lg border px-2.5 py-2', issue.severity === 'error' ? 'border-bad/30 bg-bad-soft/60' : issue.severity === 'warn' ? 'border-warn/30 bg-warn-soft/60' : 'border-line bg-white')}>
                <button className="flex w-full items-start gap-2 text-left" onClick={() => focusIssue(issue)}>
                  <span className="mt-0.5">
                    <SeverityIcon s={issue.severity} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug">{issue.title}</span>
                    <span className="block text-xs text-ink-2">{issue.detail}</span>
                    <span className="block text-[11px] text-ink-3">{SURFACE_INFO[issue.surfaceId].label}</span>
                  </span>
                </button>
                {issue.fix && (
                  <div className="mt-1.5 flex justify-end">
                    <button className="btn btn-sm" onClick={() => applyFix(issue)}>
                      {FIX_LABEL[issue.fix]}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title="Checks">
        <div className="space-y-1">
          {report.checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 py-0.5" title={c.description}>
              <span className="mt-0.5">
                <SeverityIcon s={c.status} size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{c.label}</span>
                <span className="block text-[11px] text-ink-3">{c.description}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
      {report.photos.length > 0 && (
        <Section title="Photo resolution">
          <div className="space-y-1">
            {report.photos.map((ph) => (
              <button
                key={ph.elementId}
                className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-white"
                onClick={() => focusIssue({ id: ph.elementId, check: 'resolution', severity: 'info', surfaceId: ph.surfaceId, elementId: ph.elementId, title: '', detail: '' })}
              >
                <SeverityIcon s={ph.severity} size={13} />
                <span className="flex-1 text-ink-2">
                  {SURFACE_INFO[ph.surfaceId].label} · {ph.printWidthIn.toFixed(1)}×{ph.printHeightIn.toFixed(1)}"
                </span>
                <span className={clsx('font-semibold tabular-nums', statusColor(ph.severity))}>{Math.round(ph.dpi)} DPI</span>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section>
        <p className="flex gap-2 text-xs text-ink-3">
          <ShieldCheck size={14} className="shrink-0" /> Keep text and faces inside the dashed safe line; anything past the solid trim line may be cut off.
        </p>
      </Section>
    </>
  );
}

export function TrafficLight({ status, small }: { status: GuardianReport['status']; small?: boolean }) {
  const d = small ? 'h-2 w-2' : 'h-3 w-3';
  return (
    <div className={clsx('flex shrink-0 flex-col items-center rounded-full bg-ink', small ? 'gap-0.5 px-1 py-1' : 'gap-1 px-1.5 py-1.5')}>
      <span className={clsx('rounded-full', d, status === 'red' ? 'bg-[#ff5b4a] shadow-[0_0_6px_#ff5b4a]' : 'bg-white/15')} />
      <span className={clsx('rounded-full', d, status === 'yellow' ? 'bg-[#ffc531] shadow-[0_0_6px_#ffc531]' : 'bg-white/15')} />
      <span className={clsx('rounded-full', d, status === 'green' ? 'bg-[#3ddc84] shadow-[0_0_6px_#3ddc84]' : 'bg-white/15')} />
    </div>
  );
}
