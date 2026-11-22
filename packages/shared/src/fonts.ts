import type { FontSpec, Theme } from './types';

export type FontCategory = 'serif' | 'script' | 'sans' | 'display' | 'handwritten';

export interface BundledFont {
  family: string;
  /** npm package that ships the OFL font files (copied at build time). */
  pkg: string;
  category: FontCategory;
  weights: number[];
  italics: boolean;
  description: string;
}

/** Open-source (SIL OFL) fonts bundled into the image — served locally, never from a CDN. */
export const BUNDLED_FONTS: BundledFont[] = [
  { family: 'Playfair Display', pkg: '@fontsource/playfair-display', category: 'serif', weights: [400, 600, 700, 900], italics: true, description: 'High-contrast editorial serif' },
  { family: 'Cormorant Garamond', pkg: '@fontsource/cormorant-garamond', category: 'serif', weights: [400, 500, 600, 700], italics: true, description: 'Delicate, elegant Garamond' },
  { family: 'Lora', pkg: '@fontsource/lora', category: 'serif', weights: [400, 500, 600, 700], italics: true, description: 'Warm, readable book serif' },
  { family: 'EB Garamond', pkg: '@fontsource/eb-garamond', category: 'serif', weights: [400, 500, 600, 700], italics: true, description: 'Classic old-style serif' },
  { family: 'DM Serif Display', pkg: '@fontsource/dm-serif-display', category: 'serif', weights: [400], italics: true, description: 'Bold modern serif headlines' },
  { family: 'Cinzel', pkg: '@fontsource/cinzel', category: 'display', weights: [400, 600, 700], italics: false, description: 'Engraved Roman capitals' },
  { family: 'Abril Fatface', pkg: '@fontsource/abril-fatface', category: 'display', weights: [400], italics: false, description: 'Festive heavy display serif' },
  { family: 'Mountains of Christmas', pkg: '@fontsource/mountains-of-christmas', category: 'display', weights: [400, 700], italics: false, description: 'Whimsical holiday display' },
  { family: 'Bebas Neue', pkg: '@fontsource/bebas-neue', category: 'display', weights: [400], italics: false, description: 'Tall condensed poster caps' },
  { family: 'Great Vibes', pkg: '@fontsource/great-vibes', category: 'script', weights: [400], italics: false, description: 'Flowing formal script' },
  { family: 'Dancing Script', pkg: '@fontsource/dancing-script', category: 'script', weights: [400, 600, 700], italics: false, description: 'Lively casual script' },
  { family: 'Parisienne', pkg: '@fontsource/parisienne', category: 'script', weights: [400], italics: false, description: 'Chic French script' },
  { family: 'Pinyon Script', pkg: '@fontsource/pinyon-script', category: 'script', weights: [400], italics: false, description: 'Copperplate calligraphy' },
  { family: 'Sacramento', pkg: '@fontsource/sacramento', category: 'script', weights: [400], italics: false, description: 'Thin monoline script' },
  { family: 'Caveat', pkg: '@fontsource/caveat', category: 'handwritten', weights: [400, 600, 700], italics: false, description: 'Natural handwriting' },
  { family: 'Amatic SC', pkg: '@fontsource/amatic-sc', category: 'handwritten', weights: [400, 700], italics: false, description: 'Hand-drawn condensed caps' },
  { family: 'Montserrat', pkg: '@fontsource/montserrat', category: 'sans', weights: [300, 400, 500, 600, 700], italics: true, description: 'Geometric modern sans' },
  { family: 'Josefin Sans', pkg: '@fontsource/josefin-sans', category: 'sans', weights: [300, 400, 600, 700], italics: true, description: 'Vintage geometric sans' },
  { family: 'Raleway', pkg: '@fontsource/raleway', category: 'sans', weights: [300, 400, 500, 600, 700], italics: true, description: 'Elegant thin-to-bold sans' },
  { family: 'Work Sans', pkg: '@fontsource/work-sans', category: 'sans', weights: [300, 400, 500, 600], italics: true, description: 'Clean, friendly grotesque' },
  { family: 'Nunito', pkg: '@fontsource/nunito', category: 'sans', weights: [300, 400, 600, 700], italics: true, description: 'Soft rounded sans' },
];

export interface FontPairing {
  id: string;
  name: string;
  mood: string;
  display: FontSpec;
  body: FontSpec;
  accent: FontSpec;
}

const f = (family: string, weight = 400, extra: Partial<FontSpec> = {}): FontSpec => ({
  family,
  weight,
  style: 'normal',
  letterSpacing: 0,
  transform: 'none',
  ...extra,
});

/** Designer pairings: display (greeting), body (messages) and accent (names / year / labels). */
export const FONT_PAIRINGS: FontPairing[] = [
  { id: 'script-sans', name: 'Playful Script + Clean Sans', mood: 'Warm & modern', display: f('Great Vibes'), body: f('Montserrat', 400), accent: f('Montserrat', 500, { letterSpacing: 0.22, transform: 'uppercase' }) },
  { id: 'editorial', name: 'Editorial Serif + Minimal Sans', mood: 'Magazine cover', display: f('Playfair Display', 400, { style: 'italic' }), body: f('Work Sans', 400), accent: f('Work Sans', 500, { letterSpacing: 0.25, transform: 'uppercase' }) },
  { id: 'festive-bold', name: 'Festive Bold + Classic Serif', mood: 'Bold & joyful', display: f('Abril Fatface'), body: f('Lora', 400), accent: f('Lora', 500, { style: 'italic' }) },
  { id: 'romantic', name: 'Romantic Calligraphy', mood: 'Formal & elegant', display: f('Pinyon Script'), body: f('Cormorant Garamond', 500), accent: f('Cormorant Garamond', 600, { letterSpacing: 0.2, transform: 'uppercase' }) },
  { id: 'engraved', name: 'Classic Engraved', mood: 'Timeless & stately', display: f('Cinzel', 600, { letterSpacing: 0.08 }), body: f('EB Garamond', 400), accent: f('EB Garamond', 500, { style: 'italic' }) },
  { id: 'modern-minimal', name: 'Modern Minimal', mood: 'Clean & airy', display: f('Josefin Sans', 300, { letterSpacing: 0.18, transform: 'uppercase' }), body: f('Raleway', 400), accent: f('Raleway', 600, { letterSpacing: 0.3, transform: 'uppercase' }) },
  { id: 'cozy-handwritten', name: 'Cozy Handwritten', mood: 'Personal & relaxed', display: f('Caveat', 700), body: f('Nunito', 400), accent: f('Nunito', 600, { letterSpacing: 0.12, transform: 'uppercase' }) },
  { id: 'whimsical', name: 'Whimsical Holiday', mood: 'Fun & festive', display: f('Mountains of Christmas', 700), body: f('Nunito', 400), accent: f('Nunito', 700, { letterSpacing: 0.15, transform: 'uppercase' }) },
  { id: 'poster', name: 'Bold Poster', mood: 'Graphic & confident', display: f('Bebas Neue', 400, { letterSpacing: 0.06 }), body: f('Lora', 400), accent: f('Lora', 400, { style: 'italic' }) },
  { id: 'signature', name: 'Signature Monoline', mood: 'Light & graceful', display: f('Sacramento'), body: f('Montserrat', 300), accent: f('Montserrat', 600, { letterSpacing: 0.28, transform: 'uppercase' }) },
  { id: 'lively', name: 'Lively Script + Rounded Sans', mood: 'Cheerful', display: f('Dancing Script', 700), body: f('Nunito', 400), accent: f('Nunito', 700, { letterSpacing: 0.14, transform: 'uppercase' }) },
  { id: 'parisian', name: 'Parisian Chic', mood: 'Chic & romantic', display: f('Parisienne'), body: f('DM Serif Display', 400), accent: f('Raleway', 500, { letterSpacing: 0.25, transform: 'uppercase' }) },
  { id: 'craft-market', name: 'Craft Market', mood: 'Rustic & handmade', display: f('Amatic SC', 700, { letterSpacing: 0.04 }), body: f('Josefin Sans', 400), accent: f('Josefin Sans', 600, { letterSpacing: 0.2, transform: 'uppercase' }) },
  { id: 'serif-classic', name: 'Bold Serif Classic', mood: 'Confident & classic', display: f('DM Serif Display'), body: f('Lora', 400), accent: f('Montserrat', 500, { letterSpacing: 0.22, transform: 'uppercase' }) },
];

export function getPairing(id: string | undefined): FontPairing {
  return FONT_PAIRINGS.find((p) => p.id === id) ?? FONT_PAIRINGS[0];
}

export function applyPairing(theme: Theme, pairingId: string): Theme {
  const p = getPairing(pairingId);
  return { ...theme, pairingId: p.id, fonts: { display: { ...p.display }, body: { ...p.body }, accent: { ...p.accent } } };
}

/** CSS font-family stack with safe fallbacks. */
export function fontStack(family: string): string {
  const generic = BUNDLED_FONTS.find((b) => b.family === family)?.category;
  const fallback =
    generic === 'script' || generic === 'handwritten'
      ? 'cursive'
      : generic === 'sans'
        ? 'sans-serif'
        : 'serif';
  return `"${family.replace(/"/g, '')}", ${fallback}`;
}
