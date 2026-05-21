# Stitchly Symbol Pack

This folder contains the first scaffolded brand asset pack for the Stitchly
symbol.

The generated assets now derive from the supplied source SVG:

- [`377F33E9-851A-4D95-8D94-A47C5BF52B70.svg`](./377F33E9-851A-4D95-8D94-A47C5BF52B70.svg)

## What Is Included

- `stitchly-symbol-current.svg`
  Master SVG using `currentColor`
- `stitchly-symbol-white.svg`
  White symbol for dark surfaces
- `stitchly-symbol-black.svg`
  Black symbol for light surfaces
- `white/`
  Size-wrapped white SVG variants
- `black/`
  Size-wrapped black SVG variants
- `preview.html`
  Visual pack preview for quick review in the browser
- `manifest.json`
  Machine-readable index of the symbol assets

## Sizes

The generated size variants currently include:

- `16`
- `24`
- `32`
- `48`
- `64`
- `128`
- `180`
- `192`
- `256`
- `512`

## Regenerate

Run:

```bash
node ./scripts/generate_brand_symbol_assets.mjs
```

or:

```bash
pnpm brand:symbols
```

## Note

This pack is SVG-first.
That means the assets are immediately usable throughout the app and scale cleanly.
If we later want raster exports such as PNG or ICO, we can add a dedicated export
step once a rasterization tool is available in the repo environment.
