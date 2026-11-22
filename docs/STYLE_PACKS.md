# Style Packs

A Style Pack adds new looks to HomeCard without any code. A pack can contain:

* **palettes**: colour themes
* **backgrounds**: paper textures and full-card images
* **foils**: metallic gradients for text
* **ornaments**: SVG artwork that HomeCard can recolour
* **stickers**: full-colour PNG/SVG artwork
* **templates**: layouts
* **font pairings**

Packs are plain files in the `/data/styles` volume. HomeCard watches that folder, so changes
show up in an open editor within a second or two. No restart or reload is needed.

HomeCard ships four starter packs, which are good examples to copy from:
`classic-paper`, `winter-woodland`, `gilded-holiday` and `spring-garden`.

---

## 1. Three ways to add artwork

| You have… | Do this |
|---|---|
| A few images, and you don't want to write JSON | **Settings → Style packs**: pick *Textures / papers*, *SVG ornaments* or *Stickers*, then **Upload assets**. The Decor panel's *Upload SVG ornament* and *Upload PNG sticker* buttons do the same. Files are saved in `/data/styles/_uploads/<kind>/` and appear in a pack called **My Uploads**. |
| A pack someone gave you (`.zip` or `.json`) | **Settings → Style packs → Import pack (.zip / .json)**. A zip is unpacked into `/data/styles/<pack-id>/`. |
| Your own pack | Create a folder `/data/styles/<pack-id>/` with a `pack.json` (below) and your files. |

## 2. Folder layout

```
/data/styles/
├─ style-pack.schema.json        ← JSON Schema (editor autocompletion + validation)
├─ my-pack/
│  ├─ pack.json                  ← manifest (also accepted: style-pack.json, stylepack.json)
│  ├─ textures/linen.jpg
│  ├─ ornaments/corner.svg
│  ├─ stickers/mitten.png
│  └─ templates/hero.json        ← templates can live in their own files
└─ just-palettes.json            ← a single-file pack (no assets) also works
```

* A folder pack needs a `pack.json` (or `style-pack.json` / `stylepack.json`) at the top of the folder.
* A single `*.json` file directly in `/data/styles` is also loaded as a pack. That's handy for
  palettes and font pairings. Files ending in `.schema.json` are skipped.
* Folders and files whose names start with `.` are ignored.
* Asset paths are **relative to the pack folder**. They must stay inside it (no `..`, no
  leading `/`) and end in `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`.

Add `"$schema": "../style-pack.schema.json"` to your manifest. Editors like VS Code then
autocomplete and validate it.

## 3. Manifest reference

```jsonc
{
  "$schema": "../style-pack.schema.json",
  "id": "my-pack",                 // required: letters, numbers, - and _; unique; ≤ 64 chars
  "name": "My Pack",               // shown in the UI
  "version": "1.0.0",
  "author": "You",
  "license": "CC0-1.0",            // what others may do with the artwork
  "description": "One sentence shown under the name.",
  "occasions": ["christmas", "new-year"],   // where the pack is suggested; omit or [] = everywhere

  "palettes":     [ … ],
  "backgrounds":  [ … ],
  "foils":        [ … ],
  "ornaments":    [ … ],
  "stickers":     [ … ],
  "templates":    [ "templates/hero.json", { …inline template… } ],
  "fontPairings": [ … ]
}
```

Every list is optional. A pack can have just one palette.

Items get a pack-scoped id automatically (`my-pack:forest`), so ids only need to be unique
**within** your pack. Saved cards refer to assets as `pack:<pack-id>/<file>`. If you rename
a file or change the pack id, cards that use the old name lose that asset. The Print
Guardian flags this before export.

### 3.1 Palettes

```json
{
  "id": "forest-night",
  "name": "Forest Night",
  "colors": {
    "background": "#132a1f",
    "text": "#f2ede1",
    "accent": "#d9b765",
    "accent2": "#9fc2a8",
    "surface": "#1b382a"
  }
}
```

* `background`, `text` and `accent` are **required** hex colours (`#rgb`, `#rrggbb` or `#rrggbbaa`).
* HomeCard derives the rest of the theme from them:
  * `accent2` (secondary accent; defaults to `accent`)
  * `surface` (panels and mats)
  * `textMuted`
  * `onPhoto` (text placed over photos)
  * `scrim` (shading behind text on photos)
* You can set any of the derived colours yourself.
* Pick a `text` colour that reads well on `background`. The Print Guardian warns when text
  contrast is below WCAG AA.

### 3.2 Backgrounds

```json
{ "id": "linen", "name": "Linen", "file": "textures/linen.jpg", "mode": "tile", "tileSizeIn": 2, "kind": "overlay", "tone": "light" }
```

| Field | Values | Meaning |
|---|---|---|
| `file` | path | JPG/PNG/WebP/SVG |
| `mode` | `tile` (default) \| `cover` | `tile` repeats the image every `tileSizeIn` inches. `cover` stretches one image over the whole card, including bleed. |
| `tileSizeIn` | number (default `2`) | Physical size of one tile, in inches |
| `kind` | `overlay` (default) \| `image` | `overlay`: a texture laid over the palette's background colour, so it works with any palette. `image`: an opaque picture. |
| `tone` | `light` \| `dark` | Helps HomeCard pick readable text colours for this background |

**Print resolution.** Backgrounds print at whatever resolution you give them:

* *Cover* images need at least 300 DPI at the largest card size you plan to use. For a 6×8″
  card with bleed, that's 1838 × 2438 px.
* *Tile* images need `tileSizeIn × 300` pixels on each side: 600 × 600 px for a 2″ tile.
* Make tiles seamless, so the left edge continues into the right edge.

### 3.3 Foils

Foils fill text with a metallic gradient. The fill stays vector in the PDF.

```json
{ "id": "rose-gold", "name": "Rose gold", "stops": ["#9e5a4b", "#f3c3b0", "#b8735f", "#ffe1d3", "#8f4f41"], "angle": 120 }
```

Use **either** `stops` + `angle`:

* `stops`: two or more hex colours, spread evenly
* `angle`: in degrees, default `135`

…**or** a full CSS gradient: `"gradient": "linear-gradient(100deg, #8a6b2f 0%, #f7e7a1 45%, #b08d3c 100%)"`.
`linear-`, `radial-` and `conic-gradient` are allowed.

Other fields:

* `mid`: a hex colour that represents the foil for contrast checks and swatches. Defaults
  to the middle stop.
* `texture`: an image overlaid on the foil for a brushed or sparkle look.

> **Real foil printing.** Digital labs print foils as metallic-*looking* colour. True
> hot-foil or letterpress needs a separate spot layer from the print shop, and HomeCard
> doesn't produce one.

### 3.4 Ornaments (recolourable SVG)

```json
{ "id": "deco-corner", "name": "Deco corner", "file": "ornaments/deco-corner.svg", "kind": "corner", "tags": ["art deco", "gold"] }
```

| Field | Values | Meaning |
|---|---|---|
| `kind` | `ornament` (default), `divider`, `corner`, `frame`, `scatter` | Sets the default placement and the filter chip in the Decor panel |
| `recolorable` | `true` (default for SVG) \| `false` | Whether HomeCard recolours the SVG with the theme |
| `stretch` | boolean (always on for `frame`) | Stretch to any box instead of keeping the aspect ratio. Use it for borders and frames. |
| `tags` | strings | Words for the Decor search box |

**How recolouring works.** When `recolorable` is on, HomeCard replaces every `fill` and
`stroke` with the ornament's **colour 1**, so any palette works. Colour 1 defaults to the
theme accent. To make a **two-colour** ornament, add `class="tone2"` to the shapes that
should take **colour 2** (`accent2` by default):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
  <path d="M50 30 C40 10 14 12 16 32 …Z" fill="#c86b85"/>             <!-- colour 1 -->
  <path d="M50 46 C40 50 26 60 32 70 …Z" class="tone2" fill="#e6b85c"/> <!-- colour 2 -->
  <path d="M49 29 C46 20 …" fill="none" stroke="#3b3a36"/>              <!-- outline in colour 1 -->
</svg>
```

Rules for recolourable SVGs:

* Use `fill` and `stroke` **attributes**, not `style="fill:…"`. Inline styles win over
  HomeCard's recolouring.
* `fill="none"` and `stroke="none"` are left alone, so outlines stay outlines.
* Gradients and patterns are replaced by the flat colour. If your artwork depends on its own
  colours or gradients (like the `pinecone` ornament in *Winter Woodland*), set
  `"recolorable": false`.
* Always include a `viewBox`. HomeCard removes `width` and `height` so the ornament scales to its box.
* Keep it vector. Embedded raster images are allowed, but they print at their own resolution.

**Safety.** SVGs are sanitised before HomeCard shows them. It removes:

* `<script>`, event handlers, `<foreignObject>` and iframes
* external `href`s, `@import` and external `url()`s

Element ids are namespaced so that different files can't clash. Local `#id` references,
such as gradients and clip paths, keep working.

### 3.5 Stickers

```json
{ "id": "cocoa-mug", "name": "Cocoa mug", "file": "stickers/cocoa-mug.svg", "tags": ["cozy", "winter"] }
```

Stickers are shown exactly as drawn, in full colour, and are never recoloured. Use PNG
(with transparency) or SVG. Raster stickers need about **300 px per inch** at the largest
size someone will place them. A 2″ sticker needs a 600 px image.

### 3.6 Font pairings

```json
{
  "id": "cabin-script",
  "name": "Cabin script",
  "mood": "Cozy",
  "display": { "family": "Great Vibes", "weight": 400, "style": "normal" },
  "body":    { "family": "Lora", "weight": 400, "style": "normal" },
  "accent":  { "family": "Josefin Sans", "weight": 600, "style": "normal", "transform": "uppercase", "letterSpacing": 0.18 }
}
```

* Each pairing sets the three font roles:
  * **display**: the greeting and headline
  * **body**: messages
  * **accent**: names, the year and small caps
* `family` must be a bundled font or one installed in `/data/fonts`. Fonts aren't bundled
  inside packs; tell people which free fonts to install.
* `letterSpacing` is in em. `transform` is `none` or `uppercase`.

Bundled families:

* Serif: Playfair Display, Cormorant Garamond, EB Garamond, Lora, DM Serif Display, Abril Fatface, Cinzel
* Script: Great Vibes, Parisienne, Pinyon Script, Dancing Script, Sacramento
* Sans: Montserrat, Raleway, Josefin Sans, Work Sans, Nunito, Bebas Neue
* Handwritten and display: Caveat, Amatic SC, Mountains of Christmas

## 4. Templates

A template is a list of elements placed in **normalised coordinates**: `rect` is
`[x, y, width, height]` as fractions (0–1) of the **trim** box. The same template therefore
fits a 5×7, an A2 or a 6×8.

```json
{
  "id": "woodland-window",
  "name": "Woodland Window",
  "description": "An arched photo window with fir trees and a snowy greeting.",
  "kinds": ["front"],
  "category": "cutout",
  "layouts": {
    "any": [
      { "type": "photo", "slot": 0, "mask": "arch", "rect": [0.14, 0.07, 0.72, 0.58], "shadow": true },
      { "type": "ornament", "asset": "pack:winter-woodland/ornaments/fir-trio.svg",
        "rect": [0.08, 0.56, 0.84, 0.11], "color": "@accent", "color2": "@accent2" },
      { "type": "text", "role": "headline", "rect": [0.08, 0.69, 0.84, 0.13] },
      { "type": "text", "role": "names",    "rect": [0.10, 0.84, 0.80, 0.05] },
      { "type": "text", "role": "year",     "rect": [0.30, 0.89, 0.40, 0.04] }
    ]
  }
}
```

### Template fields

| Field | Values | Meaning |
|---|---|---|
| `id`, `name`, `description` | | Shown in the Templates panel |
| `kinds` | `front`, `back`, `inside` (default `["front"]`) | Which card sides the template is offered for |
| `category` | `full-bleed`, `framed`, `collage`, `cutout`, `split`, `typography`, `letter`, `postcard` | The filter chip it appears under |
| `defaults` | `{ "gutter": 0.08, "radius": 0, "margin": 0.3 }` (inches) | Starting values for the layout sliders |
| `layouts` | object keyed by `portrait`, `landscape`, `square`, `any` | Element lists. HomeCard uses the key matching the card's orientation, otherwise `any`, otherwise the first layout. |

The number of photo **slots** sets how many photos the template holds. When someone switches
templates, photo 1 stays photo 1, and photos that don't fit are kept aside, so switching
back restores them.

### Layout elements

Every element has `rect` and may have these common fields:

* `bleed: true`: edges that touch the trim are pushed out to the bleed line. Use it for
  full-bleed photos and backgrounds, so there's no white sliver after cutting.
* `rotation` (degrees)
* `opacity` (0–1)

| `type` | Fields |
|---|---|
| `photo` | `slot` (0-based, required) · `mask`: `rect`, `rounded`, `circle`, `ellipse`, `arch`, `scallop`, `heart`, `stamp` · `radiusIn` (corner radius for `rounded`) · `frameStyle`: `none`, `polaroid`, `mat` · `shadow` · `focusArea` (`{x,y,w,h}` 0–1 inside the frame, where faces should land, for example above a text overlay) |
| `text` | `role` (required): `headline`, `subhead`, `names`, `year`, `message`, `body`, `small`, `monogram`, `custom` · `sizeRel`: font size as a fraction of the card's short side (0.1 on a 5″-wide card = 0.5″ ≈ 36 pt) · `fontRole`: `display`, `body`, `accent` · `align` · `vAlign` · `color` · `fill`: `color` or `foil` · `lineHeight` · `shadow` · `text` (fixed text; otherwise the role's greeting, name or year is filled in) |
| `ornament` | `asset` (required): `pack:<pack-id>/<file.svg>`, a built-in ornament id such as `snowflake`, `holly`, `laurel` or `wreath`, or `@icon` for the occasion's own icon · `color` · `color2` · `flipX`. Pack artwork used here must also be listed under the pack's `ornaments`; otherwise the pack shows an error. |
| `shape` | `shape`: `rect`, `ellipse`, `line` · `fill` · `radius` |
| `scrim` | `direction`: `to-top`, `to-bottom`, `to-left`, `to-right`, `radial`, `solid` · `color` · `strength` (0–1) · `extent` (0–1). A gradient that keeps text readable over a photo. |

**Colours** can be a theme token or a hex value, so templates adapt to any palette:

* theme tokens: `@background`, `@surface`, `@text`, `@textMuted`, `@accent`, `@accent2`,
  `@onPhoto`, `@scrim`
* hex: `#rrggbb` or `#rrggbbaa`

Text sizes are defaults: auto-fit shrinks long names to fit the box, and people can still
change everything. Leave at least the vendor's safe margin (about 0.25″, so roughly `0.05` of
a 5″ side) between text and the trim. The Print Guardian flags text outside the safe zone.

## 5. Checking your pack

**Settings → Style packs** lists every pack with its counts. Problems are listed under the
pack without stopping the rest of it from loading. Typical problems:

* `Palette "x" needs hex background, text and accent colours.`
* `Missing file: ornaments/corner.svg`
* `Ornament "x": invalid file path "../secret.svg" …`
* `Duplicate pack id "x" — ignored other-folder.`
* `Could not parse pack.json: Unexpected token …` (a JSON syntax error)

After editing files on a share where change events don't arrive (SMB/NFS), click **Rescan**.
You can also set `WATCH_POLLING=true`.

## 6. Sharing a pack

1. Zip the pack **folder**. `pack.json` can be at the top of the zip or one folder down.
2. Others import it with **Settings → Style packs → Import pack**.

Import limits:

* 150 MB per upload, 300 MB unpacked
* only `.json`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.md` and `.txt` files are extracted
* paths are checked against zip-slip

Set `license` to make clear what people may do with your artwork. All four starter packs are CC0.
