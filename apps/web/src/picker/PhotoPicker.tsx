import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { CalendarDays, Check, ChevronLeft, Folder, Heart, Images, Search, Settings2, Sparkles, Upload, Users } from 'lucide-react';
import type { ImmichAlbum, ImmichPerson, ImmichStatus, LibraryListing, PhotoItem, PhotoPage, TimelineBucket } from '@homecard/shared';
import { Dropzone, Empty, Modal, Spinner } from '@/components/ui';
import { addPhotosAndFill, addToTray, placeIntoFrame, resolvePhotos } from '@/lib/actions';
import { api, enc, onServerEvent, upload } from '@/lib/api';
import { thumbUrl } from '@/lib/image';
import { useEditor } from '@/store/editor';
import { useUi } from '@/store/ui';

type Source = 'immich' | 'library' | 'upload';
type ImmichView =
  | { kind: 'home' }
  | { kind: 'album'; album: ImmichAlbum }
  | { kind: 'person'; person: ImmichPerson }
  | { kind: 'favorites' }
  | { kind: 'year'; year: string }
  | { kind: 'search'; query: string };

export function PhotoPicker() {
  const picker = useUi((s) => s.picker);
  const close = useCallback(() => useUi.setState({ picker: null }), []);
  const [source, setSource] = useState<Source>('immich');
  const [immich, setImmich] = useState<ImmichStatus | null>(null);
  const [selected, setSelected] = useState<Map<string, PhotoItem>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!picker) return;
    setSelected(new Map());
    api
      .get<ImmichStatus>('/api/immich/status')
      .then((s) => {
        setImmich(s);
        if (!s.configured) setSource((cur) => (cur === 'immich' ? 'library' : cur));
      })
      .catch(() => setImmich({ ok: false, configured: false }));
  }, [picker]);

  const multiple = picker?.multiple ?? true;
  const toggle = (item: PhotoItem) => {
    setSelected((prev) => {
      const next = new Map(multiple ? prev : []);
      if (prev.has(item.ref)) next.delete(item.ref);
      else next.set(item.ref, item);
      return next;
    });
  };

  const confirm = async (items: PhotoItem[] = [...selected.values()]) => {
    if (!items.length || !picker) return;
    setBusy(true);
    try {
      const recs = await resolvePhotos(items);
      if (!recs.length) return;
      const ed = useEditor.getState();
      const plural = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;
      if (picker.elementId) {
        placeIntoFrame(ed.surfaceId, picker.elementId, recs[0]);
        addToTray(recs);
        useUi.getState().toast('Photo placed — framed around faces automatically.', 'ok');
      } else {
        const placed = addPhotosAndFill(recs);
        useUi
          .getState()
          .toast(
            placed
              ? `Added ${plural(recs.length)} — ${placed === recs.length ? 'all' : placed} placed in empty frames, framed around faces.`
              : `Added ${plural(recs.length)}. Click one, or drag it onto a frame, to use it.`,
            'ok',
          );
      }
      close();
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!picker) return null;
  return (
    <Modal
      open
      onClose={close}
      width="max-w-6xl"
      bodyClass="p-0"
      title={picker.elementId ? 'Choose a photo for this frame' : 'Add photos to your card'}
      subtitle="Thumbnails come from your library; the full-resolution original is fetched only when you export."
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-3">{selected.size ? `${selected.size} selected` : multiple ? 'Click photos to select several' : 'Click a photo to choose it'}</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!selected.size || busy} onClick={() => confirm()}>
            {busy ? <Spinner size={14} className="text-white" /> : <Check size={15} />}
            {picker.elementId ? 'Use photo' : `Add ${selected.size || ''} photo${selected.size === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="flex h-[70vh] min-h-[420px]">
        <nav className="w-48 shrink-0 space-y-1 border-r border-line bg-paper-2/60 p-3">
          <SourceBtn icon={<Images size={16} />} active={source === 'immich'} onClick={() => setSource('immich')} label="Immich" badge={immich?.configured ? (immich.ok ? 'connected' : 'error') : 'not set up'} />
          <SourceBtn icon={<Folder size={16} />} active={source === 'library'} onClick={() => setSource('library')} label="Photo folder" badge="/data/photos" />
          <SourceBtn icon={<Upload size={16} />} active={source === 'upload'} onClick={() => setSource('upload')} label="Upload" badge="from this device" />
        </nav>
        <div className="min-w-0 flex-1">
          {source === 'immich' && <ImmichBrowser status={immich} selected={selected} onToggle={toggle} onPick={(i) => !multiple && confirm([i])} />}
          {source === 'library' && <LibraryBrowser selected={selected} onToggle={toggle} onPick={(i) => !multiple && confirm([i])} />}
          {source === 'upload' && <UploadPane onUploaded={(items) => (multiple ? setSelected(new Map(items.map((i) => [i.ref, i]))) : confirm(items.slice(0, 1)))} />}
        </div>
      </div>
    </Modal>
  );
}

function SourceBtn({ icon, label, badge, active, onClick }: { icon: React.ReactNode; label: string; badge: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={clsx('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition', active ? 'bg-white shadow-sm' : 'hover:bg-white/60')}>
      <span className={clsx('mt-0.5', active ? 'text-brand' : 'text-ink-3')}>{icon}</span>
      <span>
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11px] text-ink-3">{badge}</span>
      </span>
    </button>
  );
}

/* ---------------- Grid ---------------- */

function PhotoGrid({
  items,
  selected,
  onToggle,
  onPick,
  loading,
  onMore,
  hasMore,
}: {
  items: PhotoItem[];
  selected: Map<string, PhotoItem>;
  onToggle: (i: PhotoItem) => void;
  onPick?: (i: PhotoItem) => void;
  loading?: boolean;
  onMore?: () => void;
  hasMore?: boolean;
}) {
  return (
    <div
      className="grid gap-1.5 p-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
      onScroll={undefined}
    >
      {items.map((it) => {
        const on = selected.has(it.ref);
        return (
          <button
            key={it.ref}
            onClick={() => onToggle(it)}
            onDoubleClick={() => onPick?.(it)}
            className={clsx('group relative aspect-square overflow-hidden rounded-lg bg-paper-3 transition', on ? 'ring-[3px] ring-brand' : 'hover:brightness-95')}
            title={it.name}
          >
            <img src={it.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            {it.favorite && <Heart size={13} className="absolute bottom-1.5 left-1.5 fill-white text-white drop-shadow" />}
            <span className={clsx('absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition', on ? 'border-brand bg-brand text-white' : 'border-white/90 bg-black/10 opacity-0 group-hover:opacity-100')}>
              {on && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        );
      })}
      {(loading || hasMore) && (
        <div className="col-span-full flex justify-center py-4">
          {loading ? (
            <Spinner />
          ) : (
            <button className="btn btn-sm" onClick={onMore}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function usePaged(fetchPage: ((page: string | null) => Promise<PhotoPage>) | null, deps: unknown[]) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (page: string | null, reset: boolean) => {
      if (!fetchPage) return;
      setLoading(true);
      setError(null);
      try {
        const r = await fetchPage(page);
        setItems((prev) => (reset ? r.items : [...prev, ...r.items]));
        setNext(r.nextPage);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => {
    setItems([]);
    setNext(null);
    void load(null, true);
  }, [load]);
  return { items, loading, error, hasMore: !!next, more: () => next && load(next, false), reload: () => load(null, true) };
}

/* ---------------- Immich ---------------- */

function ImmichBrowser({ status, selected, onToggle, onPick }: { status: ImmichStatus | null; selected: Map<string, PhotoItem>; onToggle: (i: PhotoItem) => void; onPick: (i: PhotoItem) => void }) {
  const [view, setView] = useState<ImmichView>({ kind: 'home' });
  const [q, setQ] = useState('');
  const [albums, setAlbums] = useState<ImmichAlbum[] | null>(null);
  const [people, setPeople] = useState<ImmichPerson[] | null>(null);
  const [years, setYears] = useState<TimelineBucket[] | null>(null);
  const [tab, setTab] = useState<'albums' | 'people' | 'years'>('albums');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!status?.ok) return;
    api.get<ImmichAlbum[]>('/api/immich/albums').then(setAlbums, (e) => setErr(e.message));
    api.get<ImmichPerson[]>('/api/immich/people').then(setPeople, () => setPeople([]));
    api.get<TimelineBucket[]>('/api/immich/timeline').then(setYears, () => setYears([]));
  }, [status?.ok]);

  const fetcher = useMemo(() => {
    switch (view.kind) {
      case 'album':
        return (p: string | null) => api.get<PhotoPage>(`/api/immich/albums/${view.album.id}/assets?page=${p ?? 1}`);
      case 'person':
        return (p: string | null) => api.get<PhotoPage>(`/api/immich/assets?filter=${enc(`person:${view.person.id}`)}&page=${p ?? 1}`);
      case 'favorites':
        return (p: string | null) => api.get<PhotoPage>(`/api/immich/assets?filter=favorites&page=${p ?? 1}`);
      case 'year':
        return (p: string | null) => api.get<PhotoPage>(`/api/immich/assets?filter=${enc(`year:${view.year}`)}&page=${p ?? 1}`);
      case 'search':
        return (p: string | null) => api.post<PhotoPage>('/api/immich/search', { query: view.query, page: Number(p ?? 1) });
      default:
        return null;
    }
  }, [view]);
  const paged = usePaged(fetcher, [fetcher]);

  if (!status) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!status.configured || !status.ok)
    return (
      <Empty icon={<Images size={36} />} title={status.configured ? 'Can’t reach Immich' : status.url ? 'Link your Immich account' : 'Immich isn’t set up yet'}>
        {status.configured
          ? status.error
          : status.url
            ? 'Link your own Immich account with a read-only API key. Only you can see your library here, and HomeCard can never change or delete anything in it.'
            : (status.error ?? 'An admin needs to add the Immich server address first.')}
        {(status.configured || status.url) && (
          <div className="mt-3">
            <button className="btn btn-primary" onClick={() => useUi.getState().openSettings('immich')}>
              <Settings2 size={15} /> {status.configured ? 'Check Immich connection' : 'Link Immich (read-only)'}
            </button>
          </div>
        )}
      </Empty>
    );

  const header = (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-paper/95 px-3 py-2 backdrop-blur">
      {view.kind !== 'home' && (
        <button className="btn btn-ghost btn-sm" onClick={() => setView({ kind: 'home' })}>
          <ChevronLeft size={15} /> Back
        </button>
      )}
      <form
        className="relative flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) setView({ kind: 'search', query: q.trim() });
        }}
      >
        <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Smart search: “kids in the snow”, “beach sunset”, “dog”…" />
      </form>
      <button className={clsx('chip', view.kind === 'favorites' && 'chip-on')} onClick={() => setView({ kind: 'favorites' })}>
        <Heart size={13} /> Favorites
      </button>
    </div>
  );

  if (view.kind !== 'home') {
    const title =
      view.kind === 'album' ? view.album.name : view.kind === 'person' ? view.person.name || 'Unnamed person' : view.kind === 'favorites' ? 'Favorites' : view.kind === 'year' ? view.year : `“${view.query}”`;
    return (
      <div className="h-full overflow-auto">
        {header}
        <div className="px-4 pt-3 font-display text-lg">{title}</div>
        {paged.error && <div className="m-3 rounded-lg bg-bad-soft p-3 text-[13px] text-bad">{paged.error}</div>}
        {!paged.loading && !paged.items.length && !paged.error && <Empty title="No photos here" />}
        <PhotoGrid items={paged.items} selected={selected} onToggle={onToggle} onPick={onPick} loading={paged.loading} hasMore={paged.hasMore} onMore={paged.more} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      {header}
      <div className="flex gap-1 px-3 pt-3">
        {(
          [
            ['albums', 'Albums', <Images key="a" size={14} />],
            ['people', 'People', <Users key="p" size={14} />],
            ['years', 'Years', <CalendarDays key="y" size={14} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className={clsx('chip', tab === id && 'chip-on')} onClick={() => setTab(id)}>
            {icon} {label}
          </button>
        ))}
      </div>
      {err && <div className="m-3 rounded-lg bg-bad-soft p-3 text-[13px] text-bad">{err}</div>}
      {tab === 'albums' &&
        (albums === null ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : !albums.length ? (
          <Empty title="No albums yet" />
        ) : (
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {albums.map((a) => (
              <button key={a.id} className="card-tile overflow-hidden text-left" onClick={() => setView({ kind: 'album', album: a })}>
                <div className="aspect-[4/3] bg-paper-3">{a.thumbnailAssetId && <img src={thumbUrl(`immich:${a.thumbnailAssetId}`)} alt="" loading="lazy" className="h-full w-full object-cover" />}</div>
                <div className="px-2.5 py-2">
                  <div className="truncate text-[13px] font-medium">{a.name}</div>
                  <div className="text-[11px] text-ink-3">
                    {a.count} items{a.shared ? ' · shared' : ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ))}
      {tab === 'people' &&
        (people === null ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : !people.length ? (
          <Empty title="No people found">Immich’s face recognition groups people automatically once it has processed your library.</Empty>
        ) : (
          <div className="grid gap-3 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
            {people.map((p) => (
              <button key={p.id} className="flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-white" onClick={() => setView({ kind: 'person', person: p })}>
                <img src={p.thumbnailUrl} alt="" loading="lazy" className="h-20 w-20 rounded-full bg-paper-3 object-cover" />
                <span className="w-full truncate text-center text-xs">{p.name || 'Unnamed'}</span>
              </button>
            ))}
          </div>
        ))}
      {tab === 'years' &&
        (years === null ? (
          <div className="flex justify-center p-8"><Spinner /></div>
        ) : (
          <div className="grid gap-2 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
            {years.map((y) => (
              <button key={y.key} className="card-tile px-3 py-3 text-left" onClick={() => setView({ kind: 'year', year: y.key })}>
                <div className="font-display text-xl">{y.label}</div>
                {y.count !== undefined && <div className="text-[11px] text-ink-3">{y.count.toLocaleString()} items</div>}
              </button>
            ))}
          </div>
        ))}
      <div className="px-4 pb-4 pt-1 text-[11px] text-ink-3">
        <Sparkles size={11} className="mr-1 inline" />
        Your Immich library{status.user ? ` (${status.user})` : ''}, read-only. Face boxes from Immich are used for smart cropping.
      </div>
    </div>
  );
}

/* ---------------- Local library (/data/photos) ---------------- */

const ROOT_LABELS: Record<string, string> = { shared: 'Shared photos', mine: 'My photos', uploads: 'My uploads' };

function LibraryBrowser({ selected, onToggle, onPick }: { selected: Map<string, PhotoItem>; onToggle: (i: PhotoItem) => void; onPick: (i: PhotoItem) => void }) {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => onServerEvent((t) => t === 'library' && setTick((x) => x + 1)), []);
  useEffect(() => {
    setError(null);
    api
      .get<LibraryListing>(`/api/library?path=${enc(path)}&page=${page}`)
      .then((r) => setListing((prev) => (page > 1 && prev ? { ...r, items: [...prev.items, ...r.items] } : r)), (e) => setError(e.message));
  }, [path, page, tick]);

  const crumbs = path ? path.split('/') : [];
  return (
    <div className="h-full overflow-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-line bg-paper/95 px-3 py-2 text-[13px] backdrop-blur">
        <button className="btn btn-ghost btn-sm" onClick={() => { setPath(''); setPage(1); }}>
          <Folder size={14} /> Photos
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-ink-3">/</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setPath(crumbs.slice(0, i + 1).join('/')); setPage(1); }}>
              {i === 0 ? (ROOT_LABELS[c] ?? c) : c}
            </button>
          </span>
        ))}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => api.post('/api/library/refresh').then(() => setTick((x) => x + 1))}>
          Refresh
        </button>
      </div>
      {error && <div className="m-3 rounded-lg bg-bad-soft p-3 text-[13px] text-bad">{error}</div>}
      {listing && listing.folders.length > 0 && (
        <div className="grid gap-2 p-3 pb-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {listing.folders.map((f) => (
            <button key={f.path} className="card-tile flex items-center gap-2 px-3 py-2.5 text-left" onClick={() => { setPath(f.path); setPage(1); }}>
              <Folder size={18} className="shrink-0 text-gold" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{f.name}</span>
                <span className="text-[11px] text-ink-3">{f.count} photos</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {listing && !listing.items.length && !listing.folders.length && (
        <Empty icon={<Folder size={34} />} title="This folder is empty">
          {path.startsWith('uploads')
            ? 'Photos you upload in the browser land here. Only you can see them.'
            : path.startsWith('mine')
              ? <>Your private folder is <code>/data/photos/users/&lt;your username&gt;</code> on the server. Only you can see it.</>
              : <>Put photos everyone may use in <code>/data/photos/shared</code>, or private ones in <code>/data/photos/users/&lt;username&gt;</code>. Or use Upload.</>}
        </Empty>
      )}
      {listing && <PhotoGrid items={listing.items} selected={selected} onToggle={onToggle} onPick={onPick} hasMore={!!listing.nextPage} onMore={() => setPage((p) => p + 1)} />}
    </div>
  );
}

/* ---------------- Upload ---------------- */

function UploadPane({ onUploaded }: { onUploaded: (items: PhotoItem[]) => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const go = async (files: File[]) => {
    setProgress(0);
    try {
      const r = await upload<{ items: PhotoItem[]; rejected: string[] }>('/api/uploads', files, setProgress);
      setItems((prev) => [...r.items, ...prev]);
      setRejected(r.rejected);
      onUploaded(r.items);
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="h-full overflow-auto p-4">
      <Dropzone onFiles={go} accept="image/*,.heic,.heif,.tif,.tiff">
        <Upload size={30} className="mx-auto mb-2 text-brand" />
        <div className="font-medium">Drop photos here or click to browse</div>
        <div className="mt-1 text-[13px] text-ink-3">JPG, PNG, WebP, HEIC/HEIF (iPhone) and TIFF. Saved to your private uploads — nobody else can see them.</div>
        {progress !== null && (
          <div className="mx-auto mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-paper-3">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </Dropzone>
      {rejected.length > 0 && <div className="mt-3 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn">Not supported: {rejected.join(', ')}</div>}
      {items.length > 0 && (
        <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
          {items.map((i) => (
            <img key={i.ref} src={i.thumbUrl} alt="" className="aspect-square w-full rounded-lg object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
