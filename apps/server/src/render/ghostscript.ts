import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { ensureDir, exists } from '../util/fsx';

const run = promisify(execFile);

/**
 * Ghostscript is used for two things the browser cannot do:
 *   1. Convert the vector PDF to DeviceCMYK through a CMYK ICC profile (commercial print shops).
 *   2. Rasterize finished PDFs at 300 DPI so the Export Verification screen shows the PDF itself.
 */

let gsBin: string | null | undefined;
let gsVersion: string | undefined;

export async function ghostscript(): Promise<{ bin: string; version: string } | null> {
  if (gsBin === undefined) {
    const candidates = [config.ghostscriptPath, 'gs', 'gswin64c', 'gswin32c'].filter(Boolean);
    if (process.platform === 'win32') {
      for (const base of ['C:/Program Files/gs', 'C:/Program Files (x86)/gs']) {
        for (const d of await fsp.readdir(base).catch(() => [] as string[])) candidates.push(path.join(base, d, 'bin', 'gswin64c.exe'));
      }
    }
    gsBin = null;
    for (const c of candidates) {
      try {
        const { stdout } = await run(c, ['--version'], { timeout: 10_000, windowsHide: true });
        gsBin = c;
        gsVersion = stdout.trim();
        break;
      } catch {
        /* try next */
      }
    }
  }
  return gsBin ? { bin: gsBin, version: gsVersion ?? '' } : null;
}

export interface IccProfileInfo {
  id: string;
  name: string;
  colorSpace: 'cmyk' | 'rgb';
  path: string;
}

/** CMYK profiles: user-supplied (/data/config/icc/*.icc|icm) first, then the Ghostscript default. */
export async function iccProfiles(): Promise<IccProfileInfo[]> {
  const out: IccProfileInfo[] = [];
  const userDir = path.join(config.dirs.config, 'icc');
  await ensureDir(userDir).catch(() => {});
  for (const f of await fsp.readdir(userDir).catch(() => [] as string[])) {
    if (!/\.(icc|icm)$/i.test(f)) continue;
    const abs = path.join(userDir, f);
    const head = await fsp.readFile(abs).then((b) => b.subarray(0, 24)).catch(() => null);
    if (!head) continue;
    const cs = head.subarray(16, 20).toString('latin1');
    out.push({ id: `user:${f}`, name: f.replace(/\.(icc|icm)$/i, ''), colorSpace: cs === 'CMYK' ? 'cmyk' : 'rgb', path: abs });
  }
  const builtins = [
    '/usr/share/color/icc/ghostscript/default_cmyk.icc',
    '/usr/share/ghostscript/iccprofiles/default_cmyk.icc',
    '/usr/local/share/ghostscript/iccprofiles/default_cmyk.icc',
  ];
  const gs = await ghostscript();
  if (gs && process.platform === 'win32') {
    const root = path.resolve(path.dirname(gs.bin), '..');
    builtins.push(path.join(root, 'iccprofiles', 'default_cmyk.icc'));
  }
  for (const b of builtins) {
    if (await exists(b)) {
      out.push({ id: 'gs:default_cmyk', name: 'Ghostscript default CMYK (SWOP-like)', colorSpace: 'cmyk', path: b });
      break;
    }
  }
  return out;
}

export async function resolveCmykProfile(id?: string | null): Promise<IccProfileInfo | null> {
  const list = (await iccProfiles()).filter((p) => p.colorSpace === 'cmyk');
  return (id && list.find((p) => p.id === id)) || list[0] || null;
}

/** Convert an RGB PDF to DeviceCMYK. Images are kept at full resolution (no downsampling) and compressed losslessly. */
export async function convertPdfToCmyk(input: string, output: string, profile: IccProfileInfo | null) {
  const gs = await ghostscript();
  if (!gs) throw new Error('Ghostscript is not installed — CMYK PDF export needs it (included in the Docker image).');
  const args = [
    '-dSAFER',
    '-dBATCH',
    '-dNOPAUSE',
    '-dQUIET',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.6',
    '-sColorConversionStrategy=CMYK',
    '-sProcessColorModel=DeviceCMYK',
    '-dOverrideICC=true',
    '-dRenderIntent=1', // relative colorimetric
    '-dEmbedAllFonts=true',
    '-dSubsetFonts=true',
    '-dDownsampleColorImages=false',
    '-dDownsampleGrayImages=false',
    '-dDownsampleMonoImages=false',
    '-dAutoFilterColorImages=false',
    '-dAutoFilterGrayImages=false',
    '-dColorImageFilter=/FlateEncode',
    '-dGrayImageFilter=/FlateEncode',
    '-dPreserveHalftoneInfo=false',
    '-dDetectDuplicateImages=true',
  ];
  if (profile) args.push(`-sOutputICCProfile=${profile.path}`);
  args.push(`-sOutputFile=${output}`, input);
  await run(gs.bin, args, { timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
}

/** Rasterize each page of a PDF to PNG at `dpi`. Returns file paths in page order. */
export async function rasterizePdf(input: string, outDir: string, stem: string, dpi = 300): Promise<string[]> {
  const gs = await ghostscript();
  if (!gs) return [];
  await ensureDir(outDir);
  const pattern = path.join(outDir, `${stem}-%03d.png`);
  await run(
    gs.bin,
    ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=png16m', `-r${dpi}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-dUseCropBox=false', `-sOutputFile=${pattern}`, input],
    { timeout: 10 * 60_000, windowsHide: true },
  );
  const files = (await fsp.readdir(outDir)).filter((f) => f.startsWith(`${stem}-`) && f.endsWith('.png')).sort();
  return files.map((f) => path.join(outDir, f));
}
