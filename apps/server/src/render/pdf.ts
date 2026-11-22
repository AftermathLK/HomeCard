import fsp from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFString, type PDFObject, type PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import type { RenderPageSpec } from '@homecard/shared';
import { findPdfMetadata, scrubPdf } from './privacy';

const PT = 72;

let srgbIcc: Buffer | null = null;
/** The sRGB ICC profile bytes libvips embeds (used for the PDF OutputIntent). */
export async function srgbProfile(): Promise<Buffer> {
  if (!srgbIcc) {
    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).withIccProfile('srgb').png().toBuffer();
    const meta = await sharp(png).metadata();
    if (!meta.icc) throw new Error('Could not obtain sRGB ICC profile from libvips');
    srgbIcc = meta.icc;
  }
  return srgbIcc;
}

/** Merge single-page PDFs (vector content is copied, not re-rendered). */
export async function mergePdfs(buffers: Uint8Array[]): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { updateMetadata: false });
    const [page] = await out.copyPages(src, [0]);
    out.addPage(page);
  }
  return out;
}

function setBoxes(page: PDFPage, spec: RenderPageSpec) {
  const W = spec.widthIn * PT;
  const H = spec.heightIn * PT;
  // Chromium may round the MediaBox by a fraction of a point; force it to the exact spec size.
  page.setMediaBox(0, 0, W, H);
  page.setCropBox(0, 0, W, H);
  const box = (r: { x: number; y: number; w: number; h: number }) => [r.x * PT, H - (r.y + r.h) * PT, r.w * PT, r.h * PT] as const;
  page.setBleedBox(...box(spec.bleed));
  page.setTrimBox(...box(spec.trim));
}

export interface FinalizeOptions {
  title: string;
  pages: RenderPageSpec[];
  /** Omitted when no ICC profile is available (Ghostscript's built-in CMYK conversion). */
  outputIntent?: { icc: Buffer; components: 3 | 4; identifier: string; info: string } | null;
}

/**
 * Page boxes (Trim/Bleed), OutputIntent with the embedded ICC profile, and privacy scrubbing:
 * the document info keeps only the Title. No creation or modification dates, no Creator,
 * Producer or Author tags (Chromium, pdf-lib or Ghostscript), and no XMP packet.
 */
export async function finalizePdf(doc: PDFDocument, o: FinalizeOptions): Promise<Uint8Array> {
  const pages = doc.getPages();
  pages.forEach((p, i) => o.pages[i] && setBoxes(p, o.pages[i]));
  const ctx = doc.context;
  if (o.outputIntent) {
    const iccStream = ctx.flateStream(o.outputIntent.icc, { N: o.outputIntent.components });
    const iccRef = ctx.register(iccStream);
    const intent = ctx.obj({
      Type: 'OutputIntent',
      S: 'GTS_PDFX',
      OutputConditionIdentifier: PDFString.of(o.outputIntent.identifier),
      Info: PDFString.of(o.outputIntent.info),
      RegistryName: PDFString.of('http://www.color.org'),
      DestOutputProfile: iccRef,
    });
    doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
  }
  scrubPdf(doc, o.title);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

/** Read back sizes and boxes from a written PDF for the verification screen. */
export async function inspectPdf(file: string) {
  const bytes = await fsp.readFile(file);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const found = findPdfMetadata(bytes, doc);
  return {
    metadata: { clean: found.length === 0, found },
    pages: pages.length,
    pageSizesIn: pages.map((p) => [Math.round((p.getWidth() / PT) * 1000) / 1000, Math.round((p.getHeight() / PT) * 1000) / 1000] as [number, number]),
    trimBox: pages.every((p) => !!p.node.get(PDFName.of('TrimBox'))),
    bleedBox: pages.every((p) => !!p.node.get(PDFName.of('BleedBox'))),
    fonts: listPdfFonts(doc),
  };
}

/**
 * Every font referenced from page resources (including nested form XObjects), with whether its
 * font program is embedded (FontFile/FontFile2/FontFile3, or Type3 glyph procedures). Lets the
 * Export Verification screen prove that custom fonts went into the PDF as real vector text.
 */
export function listPdfFonts(doc: PDFDocument): Array<{ name: string; embedded: boolean; subtype: string }> {
  const ctx = doc.context;
  const deref = (o: PDFObject | undefined): PDFObject | undefined => (o instanceof PDFRef ? ctx.lookup(o) : o);
  const asDict = (o: PDFObject | undefined) => {
    const d = deref(o);
    return d instanceof PDFDict ? d : undefined;
  };
  const nameOf = (o: PDFObject | undefined) => {
    const d = deref(o);
    return d instanceof PDFName ? d.decodeText() : '';
  };
  const seenFonts = new Set<PDFObject>();
  const seenRes = new Set<PDFObject>();
  const found = new Map<string, { name: string; embedded: boolean; subtype: string }>();

  const hasProgram = (desc: PDFDict | undefined) =>
    !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => !!desc.get(PDFName.of(k)));

  const visitFont = (fontObj: PDFObject | undefined) => {
    const font = asDict(fontObj);
    if (!font || seenFonts.has(font)) return;
    seenFonts.add(font);
    const subtype = nameOf(font.get(PDFName.of('Subtype')));
    let base = nameOf(font.get(PDFName.of('BaseFont'))) || nameOf(font.get(PDFName.of('Name'))) || '(unnamed)';
    let embedded = false;
    if (subtype === 'Type3') embedded = true; // glyphs are drawn by content streams inside the PDF
    else if (subtype === 'Type0') {
      const desc = deref(font.get(PDFName.of('DescendantFonts')));
      const first = desc instanceof PDFArray ? asDict(desc.get(0)) : undefined;
      embedded = hasProgram(asDict(first?.get(PDFName.of('FontDescriptor'))));
    } else embedded = hasProgram(asDict(font.get(PDFName.of('FontDescriptor'))));
    base = base.replace(/^[A-Z]{6}\+/, ''); // drop subset tag "ABCDEF+"
    const key = `${base}|${subtype}`;
    const prev = found.get(key);
    found.set(key, { name: base, subtype, embedded: (prev?.embedded ?? true) && embedded });
  };

  const visitResources = (resObj: PDFObject | undefined) => {
    const res = asDict(resObj);
    if (!res || seenRes.has(res)) return;
    seenRes.add(res);
    const fonts = asDict(res.get(PDFName.of('Font')));
    if (fonts) for (const [, f] of fonts.entries()) visitFont(f);
    const xobjects = asDict(res.get(PDFName.of('XObject')));
    if (xobjects)
      for (const [, x] of xobjects.entries()) {
        const stream = deref(x) as any;
        const dict: PDFDict | undefined = stream?.dict instanceof PDFDict ? stream.dict : undefined;
        if (dict && nameOf(dict.get(PDFName.of('Subtype'))) === 'Form') visitResources(dict.get(PDFName.of('Resources')));
      }
  };

  for (const page of doc.getPages()) visitResources(page.node.get(PDFName.of('Resources')) ?? page.node.Resources());
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
