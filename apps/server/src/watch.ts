import path from 'node:path';
import { watch } from 'chokidar';
import { config } from './config';
import { emit } from './events';
import { rescanFonts } from './fonts/fonts';
import { libraryChanged } from './library/routes';
import { rescanStyles, STOCK_CACHE_DIR } from './styles/styles';

/**
 * Live reload: drop a font into /data/fonts or edit a Style Pack in /data/styles and every open
 * editor refreshes (SSE). Set WATCH_POLLING=true for network shares where inotify doesn't fire.
 */
export function startWatchers(log: (m: string) => void) {
  if (process.env.WATCH === 'false') return;
  const usePolling = process.env.WATCH_POLLING === 'true';
  const opts = { ignoreInitial: true, usePolling, interval: 2000, awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 }, depth: 6 } as const;

  const debounce = (fn: () => Promise<void>, ms = 700) => {
    let t: NodeJS.Timeout | null = null;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn().catch((e) => log(`watch handler failed: ${e?.message ?? e}`));
      }, ms);
    };
  };

  const onFonts = debounce(async () => {
    await rescanFonts();
    emit('fonts', { at: Date.now() });
    log('Fonts changed — rescanned');
  });
  const onStyles = debounce(async () => {
    await rescanStyles();
    emit('styles', { at: Date.now() });
    log('Style packs changed — rescanned');
  });
  const onPhotos = debounce(async () => {
    libraryChanged();
  }, 2000);

  try {
    watch(config.dirs.fonts, opts).on('all', onFonts).on('error', () => {});
    // Stock downloads and credit files don't change any pack: ignore them.
    const stockCache = path.join(config.dirs.styles, STOCK_CACHE_DIR);
    watch(config.dirs.styles, { ...opts, ignored: (p: string) => p === stockCache || p.startsWith(stockCache + path.sep) || p.endsWith('.credit.txt') })
      .on('all', onStyles)
      .on('error', () => {});
    watch(config.dirs.photos, { ...opts, depth: 4 }).on('all', onPhotos).on('error', () => {});
    log(`Watching fonts/styles/photos for changes${usePolling ? ' (polling)' : ''}`);
  } catch (err: any) {
    log(`File watching unavailable (${err.message}); use the Rescan buttons instead.`);
  }
}
