/** DTOs shared by the HTTP API and the web client. */
import type { FaceBox, PhotoRecord } from './types';

export interface HealthInfo {
  ok: boolean;
  version: string;
  renderer: { available: boolean; detail: string };
  ghostscript: { available: boolean; version?: string };
  heic: boolean;
  /** serverConfigured: an admin has set the Immich URL. linked: the signed-in user saved a key. */
  immich: { serverConfigured: boolean; linked: boolean };
  /** Admins only. */
  dirs?: Record<string, string>;
  iccProfiles: Array<{ id: string; name: string; colorSpace: 'cmyk' | 'rgb' }>;
  stock: StockProviderInfo[];
}

/* ---------- Accounts ---------- */

export type UserRole = 'admin' | 'user';

export interface UserPrefs {
  defaultVendorId?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
  prefs: UserPrefs;
}

export interface AuthState {
  setupRequired: boolean;
  allowRegistration: boolean;
  user: SessionUser | null;
}

export interface AdminUserDto extends SessionUser {
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  /** Sign-in temporarily blocked after repeated failed attempts. */
  locked: boolean;
  immichLinked: boolean;
}

export interface UserDirectoryEntry {
  id: string;
  username: string;
  displayName: string;
}

export interface AuditEntryDto {
  id: number;
  at: string;
  event: string;
  outcome: 'ok' | 'denied' | 'error';
  userId: string | null;
  username: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

export interface ServerSettingsDto {
  immichUrl: string;
  /** IMMICH_URL from the environment wins and can't be edited in the app. */
  immichUrlFromEnv: boolean;
  allowRegistration: boolean;
  trustProxy: string;
  https: boolean;
  stock: {
    pixabay: StockKeyStatus;
    unsplash: StockKeyStatus;
    /** OPENVERSE_ENABLED from the environment wins and locks the switch. */
    openverse: { enabled: boolean; fromEnv: boolean };
  };
}

/** A stock provider's API key as the admin screen sees it: never the key itself. */
export interface StockKeyStatus {
  /** env: PIXABAY_API_KEY / UNSPLASH_API_KEY (read-only in the app); admin: saved in Settings → Server. */
  source: 'env' | 'admin' | 'none';
  last4: string | null;
  /** Saved, but no longer decryptable (APP_ENCRYPTION_KEY changed): paste it again. */
  unreadable: boolean;
}

export interface StockKeySaveResult {
  settings: ServerSettingsDto;
  /** true: the provider accepted the key. null: saved without a check (provider unreachable). */
  valid: boolean | null;
  message: string;
}

/* ---------- Immich (per user) ---------- */

export interface ImmichConnectionDto {
  serverUrl: string;
  serverConfigured: boolean;
  linked: boolean;
  /** Last 4 characters only — the key itself never leaves the server. */
  keyLast4: string | null;
  permissions: string[] | null;
  /** True when Immich reported the key's permissions and they are read-only. */
  scopesVerified: boolean;
  /** The user confirmed read-only scopes by hand (older Immich without /api/api-keys/me). */
  manualAck: boolean;
  missingRequired: string[];
  missingOptional: string[];
  immichUser: string | null;
  verifiedAt: string | null;
  /** The stored key can't be decrypted any more (APP_ENCRYPTION_KEY changed). */
  needsReentry: boolean;
}

export interface ImmichKeyCheck {
  reachable: boolean;
  /** Key accepted by Immich. */
  authenticated: boolean;
  /** HomeCard will store this key. */
  canSave: boolean;
  immichUser?: string;
  permissions: string[] | null;
  scopesVerifiable: boolean;
  dangerous: string[];
  missingRequired: string[];
  missingOptional: string[];
  error?: string;
  warning?: string;
}

export interface ImmichStatus {
  ok: boolean;
  configured: boolean;
  url?: string;
  user?: string;
  error?: string;
  scopesVerified?: boolean;
  warning?: string;
}

/* ---------- Stock backgrounds ---------- */

export type StockProviderId = 'pixabay' | 'unsplash' | 'openverse';

export interface StockProviderInfo {
  id: StockProviderId;
  name: string;
  enabled: boolean;
  keyless: boolean;
  /** Short licence summary shown in the picker. */
  license: string;
}

export interface StockSearchQuery {
  provider: StockProviderId;
  q: string;
  page?: number;
  imageType?: 'all' | 'photo' | 'illustration' | 'vector';
  color?: string;
  orientation?: 'all' | 'horizontal' | 'vertical' | 'squarish';
}

export interface StockAttribution {
  /** "Photo by Jane Doe on Unsplash" */
  text: string;
  author?: string;
  authorUrl?: string;
  sourceUrl?: string;
  license?: string;
  licenseUrl?: string;
}

export interface StockItem {
  provider: StockProviderId;
  id: string;
  thumbUrl: string;
  width: number;
  height: number;
  /** Largest pixel size HomeCard can download for print. */
  printWidth: number;
  printHeight: number;
  title: string;
  attribution: StockAttribution;
}

export interface StockSearchResult {
  items: StockItem[];
  page: number;
  hasMore: boolean;
  total?: number;
  cached: boolean;
}

export interface StockSelection {
  /** Background texture ref: "stock:<file>". */
  ref: string;
  width: number;
  height: number;
  attribution: StockAttribution;
}

export interface ImmichAlbum {
  id: string;
  name: string;
  count: number;
  thumbnailAssetId: string | null;
  shared: boolean;
}

export interface ImmichPerson {
  id: string;
  name: string;
  thumbnailUrl: string;
}

export interface PhotoItem {
  ref: string;
  name: string;
  thumbUrl: string;
  previewUrl: string;
  width?: number;
  height?: number;
  takenAt?: string | null;
  favorite?: boolean;
  mime?: string | null;
}

export interface PhotoPage {
  items: PhotoItem[];
  nextPage: string | null;
  total?: number;
}

export interface TimelineBucket {
  key: string; // YYYY or YYYY-MM
  label: string;
  count?: number;
}

export interface LibraryFolder {
  path: string;
  name: string;
  count: number;
}

export interface LibraryListing {
  path: string;
  folders: LibraryFolder[];
  items: PhotoItem[];
  nextPage: string | null;
  total: number;
}

export interface MediaInfo extends PhotoRecord {
  printSource: 'original' | 'fullsize' | 'preview';
  facesKnown: boolean;
}

export interface FontFamilyInfo {
  family: string;
  source: 'bundled' | 'custom';
  category: string;
  faces: Array<{ weight: number; style: 'normal' | 'italic'; file: string }>;
}

export interface FaceUpdate {
  ref: string;
  faces: FaceBox[];
}
