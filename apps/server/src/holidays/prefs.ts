import { DEFAULT_HOLIDAY_PREFS, sanitizeHolidayPrefs, type HolidayPrefs } from '@homecard/shared';
import { one, run } from '../db';

/**
 * Per-user holiday preferences (user_holiday_prefs, one JSON row per user, deleted with the user).
 * Everything read back is re-validated, so an old or hand-edited row can't break the home page.
 */

export function getHolidayPrefs(userId: string): HolidayPrefs {
  const row = one<{ prefs: string }>('SELECT prefs FROM user_holiday_prefs WHERE user_id = ?', userId);
  if (!row) return { ...DEFAULT_HOLIDAY_PREFS, hiddenOccasions: [], customTagMap: {} };
  try {
    return sanitizeHolidayPrefs(JSON.parse(row.prefs));
  } catch {
    return { ...DEFAULT_HOLIDAY_PREFS, hiddenOccasions: [], customTagMap: {} };
  }
}

/** Merge a partial update (unknown or invalid fields are ignored) and save. */
export function saveHolidayPrefs(userId: string, patch: unknown): HolidayPrefs {
  const next = sanitizeHolidayPrefs(patch, getHolidayPrefs(userId));
  run(
    `INSERT INTO user_holiday_prefs(user_id, prefs, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
    userId,
    JSON.stringify(next),
    Date.now(),
  );
  return next;
}
