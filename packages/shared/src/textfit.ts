/**
 * How a text box settles its type size. The card renderer (editor and print) lays the text out in
 * the DOM and the tests lay it out from font metrics, but both run this same search.
 */
import type { FontSpec, TextElement, Theme } from './types';

/** The font a text element is drawn in: its own overrides over the theme's font for its role. */
export function textFont(el: TextElement, theme: Theme): FontSpec & { size: number } {
  const base = theme.fonts[el.fontRole] ?? theme.fonts.body;
  const transform = el.transform && el.transform !== 'theme' ? el.transform : (base.transform ?? 'none');
  return {
    family: el.fontFamily || base.family,
    weight: el.fontWeight ?? base.weight,
    style: el.italic === undefined ? base.style : el.italic ? 'italic' : 'normal',
    letterSpacing: el.letterSpacing ?? base.letterSpacing ?? 0,
    transform,
    size: el.fontSize,
  };
}

/**
 * Lays the text out at `pt` points and says whether it fits its box. With `wholeWords` a line may
 * only break between words, so a word wider than the box does not fit; without it a long word may
 * break across lines.
 */
export type TextFitProbe = (pt: number, wholeWords: boolean) => boolean;

export interface TextFit {
  /** The size to draw at, in points. */
  pt: number;
  /** True when every word fits on a line at `pt`: draw without breaking inside words. */
  wholeWords: boolean;
}

/** Shrink-to-fit never goes below this share of the set size, or below MIN_FIT_PT. */
export const FIT_FLOOR = 0.3;
export const MIN_FIT_PT = 4;

/**
 * Shrink-to-fit (never grows) for a text box set at `size` points. The text shrinks until it fits
 * the box with every word on one line, so a long word ("Thanksgiving" in a narrow panel) gets
 * smaller type instead of breaking into "Thanksgiv / ing". Only when even the smallest size can't
 * keep a word whole does it fall back to fitting with words broken between letters. With
 * shrink-to-fit off the size stays as set.
 */
export function fitTextSize(size: number, autoFit: boolean, fits: TextFitProbe): TextFit {
  if (fits(size, true)) return { pt: size, wholeWords: true };
  if (!autoFit) return { pt: size, wholeWords: false };
  const floor = Math.max(MIN_FIT_PT, size * FIT_FLOOR);
  const wholeWords = fits(floor, true);
  let lo = floor;
  let hi = size;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid, wholeWords)) lo = mid;
    else hi = mid;
  }
  return { pt: Math.floor(lo * 10) / 10, wholeWords };
}
