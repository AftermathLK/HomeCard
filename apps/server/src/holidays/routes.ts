import type { FastifyInstance } from 'fastify';
import { OCCASIONS, type HolidayPrefs, type ImmichTagsDto, type UpcomingPhotosDto } from '@homecard/shared';
import { userOf } from '../auth/context';
import { clientForUser, isLinked } from '../immich/credentials';
import { discoverHolidayPhotos, listImmichTags } from '../immich/discovery';
import { cachedPhotos, invalidateUserPhotos, storePhotos } from '../immich/photoCache';
import { once } from '../util/cache';
import { httpError } from '../util/fsx';
import { getHolidayPrefs, saveHolidayPrefs } from './prefs';

const OCCASION_IDS = new Set(OCCASIONS.map((o) => o.id));

/**
 * Holiday preferences and "pictures from this time". Every handler works for the signed-in person
 * only (userOf: never the print renderer), with their own Immich key, through the read-only client.
 */
export function registerHolidayRoutes(app: FastifyInstance) {
  app.get('/api/me/holidays', async (req): Promise<HolidayPrefs> => getHolidayPrefs(userOf(req).userId));

  app.put<{ Body: unknown }>('/api/me/holidays', async (req): Promise<HolidayPrefs> => {
    const me = userOf(req);
    const before = getHolidayPrefs(me.userId);
    const next = saveHolidayPrefs(me.userId, req.body);
    // New tag names change what matches: drop this person's cached suggestions.
    if (JSON.stringify(before.customTagMap) !== JSON.stringify(next.customTagMap)) invalidateUserPhotos(me.userId);
    return next;
  });

  app.get<{ Querystring: { occasionId?: string; refresh?: string; visual?: string } }>('/api/immich/upcoming-photos', async (req, reply): Promise<UpcomingPhotosDto> => {
    const me = userOf(req);
    const occasionId = String(req.query.occasionId ?? '');
    if (!OCCASION_IDS.has(occasionId)) throw httpError(400, 'Unknown occasion');
    const visual = req.query.visual === '1';
    const parts = ['upcoming', occasionId, visual ? 'visual' : 'plain'];
    reply.header('Cache-Control', 'private, no-store');
    const hit = req.query.refresh === '1' ? null : cachedPhotos<Omit<UpcomingPhotosDto, 'cached'>>(me.userId, parts);
    if (hit) return { ...hit.value, cached: true };
    const c = clientForUser(me.userId);
    const customTags = getHolidayPrefs(me.userId).customTagMap[occasionId] ?? [];
    // The home strip and the drawer can ask at the same moment: one Immich round per person and occasion.
    const out = await once(`holiday-photos:${me.userId}:${parts.join(':')}`, async () => {
      // Tags are always tried: a key that gained tag.read since it was saved works straight away,
      // and one without it answers 403, which only turns tag matching off.
      const r = await discoverHolidayPhotos(c, { occasionId, customTags, visual });
      storePhotos(me.userId, parts, r);
      return r;
    });
    return { ...out, cached: false };
  });

  app.get('/api/immich/tags', async (req): Promise<ImmichTagsDto> => {
    const me = userOf(req);
    if (!isLinked(me.userId)) return { available: false, tags: [], missingScopes: [] };
    return listImmichTags(clientForUser(me.userId));
  });
}
