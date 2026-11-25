import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Copy, Gift, MoreHorizontal, Plus, Send, Trash2 } from 'lucide-react';
import {
  createProject,
  DEFAULT_SIZE_ID,
  getOccasion,
  makeFormat,
  PLACEHOLDER_FAMILY,
  type CardProject,
  type GreetingStyle,
  type ProjectSummary,
  type UserDirectoryEntry,
} from '@homecard/shared';
import { OccasionGlyph } from '@/components/MiniCard';
import { UserMenu } from '@/components/UserMenu';
import { Empty, Modal, Spinner } from '@/components/ui';
import { api, enc, onServerEvent } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { defaultCardSize, useMeasure } from '@/lib/units';
import { FormatFields, GreetingStylePicker, OccasionGrid, type FormatChoice } from '@/setup/CardSetup';
import { useEditor } from '@/store/editor';
import { useHolidays } from '@/store/holidays';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';
import { featuredHolidayId, UpcomingHero } from './UpcomingHero';

type Summary = ProjectSummary & { hasThumb: boolean };

export function ProjectsHome() {
  const [list, setList] = useState<Summary[] | null>(null);
  const [thumbTick, setThumbTick] = useState<Record<string, number>>({});
  const health = useAssets((s) => s.health);
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const ui = useUi();

  const load = () => api.get<Summary[]>('/api/projects').then(setList, (e) => ui.toast(e.message, 'error'));
  useEffect(() => {
    void load();
    return onServerEvent((type, data) => {
      if (type === 'projects') void load();
      if (type === 'project-thumb') setThumbTick((t) => ({ ...t, [data.id]: data.at ?? Date.now() }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (id: string) => ui.go({ name: 'editor', projectId: id });

  return (
    <div className="h-full overflow-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-paper/95 px-8 py-4 backdrop-blur">
        <div>
          <h1 className="font-display text-[26px] leading-none text-brand">HomeCard</h1>
          <p className="mt-1 text-[13px] text-ink-3">Print-ready holiday & occasion cards from your own photos</p>
        </div>
        <div className="flex-1" />
        <button className="btn btn-primary btn-lg" onClick={() => ui.set({ newCardOpen: true })}>
          <Plus size={17} /> New card
        </button>
        <UserMenu />
      </header>
      <div className="mx-auto max-w-7xl px-8 py-6">
        <UpcomingHero />
        {health && (!health.renderer.available || !health.immich.linked) && (
          <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-white px-4 py-3 text-[13px]">
            {!health.renderer.available && (
              <span className="flex items-center gap-1.5 text-bad">
                <AlertTriangle size={14} /> Print renderer unavailable: {health.renderer.detail}
              </span>
            )}
            {!health.immich.linked && health.immich.serverConfigured && (
              <span className="text-ink-2">
                Your household has an Immich server.{' '}
                <button className="font-medium text-brand hover:underline" onClick={() => ui.openSettings('immich')}>
                  Link your own Immich account
                </button>{' '}
                (read-only) to browse your albums, people and favorites.
              </span>
            )}
            {!health.immich.serverConfigured && isAdmin && (
              <span className="text-ink-2">
                Have an Immich server?{' '}
                <button className="font-medium text-brand hover:underline" onClick={() => ui.openSettings('server')}>
                  Set its address in Server settings
                </button>
                , then each person links their own read-only key.
              </span>
            )}
            {!health.immich.serverConfigured && !isAdmin && (
              <span className="text-ink-3">Photos from Immich appear here once your admin sets up the Immich server address.</span>
            )}
          </div>
        )}
        {list === null ? (
          <div className="flex justify-center py-20">
            <Spinner size={28} />
          </div>
        ) : !list.length ? (
          <Empty icon={<OccasionGlyph occasionId="christmas" size={56} className="text-accent" />} title="Make your first card">
            Pick an occasion, add a few photos and HomeCard lays out a print-ready card in seconds.
            <div className="mt-4">
              <button className="btn btn-primary btn-lg" onClick={() => ui.set({ newCardOpen: true })}>
                <Plus size={17} /> New card
              </button>
            </div>
          </Empty>
        ) : (
          <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            <button
              onClick={() => ui.set({ newCardOpen: true })}
              className="flex aspect-[5/7] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-2 text-ink-3 transition hover:border-brand hover:text-brand"
            >
              <Plus size={30} />
              <span className="font-medium">New card</span>
            </button>
            {list.map((p) => (
              <ProjectTile key={p.id} p={p} tick={thumbTick[p.id]} onOpen={() => open(p.id)} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectTile({ p, tick, onOpen, onChanged }: { p: Summary; tick?: number; onOpen: () => void; onChanged: () => void }) {
  const [menu, setMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [broken, setBroken] = useState(!p.hasThumb);
  useEffect(() => setBroken(!p.hasThumb && !tick), [p.hasThumb, tick]);
  const occ = getOccasion(p.occasionId);
  const { dims } = useMeasure();
  const pal = occ.palettes[0].colors;
  const aspect = p.format.widthIn / p.format.heightIn;
  return (
    <div className="group relative">
      <button onClick={onOpen} className="flex aspect-[5/7] w-full items-center justify-center rounded-xl bg-paper-2 p-3 transition group-hover:bg-paper-3">
        {broken ? (
          <div className="flex items-center justify-center shadow-card" style={{ aspectRatio: aspect, width: aspect >= 1 ? '100%' : undefined, height: aspect < 1 ? '100%' : undefined, background: pal.background, color: pal.accent, ['--hc-orn2' as any]: pal.accent2 }}>
            <OccasionGlyph occasionId={p.occasionId} size={48} />
          </div>
        ) : (
          <img
            src={`/api/projects/${enc(p.id)}/thumbnail?t=${tick ?? p.updatedAt}`}
            alt=""
            onError={() => setBroken(true)}
            className="max-h-full max-w-full object-contain shadow-card"
          />
        )}
      </button>
      <div className="mt-2 flex items-start gap-1">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[14px] font-medium">{p.name}</div>
          {p.sharedFrom && (
            <div className="flex items-center gap-1 truncate text-xs text-accent" title={`Copy shared by ${p.sharedFrom.displayName} on ${new Date(p.sharedFrom.at).toLocaleString()}`}>
              <Gift size={12} /> From {p.sharedFrom.displayName}
            </div>
          )}
          <div className="truncate text-xs text-ink-3">
            {occ.name} · {dims(p.format.widthIn, p.format.heightIn)} {p.format.fold} · {new Date(p.updatedAt).toLocaleDateString()}
          </div>
        </button>
        <div className="relative">
          <button className="icon-btn" onClick={() => setMenu((v) => !v)} onBlur={() => setTimeout(() => setMenu(false), 150)}>
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <div className="absolute right-0 top-9 z-20 w-60 rounded-xl border border-line bg-white p-1 shadow-pop">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-paper-2"
                onClick={async () => {
                  await api.post(`/api/projects/${enc(p.id)}/duplicate`, {});
                  onChanged();
                }}
              >
                <Copy size={14} /> Duplicate
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-paper-2" onClick={() => setSharing(true)}>
                <Send size={14} /> Share copy with another user…
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-bad hover:bg-bad-soft"
                onClick={async () => {
                  if (!confirm(`Delete “${p.name}”? It is moved to the trash folder in /data/projects and removed for good after 30 days.`)) return;
                  await api.del(`/api/projects/${enc(p.id)}`);
                  onChanged();
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
      {sharing && <ShareCopyModal p={p} onClose={() => setSharing(false)} />}
    </div>
  );
}

/**
 * "Share copy with another user": the recipient gets their own copy of the card with every
 * placed photo flattened into it. Nothing of the sender's Immich library or folders is shared.
 */
function ShareCopyModal({ p, onClose }: { p: Summary; onClose: () => void }) {
  const [people, setPeople] = useState<UserDirectoryEntry[] | null>(null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<UserDirectoryEntry[]>('/api/users/directory').then(
      (l) => {
        setPeople(l);
        if (l.length === 1) setTo(l[0].id);
      },
      (e) => setError(e.message),
    );
  }, []);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ ok: true; recipient: string; photos: number; skipped: number }>(`/api/projects/${enc(p.id)}/share`, { recipientId: to });
      useUi.getState().toast(`Sent a copy of “${p.name}” to ${r.recipient}${r.skipped ? ` (${r.skipped} photo${r.skipped === 1 ? '' : 's'} couldn’t be copied)` : ''}.`, r.skipped ? 'info' : 'ok');
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-md"
      title="Share a copy"
      subtitle={`Send “${p.name}” to someone else in your household.`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!to || busy} onClick={send}>
            {busy ? <Spinner className="text-white" /> : <Send size={14} />} Send copy
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {people === null && !error ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : people && !people.length ? (
          <p className="text-[13px] text-ink-2">There’s nobody else to share with yet. An admin can add household members under Users.</p>
        ) : (
          people && (
            <div className="space-y-1.5">
              <div className="label">Send to</div>
              {people.map((u) => (
                <label key={u.id} className={clsx('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2', to === u.id ? 'border-brand bg-brand-soft' : 'border-line hover:bg-paper-2')}>
                  <input type="radio" name="share-to" checked={to === u.id} onChange={() => setTo(u.id)} />
                  <span className="text-[13px] font-medium">{u.displayName}</span>
                  <span className="text-[12px] text-ink-3">@{u.username}</span>
                </label>
              ))}
            </div>
          )
        )}
        <div className="rounded-lg bg-paper-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
          They get their own editable copy, with the photos you placed copied in at print resolution. They can’t see your Immich library, your other photos or your
          other cards, and later changes on either side stay separate.
        </div>
        {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</div>}
      </div>
    </Modal>
  );
}

/* ---------------- New card wizard ---------------- */

export function NewCardModal() {
  const open = useUi((s) => s.newCardOpen);
  const hidden = useHolidays((s) => s.prefs.hiddenOccasions);
  const [step, setStep] = useState<1 | 2>(1);
  const [occasionId, setOccasionId] = useState('christmas');
  const [style, setStyle] = useState<GreetingStyle>('warm');
  const [family, setFamily] = useState('');
  const [fmt, setFmt] = useState<FormatChoice>(() => {
    const f = makeFormat({ sizeId: DEFAULT_SIZE_ID });
    return { sizeId: f.sizeId, orientation: 'portrait', fold: 'flat', includeBack: true, vendorId: f.vendorId, customW: 5, customH: 7 };
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    // From the home page's "Plan a … card": that occasion, straight to the details step.
    // Otherwise start on the holiday the home page features.
    const preset = useUi.getState().newCardOccasionId;
    if (preset) {
      setOccasionId(preset);
      setStep(2);
      useUi.setState({ newCardOccasionId: null });
    } else {
      setStep(1);
      const featured = featuredHolidayId();
      if (featured) setOccasionId(featured);
    }
    // Each new card starts at the person's first starred size and their default printer.
    const size = defaultCardSize();
    const vendor = useSession.getState().user?.prefs.defaultVendorId;
    setFmt((f) => ({ ...f, sizeId: size.sizeId, orientation: 'portrait', customW: size.customW ?? f.customW, customH: size.customH ?? f.customH, vendorId: vendor || f.vendorId }));
  }, [open]);
  if (!open) return null;
  const close = () => useUi.setState({ newCardOpen: false, newCardOccasionId: null });
  const occ = getOccasion(occasionId);

  const create = async () => {
    setBusy(true);
    try {
      const p = createProject({ occasionId, greetingStyle: style, familyName: family, ...fmt });
      const saved = await api.post<CardProject>('/api/projects', p);
      useEditor.getState().openProject(saved);
      useUi.getState().set({ newCardOpen: false, mode: useUi.getState().mode, step: 2, subTab: 'photos' });
      useUi.getState().go({ name: 'editor', projectId: saved.id });
      useUi.setState({ picker: { elementId: null, multiple: true } });
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      width="max-w-4xl"
      title={step === 1 ? 'What are you celebrating?' : `Your ${occ.name} card`}
      subtitle={step === 1 ? 'Every occasion comes with curated greetings, colours, fonts and ornaments.' : 'You can change all of this later.'}
      footer={
        <>
          {step === 2 && (
            <button className="btn mr-auto" onClick={() => setStep(1)}>
              Back
            </button>
          )}
          <button className="btn" onClick={close}>
            Cancel
          </button>
          {step === 1 ? (
            <button className="btn btn-primary" onClick={() => setStep(2)}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={create}>
              {busy ? <Spinner className="text-white" /> : <Plus size={15} />} Create card & add photos
            </button>
          )}
        </>
      }
    >
      {step === 1 ? (
        <OccasionGrid value={occasionId} onChange={(id) => setOccasionId(id)} columns={4} hidden={hidden} onUnhide={(id) => void useHolidays.getState().unhide(id)} />
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="label">Who is it from?</div>
              <input className="input" placeholder={PLACEHOLDER_FAMILY} value={family} onChange={(e) => setFamily(e.target.value)} autoFocus />
              <p className="mt-1 text-[11px] text-ink-3">Fills in wherever the card says {'{{family}}'}.</p>
            </div>
            <div>
              <div className="label">Greeting style</div>
              <GreetingStylePicker value={style} onChange={setStyle} />
            </div>
            <div className={clsx('rounded-xl p-4')} style={{ background: occ.palettes[0].colors.background, color: occ.palettes[0].colors.text }}>
              <div className="font-display text-2xl">{(occ.greetings[style]?.[0] ?? occ.greetings.warm[0]).headline}</div>
              {(occ.greetings[style]?.[0] ?? occ.greetings.warm[0]).message && <div className="mt-1 text-[13px] opacity-80">{(occ.greetings[style]?.[0] ?? occ.greetings.warm[0]).message}</div>}
            </div>
          </div>
          <FormatFields value={fmt} onChange={setFmt} />
        </div>
      )}
    </Modal>
  );
}
