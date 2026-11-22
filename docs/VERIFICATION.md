# Verification checklist

Run through this list after installing or updating HomeCard. It proves three things:

* HomeCard can reach Immich (read-only, with your own key).
* Custom fonts render and are embedded in the print files.
* The print files really are 300 DPI, the right size, and free of metadata.

The security checks (sign-in wall, lockout, CSRF, isolation between users, read-only Immich
keys, container hardening) are in [SECURITY.md → Security verification](SECURITY.md#3-security-verification).

Each step says what to do and what you should see. Steps marked 🔧 are optional
command-line checks for people who want to inspect the files with independent tools.

**Tools for the 🔧 checks** (install on any computer that can reach the export folder):

* [ExifTool](https://exiftool.org)
* ImageMagick (`magick`)
* Poppler's `pdfinfo` / `pdffonts`

  | OS | Install |
  |---|---|
  | macOS | `brew install poppler` |
  | Debian/Ubuntu | `apt install poppler-utils` |
  | Windows | ships with *Git for Windows*, or use the Poppler binaries |

Ghostscript is already inside the HomeCard container (`docker exec homecard gs …`).

Exports are saved per user in `/data/exports/<userId>/<card-name>/<date>_<time>_<format>/`, for example
`homecard-data/exports/u_3f2a…/our-christmas-card/2026-11-22_101530_pdf/`.

---

## 0. Health

| ✓ | Step | Expected |
|---|---|---|
| ☐ | `docker compose ps` | `homecard` shows **healthy** about 20 s after start |
| ☐ | Open `http://<server>:8787` | First start: *Set up HomeCard* (create the admin). Afterwards: the sign-in page, then *Your cards*. |
| ☐ | **Your name → Fonts, styles & printing → System** | Renderer: *Chromium …* ✓. Ghostscript: version ✓. HEIC: ✓. Admins also see the data folders under `/data/…` |
| ☐ | 🔧 `curl -s http://<server>:8787/health` | `{"status":"ok"}` and nothing else. (`/api/health` needs a signed-in session.) |
| ☐ | **Settings → Style packs** | Four packs (*Classic Paper*, *Gilded Holiday*, *Spring Garden*, *Winter Woodland*), each with counts and **no** red error lines |
| ☐ | **Settings → Fonts** | 21 built-in families listed |

## 1. Immich connectivity

| ✓ | Step | Expected |
|---|---|---|
| ☐ | Admin: **Server settings** → Immich server address (or `IMMICH_URL`) | Saved; the address shows on everyone's Immich connection screen |
| ☐ | **Your name → Immich connection**: follow the checklist, paste a read-only key, **Check key** | ✓ *Immich accepted the key for <you>. It is read-only.* |
| ☐ | Try a key with **all** permissions | Refused: *This key can change your photo library — HomeCard won't save it*, with the dangerous permissions listed. **Save** stays disabled. |
| ☐ | Enter a wrong key and check again | A clear message that Immich didn't accept the key, not a spinner that never ends |
| ☐ | Save the read-only key | *Linked as <you> · key ••••abcd*, the permission list and *Immich confirmed this key is read-only* |
| ☐ | 🔧 Browser dev tools → Network → `/api/me/immich` | Only `keyLast4`, permissions and status. **The key itself never appears.** |
| ☐ | New card → after choosing the occasion, the photo picker opens on **Immich** | Tabs: Albums, People and Years, plus *Favorites* and the search box. Album covers and counts load. |
| ☐ | Open an album, a person, and a year | Photos page in as you scroll. Selected photos get a ✓, and the footer counts them. |
| ☐ | Search `beach` (or any word in your library) | Smart Search (CLIP) results. Without machine learning, filename and metadata matches. |
| ☐ | Pick 2–3 photos with people, including an iPhone **HEIC** if you have one, and click **Add 3 photos** | The photos drop into the empty frames in the order you picked them. Faces are framed well (smart crop uses Immich's face boxes). HEIC shows normally. |
| ☐ | Browser dev tools → Network while browsing | Every request goes to `/api/immich/…` or `/api/media/…` on HomeCard. None goes to the Immich host, and none carries an `x-api-key` header. |
| ☐ | Export a PNG (section 3), then open the **Photo resolution** table on the verification screen | Each Immich photo says **original file · 4,032 px wide** (your camera's real width), not a preview size of 1,440 px |

## 2. Custom font rendering

Use any font you're licensed to use. A free OFL font works well, for example *Lobster* or
*Pacifico* from Google Fonts. Use the `.ttf` file.

| ✓ | Step | Expected |
|---|---|---|
| ☐ | **Settings → Fonts → Upload fonts** and pick the `.ttf`. You can also copy it into `/data/fonts`. | Within a few seconds it appears under *Your fonts* with its weights. No restart needed. |
| ☐ | In the editor, select the greeting → Inspector → **Font** | The family is listed with a ★ and the text redraws in it immediately |
| ☐ | Studio → **Style → Fonts** | Fine-tune lists the new family for every role |
| ☐ | Print Guardian | Green or yellow. No *Font "…" is not installed* issue. |
| ☐ | **Export → PDF** | The verification screen shows ✓ *Verified* and **Fonts in this PDF: Lobster ✓, …** (✓ means the font program is embedded) |
| ☐ | Open the PDF in a viewer and select or search the greeting text | The text is selectable and searchable, so it's real text, not a picture. Zoomed to 3200%, the letter edges stay perfectly sharp (vector). |
| ☐ | 🔧 `pdffonts card.pdf` | Your font listed with `emb yes`. The name may carry a subset prefix such as `ABCDEF+Lobster-Regular`. |
| ☐ | Export a PNG and open it in the **100% pixels** viewer | The custom font renders crisply at the printed size |
| ☐ | Delete the font file from `/data/fonts`, then return to the editor | The Print Guardian turns **red**: *Font "Lobster" is not installed*, with a *Change font* fix |

## 3. True 300 DPI print output

Expected sizes at 300 DPI (pixels = inches × 300):

| Card | Page exported | Pixels |
|---|---|---|
| 5×7 flat, 0.125″ bleed | 5.25 × 7.25″ | **1575 × 2175** |
| 5×7 flat, no bleed (photo-lab preset) | 5 × 7″ | 1500 × 2100 |
| 5×7 flat, bleed + crop marks | 5.9 × 7.9″ | 1770 × 2370 |
| 4×8, bleed | 4.25 × 8.25″ | 1275 × 2475 |
| 5×5, bleed | 5.25 × 5.25″ | 1575 × 1575 |
| A2 (4.25×5.5), bleed | 4.5 × 5.75″ | 1350 × 1725 |
| 6×8, bleed | 6.25 × 8.25″ | 1875 × 2475 |
| 5×7 **folded**, spread (back + front), bleed | 10.25 × 7.25″ | **3075 × 2175** |

Vistaprint's preset uses 0.105″ bleed, so its pages are slightly smaller. The export dialog's
**You'll get** line always shows the exact numbers before you export.

### PNG / JPEG

| ✓ | Step | Expected |
|---|---|---|
| ☐ | Make a 5×7 flat card with the *Generic 300 DPI* preset → **Export → PNG** (bleed on) | **You'll get** said *1575 × 2175 px* before exporting. The verification screen shows **1575 × 2175 px @ 300 DPI**, *5.25 × 7.25 in*, *sRGB*. The line *Read back from file: 1575×2175px · 300 DPI tag* is green. |
| ☐ | Click the image → **100% pixels** | One image pixel per screen pixel. Text edges are sharp and photos are detailed, with no upscaling blur. |
| ☐ | 🔧 `exiftool -ImageSize -XResolution -YResolution -ResolutionUnit -ProfileDescription file.png` | `1575x2175`, `300`, `300`, `inches`, `sRGB IEC61966-2.1` |
| ☐ | **Export → JPEG** (quality 100) | Same pixel size, 300 DPI, sRGB |
| ☐ | 🔧 `exiftool -YCbCrSubSampling -ImageSize -XResolution file.jpg` | `YCbCr4:4:4 (1 1)`: no chroma subsampling, so red and green text stays crisp |
| ☐ | 🔧 `magick identify -format "%w x %h  %x x %y %U\n" file.jpg` | `1575 x 2175  300 x 300 PixelsPerInch` |

### PDF

| ✓ | Step | Expected |
|---|---|---|
| ☐ | **Export → PDF**, sRGB, bleed on, crop marks off | Verification: *pages 5.25×7.25″ · TrimBox ✓ · BleedBox ✓*, sRGB, fonts embedded ✓. Proof thumbnails are rasterised from the finished PDF by Ghostscript. |
| ☐ | 🔧 `pdfinfo -box card.pdf` | `Page size: 378 x 522 pts`. `MediaBox` and `BleedBox` are `0 0 378 522`. `TrimBox` is `9 9 369 513` (0.125″ = 9 pt inset). |
| ☐ | Turn crop marks on and export again | The page grows to 5.9 × 7.9″ (424.8 × 568.8 pt). Thin registration-black marks sit 1/16″ outside the bleed and stop short of the paper edge. `TrimBox` is `32.4 32.4 392.4 536.4`. |
| ☐ | Zoom far in on a photo in a PDF viewer | Detail matches the 300 DPI PNG. 🔧 `pdfimages -list card.pdf` shows the photo at about 300 ppi (`x-ppi`/`y-ppi`), or higher when the original is larger. |
| ☐ | Zoom far in on an ornament or the greeting | Edges stay sharp at any zoom (vector) |

### Effective photo resolution (Print Guardian)

| ✓ | Step | Expected |
|---|---|---|
| ☐ | Add a small photo (for example a 640 × 480 px image) to a large frame | The Guardian light turns **red**: *Low resolution photo on the Front (≈120 DPI)*, with a one-click fix (*Zoom out*, or *Replace photo*) |
| ☐ | Zoom into a normal phone photo (Inspector → crop zoom) until the Guardian turns yellow | Yellow below 250 DPI, red below 180 DPI. The Inspector's DPI badge shows the same number. |
| ☐ | Export anyway (the dialog asks you to confirm) | The **Photo resolution** table lists the same effective DPI per photo, coloured green, amber or red |

## 4. Folded cards, crop marks and CMYK

| ✓ | Step | Expected |
|---|---|---|
| ☐ | New card → 5×7 **Folded** → add words inside | The pages bar shows *Front, Inside Left, Inside Right, Back*. **Preview** mode opens the card in 3D. |
| ☐ | **Export → PDF → Print spreads** | Two pages, 10.25 × 7.25″: *outside (back \| front)* and *inside (left \| right)*. No bleed at the fold. With crop marks on, a dashed **fold mark** sits at the centre line. |
| ☐ | **Export → PNG → Separate panels** | Four separate 1575 × 2175 px files, plus a zip |
| ☐ | Landscape folded (top-fold "tent") card → spreads | The back panel prints **upside-down** above the front, so it reads correctly once folded |
| ☐ | **Export → PDF → CMYK** (Docker image; Ghostscript required) | Verification shows *CMYK* and the profile name. To use your printer's profile, put its `.icc` in `/data/config/icc/` and pick it in the dialog. |
| ☐ | 🔧 `docker exec homecard gs -q -o - -sDEVICE=inkcov /data/exports/<…>/<file>_CMYK.pdf` | Four coverage numbers (C M Y K) per page. 🔧 `pdfimages -list` shows `cmyk` images. |

## 5. Editor sanity check (2 minutes)

| ✓ | Check | Expected |
|---|---|---|
| ☐ | Make edits, wait 1 s, then reload the page | Everything is still there (autosave). The badge says *Saved*. |
| ☐ | `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z` | Undo and redo step through your changes |
| ☐ | **Versions** menu (clock icon) → **+ Snapshot**, change something, then restore the snapshot | The card returns to the snapshot. HomeCard first saves the current state as *Before restore*, so the restore can be undone. |
| ☐ | Templates panel → pick a different layout | Photos, crops and words carry over. Switching back restores any photos that didn't fit. |
| ☐ | Style → Colors → **Color Harmony** | Themes are taken from your photos and every one passes the contrast check |
| ☐ | Polish → **Auto-Enhance**, then hold **Compare** | The photo improves. Holding Compare shows the original. The export matches the edited preview. |
| ☐ | Edit `/data/styles/winter-woodland/pack.json` (change a palette colour) and save | Within about 2 s the palette swatch updates in the open editor. No reload needed. |
| ☐ | Studio → Layers | Drag to reorder, lock, hide, and rename by double-clicking |

## 6. Send a test print

Upload the PDF or JPEG to your print service as an *upload your own design* card of the
same size. Their preview should line up with HomeCard's bleed and safe lines. For a first
order, print one card before ordering the batch.
