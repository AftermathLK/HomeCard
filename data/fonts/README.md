# Your fonts

Drop `.ttf`, `.otf`, `.woff` or `.woff2` files into this folder (the `/data/fonts` volume) — or use
**Settings → Fonts → Upload fonts** in HomeCard.

* Fonts are picked up automatically (the folder is watched) and appear in every font menu, marked ★.
* The same files are served to the print renderer, so exported PDFs embed your font as real,
  selectable vector text and PNG/JPEG exports render it at full 300 DPI sharpness.
* Family, weight and italic are read from the font file itself. Put each weight/style in its own file
  (e.g. `Brandon-Regular.otf`, `Brandon-Bold.otf`, `Brandon-Italic.otf`).
* Subfolders are fine. Font collections (`.ttc`) are not supported — extract the individual fonts first.
* Only install fonts you are licensed to use for print. HomeCard's 21 built-in families are all
  open-source (SIL Open Font License / Apache 2.0); their licences ship inside the app.

If a project uses a font that is no longer installed, the Print Guardian flags it before you export.
