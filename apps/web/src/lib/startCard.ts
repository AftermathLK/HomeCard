import {
  applyTemplate,
  autoFillPhotos,
  createProject,
  getOccasion,
  templatesFor,
  type CardProject,
  type PhotoItem,
  type ResolvedStylePack,
  type TemplateDef,
} from '@homecard/shared';
import { useEditor } from '@/store/editor';
import { useSession } from '@/store/session';
import { useUi } from '@/store/ui';
import { resolvePhotos } from './actions';
import { api } from './api';
import { useAssets } from './assets';

/**
 * A front layout with room for `n` photos: the occasion's own layout when it already fits, then a
 * layout from a style pack made for this occasion, then a built-in one. With no exact fit, the
 * roomiest layout that holds fewer (the rest go to the back or stay in the card's photo tray).
 */
export function pickFrontTemplate(occasionId: string, n: number, packs: readonly ResolvedStylePack[]): string {
  const occ = getOccasion(occasionId);
  const front = templatesFor('front').filter((t) => t.photos > 0);
  const own = front.find((t) => t.id === occ.frontTemplate);
  if (own && own.photos === n) return own.id;
  const packIds = new Set(
    packs.filter((p) => p.occasions.includes(occasionId)).flatMap((p) => p.templates.map((t) => (t.id.includes(':') ? t.id : `${p.id}:${t.id}`))),
  );
  const fromPacks = front.filter((t) => packIds.has(t.id));
  const builtin = front.filter((t) => t.source === 'builtin');
  const exact = (list: TemplateDef[]) => list.find((t) => t.photos === n);
  const under = (list: TemplateDef[]) =>
    list
      .filter((t) => t.photos < n)
      .sort((a, b) => b.photos - a.photos)[0];
  return (exact(fromPacks) ?? exact(builtin) ?? under(fromPacks) ?? under(builtin) ?? own ?? front[0])?.id ?? occ.frontTemplate;
}

/** Most photos landscape: lay the card out landscape too. */
function orientationFor(items: Array<Pick<PhotoItem, 'width' | 'height'>>): 'portrait' | 'landscape' {
  const known = items.filter((i) => i.width && i.height);
  if (!known.length) return 'portrait';
  const wide = known.filter((i) => i.width! > i.height! * 1.1).length;
  return wide * 2 > known.length ? 'landscape' : 'portrait';
}

/**
 * "Start a card with these photos": a new draft for the occasion with a layout sized to the
 * selection and the photos already placed, then straight into the editor.
 */
export async function startCardWithPhotos(occasionId: string, items: PhotoItem[]): Promise<CardProject> {
  const records = await resolvePhotos(items);
  if (!records.length) throw new Error('None of those photos could be read from Immich.');
  const vendorId = useSession.getState().user?.prefs.defaultVendorId || undefined;
  let p = createProject({ occasionId, vendorId, orientation: orientationFor(items) });
  const tpl = pickFrontTemplate(occasionId, records.length, useAssets.getState().packs);
  const front = p.surfaces.find((s) => s.id === 'front');
  if (front && front.templateId !== tpl) {
    const surface = applyTemplate(p, 'front', tpl);
    p = { ...p, surfaces: p.surfaces.map((s) => (s.id === 'front' ? surface : s)) };
  }
  p = autoFillPhotos({ ...p, photos: records }, records);
  const saved = await api.post<CardProject>('/api/projects', p);
  useEditor.getState().openProject(saved);
  useUi.getState().set({ newCardOpen: false, newCardOccasionId: null, step: 2, subTab: 'photos' });
  useUi.getState().go({ name: 'editor', projectId: saved.id });
  return saved;
}
