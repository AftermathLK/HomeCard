import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, CalendarDays, CheckCircle2, FileClock, FolderSync, Images, Package, Printer, Server, Settings2, Type, Upload, UserRound, Users } from 'lucide-react';
import { VENDOR_PRESETS, type LengthUnit } from '@homecard/shared';
import { Modal, Spinner } from '@/components/ui';
import { api, upload } from '@/lib/api';
import { useAssets } from '@/lib/assets';
import { useMeasure } from '@/lib/units';
import { useSession } from '@/store/session';
import { useUi, type SettingsTab } from '@/store/ui';
import { AdminAudit } from './AdminAudit';
import { AdminServer } from './AdminServer';
import { AdminUsers } from './AdminUsers';
import { HolidaySettings } from './HolidaySettings';
import { ImmichConnection } from './ImmichConnection';
import { ProfileSettings } from './ProfileSettings';

const ADMIN_TABS: SettingsTab[] = ['users', 'audit', 'server'];

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const requested = useUi((s) => s.settingsTab);
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  if (!open) return null;
  const tab: SettingsTab = !isAdmin && ADMIN_TABS.includes(requested) ? 'profile' : requested;
  const setTab = (t: SettingsTab) => useUi.setState({ settingsTab: t });
  const close = () => useUi.setState({ settingsOpen: false });
  const groups: Array<{ label: string; tabs: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> }> = [
    {
      label: 'You',
      tabs: [
        { id: 'profile', label: 'Profile', icon: <UserRound size={16} /> },
        { id: 'immich', label: 'Immich connection', icon: <Images size={16} /> },
        { id: 'holidays', label: 'Holidays', icon: <CalendarDays size={16} /> },
        { id: 'printing', label: 'Printing', icon: <Printer size={16} /> },
      ],
    },
    {
      label: 'Library',
      tabs: [
        { id: 'fonts', label: 'Fonts', icon: <Type size={16} /> },
        { id: 'styles', label: 'Style packs', icon: <Package size={16} /> },
      ],
    },
    ...(isAdmin
      ? [
          {
            label: 'Admin',
            tabs: [
              { id: 'users' as const, label: 'Users', icon: <Users size={16} /> },
              { id: 'audit' as const, label: 'Security log', icon: <FileClock size={16} /> },
              { id: 'server' as const, label: 'Server', icon: <Settings2 size={16} /> },
            ],
          },
        ]
      : []),
    { label: '', tabs: [{ id: 'system', label: 'System', icon: <Server size={16} /> }] },
  ];
  return (
    <Modal open onClose={close} width="max-w-5xl" bodyClass="p-0" title="Settings">
      <div className="flex min-h-[560px]">
        <nav className="w-48 shrink-0 space-y-3 border-r border-line bg-paper-2/60 p-2">
          {groups.map((g, i) => (
            <div key={g.label || i} className="space-y-0.5">
              {g.label && <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.label}</div>}
              {g.tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={clsx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium transition', tab === t.id ? 'bg-white text-brand shadow-sm' : 'text-ink-2 hover:bg-white/60')}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto p-5">
          {tab === 'profile' && <ProfileSettings />}
          {tab === 'immich' && <ImmichConnection />}
          {tab === 'holidays' && <HolidaySettings />}
          {tab === 'fonts' && <FontSettings />}
          {tab === 'styles' && <StyleSettings />}
          {tab === 'printing' && <PrintingSettings />}
          {tab === 'users' && isAdmin && <AdminUsers />}
          {tab === 'audit' && isAdmin && <AdminAudit />}
          {tab === 'server' && isAdmin && <AdminServer />}
          {tab === 'system' && <SystemInfo />}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Fonts ---------------- */

function FontSettings() {
  const fonts = useAssets((s) => s.fonts);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const custom = fonts.filter((f) => f.source === 'custom');
  const bundled = fonts.filter((f) => f.source === 'bundled');
  const onFiles = async (files: File[]) => {
    setBusy(true);
    try {
      const r = await upload<{ saved: string[]; rejected: string[] }>('/api/fonts/upload', files);
      await useAssets.getState().loadFonts();
      useUi.getState().toast(r.saved.length ? `Installed ${r.saved.join(', ')}` : 'No fonts were added.', r.saved.length ? 'ok' : 'error');
      if (r.rejected.length) useUi.getState().toast(`Not a .ttf/.otf/.woff/.woff2 file: ${r.rejected.join(', ')}`, 'error');
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-display text-lg">Fonts</h3>
          <p className="text-[13px] text-ink-3">
            {bundled.length} open-source fonts are built in. Add your own .ttf, .otf, .woff or .woff2 files here or drop them into <code>/data/fonts</code> — they work in the editor and in print exports immediately.
          </p>
        </div>
        <button
          className="btn"
          onClick={async () => {
            await api.post('/api/fonts/rescan');
            await useAssets.getState().loadFonts();
            useUi.getState().toast('Fonts rescanned.', 'ok');
          }}
        >
          <FolderSync size={15} /> Rescan
        </button>
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Spinner size={14} className="text-white" /> : <Upload size={15} />} Upload fonts
        </button>
        <input ref={input} type="file" multiple accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={(e) => { if (e.target.files?.length) void onFiles(Array.from(e.target.files)); e.target.value = ''; }} />
      </div>
      <div>
        <div className="label">Your fonts ({custom.length})</div>
        {!custom.length ? (
          <p className="text-[13px] text-ink-3">None yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {custom.map((f) => (
              <div key={f.family} className="rounded-lg border border-line bg-white px-3 py-2">
                <div className="truncate text-xl" style={{ fontFamily: `"${f.family}"` }}>
                  {f.family}
                </div>
                <div className="text-[11px] text-ink-3">{f.faces.map((x) => `${x.weight}${x.style === 'italic' ? 'i' : ''}`).join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="label">Built in ({bundled.length})</div>
        <div className="grid grid-cols-3 gap-1.5">
          {bundled.map((f) => (
            <div key={f.family} className="truncate rounded-lg bg-white px-2.5 py-1.5 text-[17px]" style={{ fontFamily: `"${f.family}"` }} title={`${f.family} — ${f.category}`}>
              {f.family}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Style packs ---------------- */

function StyleSettings() {
  const packs = useAssets((s) => s.packs);
  // Installing and reloading packs changes them for every account, so only admins can; anyone can add to My Uploads.
  const isAdmin = useSession((s) => s.user?.role === 'admin');
  const [busy, setBusy] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const assetRef = useRef<HTMLInputElement>(null);
  const [assetKind, setAssetKind] = useState<'backgrounds' | 'ornaments' | 'stickers'>('backgrounds');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (err: any) {
      useUi.getState().toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-display text-lg">Style packs</h3>
          <p className="text-[13px] text-ink-3">
            Palettes, foils, textures, SVG ornaments, stickers, templates and font pairings live in <code>/data/styles</code>. Changes there are picked up automatically. See <code>docs/STYLE_PACKS.md</code> for the format.
          </p>
        </div>
        {isAdmin && (
          <button className="btn" onClick={() => run('rescan', async () => { await api.post('/api/styles/rescan'); await useAssets.getState().loadStyles(); useUi.getState().toast('Style packs reloaded.', 'ok'); })}>
            {busy === 'rescan' ? <Spinner size={14} /> : <FolderSync size={15} />} Rescan
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3">
        {isAdmin ? (
          <button className="btn btn-primary" onClick={() => importRef.current?.click()} disabled={!!busy}>
            {busy === 'import' ? <Spinner size={14} className="text-white" /> : <Package size={15} />} Import pack (.zip / .json)
          </button>
        ) : (
          <span className="text-[13px] text-ink-3">An admin can install new style packs.</span>
        )}
        <input
          ref={importRef}
          type="file"
          multiple
          accept=".zip,.json"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length)
              void run('import', async () => {
                const r = await upload<{ results: Array<{ file: string; packId?: string; error?: string }> }>('/api/styles/import', files);
                await useAssets.getState().loadStyles();
                // A library zip can hold dozens of packs: one toast for the imports, one per problem.
                const ok = r.results.filter((x) => !x.error).map((x) => x.packId);
                if (ok.length) useUi.getState().toast(ok.length === 1 ? `Imported ${ok[0]}` : `Imported ${ok.length} packs (${ok.slice(0, 3).join(', ')}${ok.length > 3 ? ', …' : ''})`, 'ok');
                for (const x of r.results.filter((y) => y.error).slice(0, 5)) useUi.getState().toast(`${x.file}: ${x.error}`, 'error');
              });
          }}
        />
        <span className="mx-1 h-6 w-px bg-line" />
        <select className="input !w-40" value={assetKind} onChange={(e) => setAssetKind(e.target.value as any)}>
          <option value="backgrounds">Textures / papers</option>
          <option value="ornaments">SVG ornaments</option>
          <option value="stickers">Stickers (PNG/SVG)</option>
        </select>
        <button className="btn" onClick={() => assetRef.current?.click()} disabled={!!busy}>
          {busy === 'asset' ? <Spinner size={14} /> : <Upload size={15} />} Upload assets
        </button>
        <input
          ref={assetRef}
          type="file"
          multiple
          accept={assetKind === 'ornaments' ? '.svg' : '.png,.jpg,.jpeg,.webp,.svg'}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length)
              void run('asset', async () => {
                const r = await upload<{ saved: string[]; rejected: string[] }>(`/api/styles/upload?kind=${assetKind}`, files);
                await useAssets.getState().loadStyles();
                useUi.getState().toast(`Added ${r.saved.length} to My Uploads${r.rejected.length ? ` · rejected ${r.rejected.join(', ')}` : ''}`, r.rejected.length ? 'error' : 'ok');
              });
          }}
        />
      </div>
      <div className="space-y-2">
        {packs.map((p) => (
          <div key={p.id} className="rounded-xl border border-line bg-white px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-ink-3">
                {p.id}
                {p.version ? ` · v${p.version}` : ''}
                {p.author ? ` · ${p.author}` : ''}
                {p.license ? ` · ${p.license}` : ''}
              </span>
            </div>
            {p.description && <p className="text-[13px] text-ink-2">{p.description}</p>}
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-3">
              {(
                [
                  [p.palettes.length, 'palette'],
                  [p.backgrounds.length, 'texture'],
                  [p.foils.length, 'foil'],
                  [p.ornaments.length, 'ornament'],
                  [p.stickers.length, 'sticker'],
                  [p.templates.length, 'template'],
                  [p.fontPairings.length, 'font pairing'],
                ] as const
              )
                .filter(([n]) => n > 0)
                .map(([n, label]) => (
                  <span key={label}>
                    {n} {label}
                    {n === 1 ? '' : 's'}
                  </span>
                ))}
            </div>
            {p.errors.length > 0 && (
              <div className="mt-1.5 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
                {p.errors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Printing ---------------- */

function PrintingSettings() {
  const user = useSession((x) => x.user)!;
  const current = user.prefs.defaultVendorId ?? VENDOR_PRESETS[0].id;
  const vendor = VENDOR_PRESETS.find((v) => v.id === current) ?? VENDOR_PRESETS[0];
  const { units, len } = useMeasure();
  return (
    <div className="max-w-xl space-y-4">
      <h3 className="font-display text-lg">Printing</h3>
      <label className="block">
        <span className="label">Measurements</span>
        <select
          className="input"
          value={units}
          onChange={(e) =>
            useSession
              .getState()
              .savePrefs({ units: e.target.value as LengthUnit })
              .catch((err) => useUi.getState().toast(err.message, 'error'))
          }
        >
          <option value="in">Inches (5 × 7")</option>
          <option value="mm">Millimetres (A6 · 105 × 148 mm)</option>
        </select>
        <span className="mt-1 block text-xs text-ink-3">Card sizes, bleed and margins show in these units. Each person picks their own.</span>
      </label>
      <label className="block">
        <span className="label">Your default printer for new cards</span>
        <select
          className="input"
          value={current}
          onChange={(e) =>
            useSession
              .getState()
              .savePrefs({ defaultVendorId: e.target.value })
              .catch((err) => useUi.getState().toast(err.message, 'error'))
          }
        >
          {VENDOR_PRESETS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-xl border border-line bg-white p-4 text-[13px]">
        <div className="font-medium">{vendor.name}</div>
        <p className="mt-1 text-ink-2">{vendor.notes}</p>
        <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-ink-3">
          <span>Bleed: {len(vendor.bleedIn)}</span>
          <span>Safe margin: {len(vendor.safeIn)}</span>
          <span>Colour: {vendor.colorProfile.toUpperCase()}</span>
          <span>Best file: {vendor.recommendedFormat.toUpperCase()}</span>
          {vendor.maxUploadMB && <span>Upload limit: {vendor.maxUploadMB} MB</span>}
          <span>Folded cards: {vendor.supportsFolded ? 'yes' : 'no'}</span>
        </div>
      </div>
      <p className="text-xs text-ink-3">Vendors change their specs occasionally — compare with the vendor’s current template before a big order.</p>
    </div>
  );
}

/* ---------------- System ---------------- */

function SystemInfo() {
  const health = useAssets((s) => s.health);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    useAssets.getState().loadHealth(true).finally(() => setLoading(false));
  }, []);
  if (!health) return loading ? <Spinner /> : <p>Health information unavailable.</p>;
  const Row = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
    <div className="flex items-start gap-2 py-1.5">
      {ok ? <CheckCircle2 size={16} className="mt-0.5 text-ok" /> : <AlertTriangle size={16} className="mt-0.5 text-warn" />}
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-xs text-ink-3">{detail}</div>
      </div>
    </div>
  );
  return (
    <div className="max-w-2xl space-y-4">
      <h3 className="font-display text-lg">System {loading && <Spinner size={14} />}</h3>
      <div className="rounded-xl border border-line bg-white px-4 py-2">
        <Row ok={health.renderer.available} label="Print renderer (headless Chromium)" detail={health.renderer.detail} />
        <Row ok={health.ghostscript.available} label="Ghostscript" detail={health.ghostscript.available ? `Version ${health.ghostscript.version} — CMYK PDF conversion and PDF proofs enabled` : 'Not found — CMYK conversion unavailable; proofs use the renderer'} />
        <Row ok={health.heic} label="HEIC / HEIF decoding" detail={health.heic ? 'iPhone photos are supported' : 'libvips was built without HEIF support — convert HEIC to JPEG first'} />
        <Row
          ok={health.immich.serverConfigured && health.immich.linked}
          label="Immich"
          detail={!health.immich.serverConfigured ? 'No Immich server address set (admin → Server)' : health.immich.linked ? 'Server set · your read-only key is linked' : 'Server set · link your own key under Immich connection'}
        />
      </div>
      {health.dirs && (
        <div>
          <div className="label">Data folders (admins only)</div>
          <div className="rounded-xl border border-line bg-white px-4 py-2 font-mono text-xs">
            {Object.entries(health.dirs).map(([k, v]) => (
              <div key={k} className="flex gap-3 py-0.5">
                <span className="w-20 text-ink-3">{k}</span>
                <span className="truncate">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="label">ICC profiles</div>
        {!health.iccProfiles.length ? (
          <p className="text-xs text-ink-3">None. Put your printer’s .icc/.icm file in /data/config/icc to target it for CMYK exports.</p>
        ) : (
          <div className="rounded-xl border border-line bg-white px-4 py-2 text-xs">
            {health.iccProfiles.map((p) => (
              <div key={p.id} className="py-0.5">
                {p.name} <span className="text-ink-3">({p.colorSpace.toUpperCase()})</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-ink-3">HomeCard {health.version}. No telemetry. Photos stay on this server; only stock-background searches (if enabled) reach the internet, through the server.</p>
    </div>
  );
}
