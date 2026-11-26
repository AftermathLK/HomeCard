import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyTemplate,
  BUILTIN_TEMPLATES,
  createProject,
  fitTextSize,
  GREETING_STYLES,
  MM_PER_IN,
  OCCASIONS,
  resolveTokens,
  textFont,
  type CardProject,
  type NewProjectOptions,
  type SurfaceId,
  type TextElement,
} from '../src/index';
import { FIT_SLACK_PT, layOut } from './textLayout';

const FORMATS: Array<{ name: string; opts: Pick<NewProjectOptions, 'sizeId' | 'orientation' | 'customW' | 'customH'> }> = [
  { name: '7 × 5" landscape', opts: { sizeId: '5x7', orientation: 'landscape' } },
  { name: '155 × 110 mm', opts: { sizeId: 'custom', customW: 155 / MM_PER_IN, customH: 110 / MM_PER_IN } },
  { name: '8 × 4" landscape', opts: { sizeId: '4x8', orientation: 'landscape' } },
  { name: 'A6 landscape', opts: { sizeId: 'a6', orientation: 'landscape' } },
  { name: '5 × 5" square', opts: { sizeId: '5x5' } },
  { name: '150 mm square', opts: { sizeId: 'sq150' } },
  { name: '5 × 7" portrait', opts: { sizeId: '5x7', orientation: 'portrait' } },
];

const SURFACES_FOR_KIND: Record<string, SurfaceId[]> = { front: ['front'], back: ['back'], inside: ['inside-left', 'inside-right'] };

/** Settles one text element's size the way the card renderer does, from real glyph widths. */
function fitElement(project: CardProject, el: TextElement) {
  const text = resolveTokens(el.text, project);
  const font = textFont(el, project.theme);
  const laid = layOut(text, font, { wIn: el.w, hIn: el.h, lineHeight: el.lineHeight });
  const fit = fitTextSize(font.size, el.autoFit, laid.fits);
  const widest = laid.words.reduce((a, w) => (laid.wordWidth(w, fit.pt) > laid.wordWidth(a, fit.pt) ? w : a), '');
  return { text, font, fit, widest, widestPt: laid.wordWidth(widest, fit.pt), boxPt: el.w * 72 };
}

test('the default Thanksgiving card at 7 × 5" landscape keeps “Thanksgiving” whole', () => {
  const project = createProject({ occasionId: 'thanksgiving', greetingStyle: 'warm', sizeId: '5x7', orientation: 'landscape' });
  const front = project.surfaces.find((s) => s.id === 'front')!;
  assert.equal(front.templateId, 'split-third-band');
  const headline = front.elements.find((e): e is TextElement => e.type === 'text' && e.role === 'headline')!;
  const r = fitElement(project, headline);
  assert.equal(r.text, 'Happy Thanksgiving');
  assert.equal(r.widest, 'Thanksgiving');
  assert.ok(r.widestPt <= r.boxPt + FIT_SLACK_PT, `“Thanksgiving” is ${(r.widestPt / 72).toFixed(2)}" wide at ${r.fit.pt}pt in a ${headline.w.toFixed(2)}" box`);
  assert.ok(r.fit.wholeWords, 'drawn without breaking inside words');
  assert.ok(r.fit.pt < headline.fontSize, 'the headline shrinks to fit');
});

test('every built-in template fits its longest word on one line, in landscape, square and portrait', () => {
  const problems: string[] = [];
  let checked = 0;
  for (const fmt of FORMATS)
    for (const occ of OCCASIONS)
      for (const { id: style } of GREETING_STYLES) {
        const project = createProject({ occasionId: occ.id, greetingStyle: style, fold: 'folded', ...fmt.opts });
        for (const tpl of BUILTIN_TEMPLATES)
          for (const kind of tpl.kinds)
            for (const sid of SURFACES_FOR_KIND[kind]) {
              const surface = applyTemplate(project, sid, tpl.id, { resetText: true });
              for (const el of surface.elements) {
                if (el.type !== 'text') continue;
                const r = fitElement(project, el);
                if (!r.widest) continue;
                checked++;
                if (r.widestPt > r.boxPt + FIT_SLACK_PT)
                  problems.push(
                    `${tpl.id} · ${fmt.name} · ${occ.id}/${style} · ${sid} ${el.role}: “${r.widest}” is ${(r.widestPt / 72).toFixed(2)}" wide at ${r.fit.pt}pt ` +
                      `(${r.font.family}) in a ${el.w.toFixed(2)}" box`,
                  );
              }
            }
      }
  assert.ok(checked > 10000, `checked ${checked} text boxes`);
  assert.equal(problems.length, 0, `${problems.length} text boxes break a word across lines:\n${[...new Set(problems)].slice(0, 25).join('\n')}`);
});

test('shrink-to-fit keeps words whole, and breaks a word only when nothing else fits', () => {
  // A box 100pt wide and 60pt tall holding one 10-em word: it fits whole at 10pt and below.
  const probe = (wordEm: number) => (pt: number, wholeWords: boolean) => {
    const lines = wholeWords ? (wordEm * pt <= 100 ? 1 : Infinity) : Math.ceil((wordEm * pt) / 100);
    return lines * pt <= 60;
  };
  const roomy = fitTextSize(20, true, probe(10));
  assert.ok(roomy.wholeWords);
  assert.ok(roomy.pt <= 10 && roomy.pt > 9.8, `fitted ${roomy.pt}pt`);
  assert.deepEqual(fitTextSize(8, true, probe(10)), { pt: 8, wholeWords: true }, 'text that already fits keeps its size');
  // A 50-em word would need 2pt: below the floor, so it falls back to breaking between letters.
  const tight = fitTextSize(20, true, probe(50));
  assert.equal(tight.wholeWords, false);
  assert.ok(tight.pt >= 6, 'never below the floor');
  // Shrink-to-fit off: the size is kept, and the word may break.
  assert.deepEqual(fitTextSize(20, false, probe(10)), { pt: 20, wholeWords: false });
});
