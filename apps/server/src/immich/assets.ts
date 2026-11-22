import type { FaceBox, PhotoItem } from '@homecard/shared';
import { IMMICH_UUID } from '@homecard/shared';
import { httpError } from '../util/fsx';
import type { ReadOnlyImmichClient } from './readonly';

export function assertId(id: string) {
  if (!IMMICH_UUID.test(String(id))) throw httpError(400, 'Invalid Immich id');
  return id;
}

export interface ImmichAsset {
  id: string;
  type: string;
  originalFileName?: string;
  originalMimeType?: string;
  fileCreatedAt?: string;
  localDateTime?: string;
  isFavorite?: boolean;
  width?: number | null;
  height?: number | null;
  exifInfo?: { exifImageWidth?: number | null; exifImageHeight?: number | null; orientation?: string | number | null } | null;
  people?: Array<{ id: string; name: string; faces?: ImmichFace[] }>;
}

export interface ImmichFace {
  id?: string;
  boundingBoxX1: number;
  boundingBoxY1: number;
  boundingBoxX2: number;
  boundingBoxY2: number;
  imageWidth: number;
  imageHeight: number;
  person?: { id: string; name: string } | null;
}

export interface SearchResponse {
  assets: { items: ImmichAsset[]; nextPage: string | null; total?: number; count?: number };
}

/** Face boxes: /api/faces when the key has face.read, otherwise the people list on the asset. */
export async function immichFaces(c: ReadOnlyImmichClient, assetId: string): Promise<FaceBox[]> {
  let faces: ImmichFace[] = [];
  try {
    faces = await c.get<ImmichFace[]>(`/api/faces?id=${assertId(assetId)}`);
  } catch {
    const asset = await c.get<ImmichAsset>(`/api/assets/${assertId(assetId)}`).catch(() => null);
    faces = (asset?.people ?? []).flatMap((p) => (p.faces ?? []).map((f) => ({ ...f, person: { id: p.id, name: p.name } })));
  }
  return faces
    .filter((f) => f.imageWidth > 0 && f.imageHeight > 0)
    .map((f) => ({
      x: f.boundingBoxX1 / f.imageWidth,
      y: f.boundingBoxY1 / f.imageHeight,
      w: (f.boundingBoxX2 - f.boundingBoxX1) / f.imageWidth,
      h: (f.boundingBoxY2 - f.boundingBoxY1) / f.imageHeight,
      personName: f.person?.name || undefined,
    }))
    .filter((f) => f.w > 0 && f.h > 0);
}

export function orientedDims(a: ImmichAsset): { width?: number; height?: number } {
  if (a.width && a.height) return { width: a.width, height: a.height };
  const w = a.exifInfo?.exifImageWidth ?? undefined;
  const h = a.exifInfo?.exifImageHeight ?? undefined;
  if (!w || !h) return {};
  const o = Number(a.exifInfo?.orientation ?? 1);
  return o >= 5 && o <= 8 ? { width: h, height: w } : { width: w, height: h };
}

export function assetToItem(a: ImmichAsset): PhotoItem {
  const ref = `immich:${a.id}`;
  const enc = encodeURIComponent(ref);
  const d = orientedDims(a);
  return {
    ref,
    name: a.originalFileName ?? a.id,
    thumbUrl: `/api/media/thumb?ref=${enc}`,
    previewUrl: `/api/media/preview?ref=${enc}`,
    width: d.width,
    height: d.height,
    takenAt: a.localDateTime ?? a.fileCreatedAt ?? null,
    favorite: !!a.isFavorite,
    mime: a.originalMimeType ?? null,
  };
}
