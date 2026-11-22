// Bundles the server (and @homecard/shared, which is TypeScript source) into dist/server.js and dist/cli.js.
// Runtime dependencies stay external and are installed in the production image.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  // dist/server.js — the server; dist/cli.js — admin recovery commands (see src/cli.ts).
  entryPoints: { server: 'src/index.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  external: Object.keys(pkg.dependencies ?? {}),
  banner: {
    // Some CJS deps expect require() to exist in ESM output.
    js: "import { createRequire as __hcCreateRequire } from 'node:module'; const require = __hcCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
});
