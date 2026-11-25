import { DEFAULT_PICKER_PREFS, sanitizePickerPrefs, type PickerPrefs } from '@homecard/shared';
import { one, run } from '../db';

/**
 * Per-user photo picker preferences (user_picker_prefs, one JSON row per user, deleted with the
 * user): favourite Immich albums and how albums are sorted. Re-validated on every read.
 */

const fresh = (): PickerPrefs => ({ ...DEFAULT_PICKER_PREFS, favoriteAlbums: [] });

export function getPickerPrefs(userId: string): PickerPrefs {
  const row = one<{ prefs: string }>('SELECT prefs FROM user_picker_prefs WHERE user_id = ?', userId);
  if (!row) return fresh();
  try {
    return sanitizePickerPrefs(JSON.parse(row.prefs), fresh());
  } catch {
    return fresh();
  }
}

/** Merge a partial update (unknown or invalid fields are ignored) and save. */
export function savePickerPrefs(userId: string, patch: unknown): PickerPrefs {
  const next = sanitizePickerPrefs(patch, getPickerPrefs(userId));
  run(
    `INSERT INTO user_picker_prefs(user_id, prefs, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
    userId,
    JSON.stringify(next),
    Date.now(),
  );
  return next;
}
