import { PDFDict, PDFName, PDFRef, PDFString, type PDFDocument } from 'pdf-lib';

/**
 * Metadata scrubbing for everything HomeCard hands to a print shop.
 *
 * JPEG: keeps only what printing needs — JFIF (APP0: pixel density), the ICC profile (APP2) and
 *       Adobe (APP14: colour transform). Drops EXIF (GPS, camera serials, timestamps, software),
 *       XMP, IPTC/Photoshop (APP13), every other APPn and comments.
 * PNG:  keeps image data, pHYs (DPI), iCCP/sRGB/gAMA/cHRM. Drops eXIf, tEXt/zTXt/iTXt, tIME.
 * PDF:  document info reduced to the Title; no dates, Creator, Producer or Author; no XMP stream.
 *
 * The find* functions read a finished file back for the Export Verification screen.
 */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function isJpeg(b: Buffer) {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
}
function isPng(b: Buffer) {
  return b.length > 8 && b.subarray(0, 8).equals(PNG_SIG);
}

interface Segment {
  marker: number;
  start: number;
  end: number;
}

/** Marker segments between SOI and SOS (where metadata lives). */
function jpegSegments(b: Buffer): { segments: Segment[]; sos: number } {
  const segments: Segment[] = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('Corrupt JPEG marker stream');
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1];
    }
    if (marker === 0xda) return { segments, sos: i };
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    segments.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return { segments, sos: b.length };
}

function jpegSegmentKind(b: Buffer, s: Segment): string | null {
  const payload = b.subarray(s.start + 4, Math.min(s.end, s.start + 40)).toString('latin1');
  if (s.marker === 0xe1) return payload.startsWith('Exif') ? 'EXIF' : payload.startsWith('http://ns.adobe.com/xap/') ? 'XMP' : 'APP1';
  if (s.marker === 0xed) return 'IPTC';
  if (s.marker === 0xfe) return 'Comment';
  if (s.marker >= 0xe3 && s.marker <= 0xef && s.marker !== 0xee) return `APP${s.marker - 0xe0}`;
  return null;
}

/**
 * libvips records the print resolution in EXIF (and leaves JFIF at 72), so after EXIF is removed
 * the DPI is written into the JFIF header instead — print shops read it from there.
 */
export function scrubJpeg(b: Buffer, dpi?: number): Buffer {
  if (!isJpeg(b)) return b;
  const d = dpi && dpi > 0 && dpi < 65536 ? Math.round(dpi) : 0;
  const { segments, sos } = jpegSegments(b);
  const keep: Buffer[] = [b.subarray(0, 2)];
  let hasJfif = false;
  for (const s of segments) {
    if (jpegSegmentKind(b, s)) continue;
    let seg = b.subarray(s.start, s.end);
    if (s.marker === 0xe0 && seg.length >= 16 && seg.toString('latin1', 4, 9) === 'JFIF\0') {
      hasJfif = true;
      if (d) {
        seg = Buffer.from(seg);
        seg[11] = 1; // units: dots per inch
        seg.writeUInt16BE(d, 12);
        seg.writeUInt16BE(d, 14);
      }
    }
    keep.push(seg);
  }
  if (!hasJfif && d) keep.splice(1, 0, Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, d >> 8, d & 0xff, d >> 8, d & 0xff, 0x00, 0x00]));
  keep.push(b.subarray(sos));
  return Buffer.concat(keep);
}

function pngChunks(b: Buffer) {
  const out: Array<{ type: string; start: number; end: number }> = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString('latin1', i + 4, i + 8);
    out.push({ type, start: i, end: i + 12 + len });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

export function scrubPng(b: Buffer): Buffer {
  if (!isPng(b)) return b;
  const parts: Buffer[] = [b.subarray(0, 8)];
  for (const c of pngChunks(b)) if (!PNG_DROP.has(c.type)) parts.push(b.subarray(c.start, c.end));
  return Buffer.concat(parts);
}

export function scrubImage(b: Buffer, dpi?: number): Buffer {
  return isJpeg(b) ? scrubJpeg(b, dpi) : isPng(b) ? scrubPng(b) : b;
}

/** What privacy-relevant metadata a JPEG/PNG still contains (empty = clean). */
export function findImageMetadata(b: Buffer): string[] {
  const found = new Set<string>();
  if (isJpeg(b)) {
    const { segments } = jpegSegments(b);
    for (const s of segments) {
      const k = jpegSegmentKind(b, s);
      if (k) found.add(k);
    }
  } else if (isPng(b)) {
    for (const c of pngChunks(b)) if (PNG_DROP.has(c.type)) found.add(c.type === 'eXIf' ? 'EXIF' : c.type === 'tIME' ? 'PNG timestamp' : 'PNG text');
  }
  return [...found];
}

/* ---------------- PDF ---------------- */

/**
 * Reduce document info to the title and remove XMP metadata streams.
 * pdf-lib writes every registered object, referenced or not, so the old objects are edited in place
 * or deleted from the context. Re-pointing at fresh objects would leave the originals in the file.
 * Load documents with `{ updateMetadata: false }` and call this right before `save()`.
 */
export function scrubPdf(doc: PDFDocument, title: string) {
  const ctx = doc.context;
  const infoRef = ctx.trailerInfo.Info;
  const existing = infoRef ? ctx.lookup(infoRef) : undefined;
  if (existing instanceof PDFDict) {
    for (const key of existing.keys()) existing.delete(key);
    existing.set(PDFName.of('Title'), PDFString.of(title.slice(0, 120)));
  } else {
    ctx.trailerInfo.Info = ctx.register(ctx.obj({ Title: PDFString.of(title.slice(0, 120)) }));
  }
  const dropMetadata = (dict: PDFDict) => {
    const m = dict.get(PDFName.of('Metadata'));
    if (m instanceof PDFRef) ctx.delete(m);
    dict.delete(PDFName.of('Metadata'));
  };
  dropMetadata(doc.catalog);
  for (const page of doc.getPages()) dropMetadata(page.node);
  // Any other stray XMP packet (e.g. on a Ghostscript-converted image) goes too.
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : (obj as any)?.dict instanceof PDFDict ? ((obj as any).dict as PDFDict) : null;
    if (!dict) continue;
    if (dict.get(PDFName.of('Type')) === PDFName.of('Metadata')) ctx.delete(ref);
    else if (dict.has(PDFName.of('Metadata'))) dropMetadata(dict);
  }
}

const EXIF_IN_STREAM = Buffer.from('Exif\0\0', 'latin1');
const XMP_IN_STREAM = Buffer.from('<x:xmpmeta', 'latin1');

export function findPdfMetadata(bytes: Uint8Array, doc: PDFDocument): string[] {
  const found: string[] = [];
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef) : undefined;
  if (info instanceof PDFDict) {
    for (const key of info.keys()) {
      const k = key.decodeText();
      if (k !== 'Title') found.push(`PDF ${k}`);
    }
  }
  const raw = Buffer.from(bytes);
  if (doc.catalog.get(PDFName.of('Metadata')) || raw.includes(XMP_IN_STREAM)) found.push('XMP');
  if (raw.includes(EXIF_IN_STREAM)) found.push('EXIF in an embedded image');
  return found;
}
