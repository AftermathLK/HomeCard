// Copies the local face-detection model (SSD MobileNet v1, ~5.6 MB) into the web app's public folder
// so face-aware cropping works fully offline for photos that do not come from Immich.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const pkgDir = path.dirname(require.resolve('@vladmandic/face-api/package.json'));
const outDir = path.join(root, 'apps/web/public/vendor/face-api');
fs.mkdirSync(outDir, { recursive: true });

const files = ['ssd_mobilenetv1_model-weights_manifest.json', 'ssd_mobilenetv1_model.bin'];
for (const f of files) fs.copyFileSync(path.join(pkgDir, 'model', f), path.join(outDir, f));
fs.copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'LICENSE.txt'));
console.log(`collect-vendor: face-api model -> ${path.relative(root, outDir)}`);
