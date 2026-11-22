// Copies the bundled SIL-OFL fonts (latin + latin-ext subsets, woff2) from @fontsource packages
// into apps/server/assets/fonts and writes manifest.json. Run with: node --import tsx scripts/collect-fonts.mjs
// (tsx lets us import the single source of truth list from packages/shared).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { BUNDLED_FONTS } = await import(pathToFileURL(path.join(root, 'packages/shared/src/fonts.ts')).href);

const outDir = path.join(root, 'apps/server/assets/fonts');
const filesDir = path.join(outDir, 'files');
const licDir = path.join(outDir, 'licenses');
fs.mkdirSync(filesDir, { recursive: true });
fs.mkdirSync(licDir, { recursive: true });

const SUBSETS = new Set(['latin', 'latin-ext']);
const faces = [];
let copied = 0;

for (const font of BUNDLED_FONTS) {
  const pkgDir = path.dirname(require.resolve(`${font.pkg}/package.json`));
  const styles = font.italics ? ['normal', 'italic'] : ['normal'];
  for (const weight of font.weights) {
    for (const style of styles) {
      const cssFile = path.join(pkgDir, style === 'italic' ? `${weight}-italic.css` : `${weight}.css`);
      if (!fs.existsSync(cssFile)) {
        console.warn(`  ! ${font.family} ${weight} ${style}: ${path.basename(cssFile)} missing — skipped`);
        continue;
      }
      const css = fs.readFileSync(cssFile, 'utf8');
      const blocks = css.split('@font-face').slice(1);
      for (const block of blocks) {
        const url = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
        if (!url) continue;
        // file name pattern: <slug>-<subset>-<weight>-<style>.woff2
        const m = new RegExp(`-(${[...SUBSETS].join('|')})-${weight}-${style}\\.woff2$`).exec(url);
        if (!m) continue;
        const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
        const src = path.join(pkgDir, 'files', url);
        const dest = path.join(filesDir, url);
        if (!fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size) {
          fs.copyFileSync(src, dest);
          copied++;
        }
        faces.push({ family: font.family, weight, style, file: url, unicodeRange: range });
      }
    }
  }
  const lic = path.join(pkgDir, 'LICENSE');
  if (fs.existsSync(lic)) fs.copyFileSync(lic, path.join(licDir, `${font.family.replace(/\s+/g, '-')}.txt`));
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), faces }, null, 1));
console.log(`collect-fonts: ${BUNDLED_FONTS.length} families, ${faces.length} faces (${copied} files copied) -> ${path.relative(root, outDir)}`);
