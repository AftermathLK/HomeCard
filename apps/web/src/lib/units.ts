import { defaultFavoriteSizes, findCardSize, formatDims, formatLength, type LengthUnit } from '@homecard/shared';
import { useSession } from '@/store/session';

/** Regions that measure paper in inches; everyone else gets millimetres. */
const INCH_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'LR', 'MM']);

let guessed: LengthUnit | null = null;

/** Inches or millimetres from the browser's language and region (en-US → in, en-GB → mm). */
export function defaultUnits(): LengthUnit {
  if (guessed) return guessed;
  try {
    const region = new Intl.Locale(navigator.language || 'en-US').maximize().region;
    guessed = !region || INCH_REGIONS.has(region) ? 'in' : 'mm';
  } catch {
    guessed = 'in';
  }
  return guessed;
}

/** The signed-in person's units (Settings → Printing, or the switch next to "Card size"). */
export function useUnits(): LengthUnit {
  return useSession((s) => s.user?.prefs.units) ?? defaultUnits();
}

/** Formatters bound to the person's units. `short` suits slider readouts (0.25" or 6.4 mm). */
export function useMeasure() {
  const units = useUnits();
  return {
    units,
    len: (inches: number, decimals?: number) => formatLength(inches, units, decimals),
    short: (inches: number) => formatLength(inches, units, units === 'mm' ? 1 : 2),
    dims: (w: number, h: number, decimals?: number) => formatDims(w, h, units, decimals),
  };
}

/** Outside React: the signed-in person's units. */
export function currentUnits(): LengthUnit {
  return useSession.getState().user?.prefs.units ?? defaultUnits();
}

/**
 * The size a new card starts at: the person's first starred size (their own saved sizes count),
 * which until they star their own is 5 × 7" for inches and A6 for millimetres.
 */
export function defaultCardSize(orientation: 'portrait' | 'landscape' = 'portrait'): { sizeId: string; customW?: number; customH?: number } {
  const prefs = useSession.getState().user?.prefs;
  const units = currentUnits();
  for (const id of prefs?.favoriteSizes ?? defaultFavoriteSizes(units)) {
    const s = findCardSize(id, prefs?.savedSizes ?? []);
    if (!s) continue;
    if (!s.saved) return { sizeId: s.id };
    const land = orientation === 'landscape' && s.w !== s.h;
    return { sizeId: s.id, customW: land ? s.h : s.w, customH: land ? s.w : s.h };
  }
  return { sizeId: units === 'mm' ? 'a6' : '5x7' };
}
