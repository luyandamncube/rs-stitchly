import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512];
const OUTPUT_DIR = path.join(process.cwd(), 'apps', 'web', 'public', 'brand', 'symbol');
const SOURCE_FILE = path.join(
  OUTPUT_DIR,
  '377F33E9-851A-4D95-8D94-A47C5BF52B70.svg'
);

function extractAttribute(svg, name) {
  const match = svg.match(new RegExp(`${name}="([^"]+)"`));
  return match?.[1] ?? null;
}

async function loadSourceSymbol() {
  const svg = await readFile(SOURCE_FILE, 'utf8');
  const pathMatch = svg.match(/<path[^>]*d="([^"]+)"[^>]*>/s);
  const width = Number(extractAttribute(svg, 'width') ?? 1024);
  const height = Number(extractAttribute(svg, 'height') ?? 1024);

  if (!pathMatch?.[1]) {
    throw new Error(`Could not extract path data from ${SOURCE_FILE}`);
  }

  return {
    width,
    height,
    pathData: pathMatch[1]
  };
}

function buildSvg({ color, label, size = 512, source }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${source.width} ${source.height}" role="img" aria-labelledby="title">
  <title id="title">${label}</title>
  <defs>
    <mask id="symbol-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${source.width}" height="${source.height}">
      <rect width="${source.width}" height="${source.height}" fill="#ffffff" />
      <path d="${source.pathData}" fill="#000000" />
    </mask>
  </defs>
  <rect width="${source.width}" height="${source.height}" fill="${color}" mask="url(#symbol-mask)" />
</svg>
`;
}

function buildPreviewHtml() {
  const whiteRows = SIZES.map(
    (size) => `
          <div class="asset-card">
            <img src="./white/stitchly-symbol-${size}.svg" width="${size}" height="${size}" alt="White Stitchly symbol ${size}px" />
            <strong>${size}px</strong>
            <span>/brand/symbol/white/stitchly-symbol-${size}.svg</span>
          </div>`
  ).join('');

  const blackRows = SIZES.map(
    (size) => `
          <div class="asset-card asset-card--light">
            <img src="./black/stitchly-symbol-${size}.svg" width="${size}" height="${size}" alt="Black Stitchly symbol ${size}px" />
            <strong>${size}px</strong>
            <span>/brand/symbol/black/stitchly-symbol-${size}.svg</span>
          </div>`
  ).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Stitchly Brand Symbol Pack</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Space Grotesk", "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 32px;
        background: #0b0b0d;
        color: #ffffff;
      }

      main {
        display: grid;
        gap: 28px;
      }

      header h1,
      section h2,
      p {
        margin: 0;
      }

      header {
        display: grid;
        gap: 10px;
        max-width: 72ch;
      }

      header p,
      .asset-card span {
        color: #7a7a85;
      }

      section {
        display: grid;
        gap: 16px;
      }

      .asset-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }

      .asset-card {
        display: grid;
        gap: 10px;
        align-content: start;
        min-height: 176px;
        padding: 18px;
        border-radius: 22px;
        background: #17171c;
        box-shadow: 0 18px 34px rgba(0, 0, 0, 0.2);
      }

      .asset-card--light {
        background: #f2f2f4;
        color: #0b0b0d;
      }

      .asset-card img {
        display: block;
      }

      .asset-card strong {
        font-size: 0.95rem;
      }

      .asset-card span {
        font-size: 0.76rem;
        line-height: 1.45;
        word-break: break-word;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Stitchly Symbol Design Pack</h1>
        <p>SVG-first brand assets generated from the shared symbol master. White variants are intended for dark surfaces. Black variants are intended for light surfaces.</p>
      </header>

      <section>
        <h2>White Symbol Assets</h2>
        <div class="asset-grid">${whiteRows}
        </div>
      </section>

      <section>
        <h2>Black Symbol Assets</h2>
        <div class="asset-grid">${blackRows}
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

function buildManifest() {
  return JSON.stringify(
    {
      symbol: {
        source_svg: '/brand/symbol/377F33E9-851A-4D95-8D94-A47C5BF52B70.svg',
        master: {
          current: '/brand/symbol/stitchly-symbol-current.svg',
          white: '/brand/symbol/stitchly-symbol-white.svg',
          black: '/brand/symbol/stitchly-symbol-black.svg'
        },
        sizes: SIZES,
        variants: {
          white: SIZES.map((size) => ({
            size,
            path: `/brand/symbol/white/stitchly-symbol-${size}.svg`
          })),
          black: SIZES.map((size) => ({
            size,
            path: `/brand/symbol/black/stitchly-symbol-${size}.svg`
          }))
        },
        notes: [
          'SVG-first design pack for direct app use and easy scaling.',
          'Black variants are intended for light-mode surfaces.'
        ]
      }
    },
    null,
    2
  );
}

async function main() {
  await mkdir(path.join(OUTPUT_DIR, 'white'), { recursive: true });
  await mkdir(path.join(OUTPUT_DIR, 'black'), { recursive: true });
  const source = await loadSourceSymbol();

  await writeFile(
    path.join(OUTPUT_DIR, 'stitchly-symbol-current.svg'),
    buildSvg({ color: 'currentColor', label: 'Stitchly symbol master', size: 512, source })
  );
  await writeFile(
    path.join(OUTPUT_DIR, 'stitchly-symbol-white.svg'),
    buildSvg({ color: '#ffffff', label: 'Stitchly symbol white', size: 512, source })
  );
  await writeFile(
    path.join(OUTPUT_DIR, 'stitchly-symbol-black.svg'),
    buildSvg({ color: '#0b0b0d', label: 'Stitchly symbol black', size: 512, source })
  );

  for (const size of SIZES) {
    await writeFile(
      path.join(OUTPUT_DIR, 'white', `stitchly-symbol-${size}.svg`),
      buildSvg({ color: '#ffffff', label: `Stitchly symbol white ${size}px`, size, source })
    );
    await writeFile(
      path.join(OUTPUT_DIR, 'black', `stitchly-symbol-${size}.svg`),
      buildSvg({ color: '#0b0b0d', label: `Stitchly symbol black ${size}px`, size, source })
    );
  }

  await writeFile(path.join(OUTPUT_DIR, 'preview.html'), buildPreviewHtml());
  await writeFile(path.join(OUTPUT_DIR, 'manifest.json'), buildManifest());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
