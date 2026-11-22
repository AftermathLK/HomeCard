import { useState } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff, GripVertical, Image, Lock, Shapes, Sparkles, Sticker, Sun, Type, Unlock } from 'lucide-react';
import { getBuiltinOrnament, resolveTokens, type CardElement, type CardProject } from '@homecard/shared';
import { Section } from '@/components/ui';
import { moveElementTo } from '@/lib/actions';
import { useEditor, useProject } from '@/store/editor';

const ICON: Record<CardElement['type'], React.ReactNode> = {
  photo: <Image size={14} />,
  text: <Type size={14} />,
  ornament: <Sparkles size={14} />,
  sticker: <Sticker size={14} />,
  shape: <Shapes size={14} />,
  scrim: <Sun size={14} />,
};

export function elementLabel(el: CardElement, project: CardProject): string {
  if (el.name) return el.name;
  switch (el.type) {
    case 'text': {
      const t = resolveTokens(el.text, project).replace(/\s+/g, ' ').trim();
      return t ? (t.length > 34 ? `${t.slice(0, 32)}…` : t) : 'Empty text';
    }
    case 'photo':
      return el.fill ? `Photo ${el.slot + 1}` : `Empty photo frame ${el.slot + 1}`;
    case 'ornament':
      return el.asset.startsWith('builtin:') ? getBuiltinOrnament(el.asset.slice(8))?.name ?? 'Ornament' : el.asset.split('/').pop()!.replace(/\.\w+$/, '');
    case 'sticker':
      return el.asset.split('/').pop()!.replace(/\.\w+$/, '');
    case 'shape':
      return el.shape === 'line' ? 'Line' : el.shape === 'ellipse' ? 'Circle' : 'Panel';
    case 'scrim':
      return 'Shade';
  }
}

/** Layer list for the current side, top-most first. Drag to restack. */
export function LayersPanel() {
  const project = useProject();
  const surfaceId = useEditor((s) => s.surfaceId);
  const selection = useEditor((s) => s.selection);
  const [drag, setDrag] = useState<{ id: string; over: number | null } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!project) return null;
  const ed = useEditor.getState();
  const surface = project.surfaces.find((s) => s.id === surfaceId)!;
  const n = surface.elements.length;
  const rows = surface.elements.map((el, index) => ({ el, index })).reverse();

  return (
    <Section title={`Layers · ${n}`}>
      <div className="space-y-0.5" onDragLeave={() => setDrag((d) => (d ? { ...d, over: null } : d))}>
        {rows.map(({ el, index }) => {
          const sel = selection.includes(el.id);
          return (
            <div
              key={el.id}
              draggable={renaming !== el.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', el.id);
                setDrag({ id: el.id, over: null });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                setDrag({ ...drag, over: index });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag.id !== el.id) moveElementTo(drag.id, index);
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={(e) => {
                if (e.shiftKey || e.ctrlKey || e.metaKey) ed.select(sel ? selection.filter((x) => x !== el.id) : [...selection, el.id]);
                else ed.select(el.id);
              }}
              className={clsx(
                'group flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[13px] transition',
                sel ? 'bg-brand-soft text-ink' : 'hover:bg-white',
                drag?.over === index && drag.id !== el.id && 'ring-2 ring-brand',
                el.hidden && 'opacity-50',
              )}
            >
              <GripVertical size={13} className="shrink-0 cursor-grab text-ink-3 opacity-0 group-hover:opacity-100" />
              <span className="shrink-0 text-ink-3">{ICON[el.type]}</span>
              {renaming === el.id ? (
                <input
                  autoFocus
                  className="input py-0.5 text-[13px]"
                  defaultValue={el.name ?? elementLabel(el, project)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    ed.updateElement(el.id, { name: e.target.value.trim() || undefined }, null);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setRenaming(el.id)} title="Double-click to rename">
                  {elementLabel(el, project)}
                </span>
              )}
              {el.managed && <span className="shrink-0 rounded bg-paper-3 px-1 text-[10px] text-ink-3" title="Part of the layout — re-arranged when you switch layouts">layout</span>}
              <button
                className={clsx('icon-btn !h-6 !w-6', !el.locked && 'opacity-0 group-hover:opacity-100')}
                title={el.locked ? 'Unlock' : 'Lock'}
                onClick={(e) => {
                  e.stopPropagation();
                  ed.updateElement(el.id, { locked: !el.locked }, null);
                }}
              >
                {el.locked ? <Lock size={13} /> : <Unlock size={13} />}
              </button>
              <button
                className={clsx('icon-btn !h-6 !w-6', !el.hidden && 'opacity-0 group-hover:opacity-100')}
                title={el.hidden ? 'Show' : 'Hide'}
                onClick={(e) => {
                  e.stopPropagation();
                  ed.updateElement(el.id, { hidden: !el.hidden }, null);
                }}
              >
                {el.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-ink-3">Drag to change stacking order. Hidden layers are not printed.</p>
    </Section>
  );
}
