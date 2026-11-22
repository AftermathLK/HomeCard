import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { useUi } from '@/store/ui';

const modalStack: object[] = [];

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-3xl',
  bodyClass,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  bodyClass?: string;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Escape closes only the topmost dialog (dialogs can open on top of Settings).
    const token = {};
    modalStack.push(token);
    const h = (e: KeyboardEvent) => e.key === 'Escape' && modalStack[modalStack.length - 1] === token && closeRef.current();
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      modalStack.splice(modalStack.indexOf(token), 1);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4 backdrop-blur-[2px] fade-in" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clsx('flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-paper shadow-pop', width)} role="dialog" aria-modal>
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-auto', bodyClass ?? 'p-5')}>{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-white/60 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format,
  centered,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  centered?: boolean;
  onReset?: () => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="py-1">
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="font-medium text-ink-2">{label}</span>
        <button className="tabular-nums text-ink-3 hover:text-ink" onDoubleClick={onReset} title={onReset ? 'Double-click to reset' : undefined}>
          {format ? format(value) : value.toFixed(2)}
        </button>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
        style={{
          ['--fill' as any]: `${pct}%`,
          ...(centered
            ? {
                background: 'transparent',
              }
            : {}),
        }}
      />
    </div>
  );
}

export function Section({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={clsx('border-b border-line px-4 py-3.5 last:border-b-0', className)}>
      {(title || actions) && (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h3 className="panel-title">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size }: { value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div className={clsx('seg', size === 'sm' && 'text-[11px]')}>
      {options.map((o) => (
        <button key={o.value} type="button" data-on={o.value === value} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatch({ color, active, onClick, title, size = 26 }: { color: string; active?: boolean; onClick?: () => void; title?: string; size?: number }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={clsx('shrink-0 rounded-full border transition', active ? 'ring-2 ring-brand ring-offset-2' : 'hover:scale-110')}
      style={{ width: size, height: size, background: color, borderColor: 'rgba(0,0,0,.15)' }}
    />
  );
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="flex items-center gap-2">
      <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-line" style={{ background: value }}>
        <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </span>
      {label && <span className="w-20 shrink-0 text-xs text-ink-2">{label}</span>}
      <input
        className="input py-1 font-mono text-xs"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
        }}
      />
    </label>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={clsx('spin text-ink-3', className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="font-medium text-ink-2">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'pointer-events-auto flex max-w-lg items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] shadow-pop fade-in',
            t.kind === 'error' ? 'bg-bad text-white' : t.kind === 'ok' ? 'bg-brand text-white' : 'bg-ink text-white',
          )}
        >
          {t.kind === 'error' ? <AlertTriangle size={16} /> : t.kind === 'ok' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Dropzone({ onFiles, accept, children, className }: { onFiles: (files: File[]) => void; accept?: string; children: ReactNode; className?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={clsx('cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition', over ? 'border-brand bg-brand-soft' : 'border-line-2 bg-white/60 hover:border-brand/60', className)}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
      {children}
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx('h-1.5 overflow-hidden rounded-full bg-paper-3', className)}>
      <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand' : 'bg-line-2')}
      >
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      <span className="text-[13px] leading-snug text-ink-2">
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}
