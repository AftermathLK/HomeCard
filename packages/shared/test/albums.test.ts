import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PICKER_PREFS, nameMatches, sanitizePickerPrefs, sortAlbums, type ImmichAlbum } from '../src/index';

const album = (name: string, o: Partial<ImmichAlbum> = {}): ImmichAlbum => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, count: 1, thumbnailAssetId: null, shared: false, ...o });

const ALBUMS = [
  album('Christmas 2023', { count: 40, createdAt: '2023-12-26T10:00:00Z', lastAssetAt: '2024-01-02T10:00:00Z', endDate: '2023-12-31T10:00:00Z' }),
  album('Beach week', { count: 120, createdAt: '2024-07-10T10:00:00Z', lastAssetAt: '2024-07-20T10:00:00Z', endDate: '2024-07-18T10:00:00Z' }),
  album('Älska Mormor', { count: 5, createdAt: '2022-03-01T10:00:00Z' }),
  album('christmas 2024', { count: 60, createdAt: '2024-12-27T10:00:00Z', updatedAt: '2025-01-05T10:00:00Z', endDate: '2024-12-31T10:00:00Z' }),
  album('Album 10'),
  album('Album 9'),
];
const names = (a: ImmichAlbum[]) => a.map((x) => x.name);

test('album names match every typed word, any order, ignoring case and accents', () => {
  assert.ok(nameMatches('Christmas 2024', 'christmas'));
  assert.ok(nameMatches('Christmas 2024', '2024 xmas') === false);
  assert.ok(nameMatches('Christmas 2024', '2024 chris'));
  assert.ok(nameMatches('Älska Mormor', 'alska'));
  assert.ok(nameMatches('Anything', '   '));
  assert.deepEqual(names(ALBUMS.filter((a) => nameMatches(a.name, 'CHRISTMAS'))), ['Christmas 2023', 'christmas 2024']);
});

test('albums sort by title, dates and size, with undated albums last', () => {
  assert.deepEqual(names(sortAlbums(ALBUMS, 'name-asc')), ['Album 9', 'Album 10', 'Älska Mormor', 'Beach week', 'Christmas 2023', 'christmas 2024']);
  assert.deepEqual(names(sortAlbums(ALBUMS, 'name-desc')).slice(0, 2), ['christmas 2024', 'Christmas 2023']);
  // Last photo added: falls back to updatedAt when Immich gives no lastModifiedAssetTimestamp.
  assert.deepEqual(names(sortAlbums(ALBUMS, 'recent-photo')).slice(0, 3), ['christmas 2024', 'Beach week', 'Christmas 2023']);
  assert.deepEqual(names(sortAlbums(ALBUMS, 'created-desc')).slice(0, 4), ['christmas 2024', 'Beach week', 'Christmas 2023', 'Älska Mormor']);
  assert.deepEqual(names(sortAlbums(ALBUMS, 'created-asc')).slice(0, 2), ['Älska Mormor', 'Christmas 2023']);
  assert.deepEqual(names(sortAlbums(ALBUMS, 'created-asc')).slice(-2), ['Album 9', 'Album 10'], 'no date → last, then by title');
  assert.deepEqual(names(sortAlbums(ALBUMS, 'photo-date-desc')).slice(0, 3), ['christmas 2024', 'Beach week', 'Christmas 2023']);
  assert.deepEqual(names(sortAlbums(ALBUMS, 'count-desc')).slice(0, 2), ['Beach week', 'christmas 2024']);
  assert.equal(ALBUMS[0].name, 'Christmas 2023', 'sorting returns a copy');
});

test('picker preferences keep only valid album ids and sorts', () => {
  assert.deepEqual(sanitizePickerPrefs(null), DEFAULT_PICKER_PREFS);
  const p = sanitizePickerPrefs({ favoriteAlbums: ['a1b2-c3', 'a1b2-c3', '../etc', 7, 'x'.repeat(80)], albumSort: 'count-desc', isAdmin: true });
  assert.deepEqual(p, { favoriteAlbums: ['a1b2-c3'], albumSort: 'count-desc' });
  assert.deepEqual(sanitizePickerPrefs({ albumSort: 'by-colour' }, p), p, 'an unknown sort keeps the old one');
  assert.equal(sanitizePickerPrefs({ favoriteAlbums: Array.from({ length: 500 }, (_, i) => `id-${i}`) }).favoriteAlbums.length, 200);
});
