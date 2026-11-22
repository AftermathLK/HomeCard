import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright';
import { config } from '../config';
import { RENDER_HEADER } from './grants';

/**
 * Headless Chromium pool. One shared browser, a fresh isolated context per render, a small
 * concurrency limit, and an idle shutdown so the container does not hold ~200 MB when unused.
 */

const IDLE_MS = 5 * 60_000;
const MAX_CONCURRENT = Number(process.env.RENDER_CONCURRENCY ?? 2);


let browserP: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;
const waiters: Array<() => void> = [];
let lastLaunchInfo = 'not started';

const ARGS = [
  '--force-color-profile=srgb',
  '--disable-dev-shm-usage',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--no-first-run',
];

async function launch(): Promise<Browser> {
  const attempts: Array<{ label: string; opts: LaunchOptions }> = [];
  if (config.chromiumPath) attempts.push({ label: `CHROMIUM_PATH=${config.chromiumPath}`, opts: { executablePath: config.chromiumPath } });
  attempts.push({ label: 'Playwright Chromium', opts: {} });
  // Developer machines without `npx playwright install` can fall back to an installed Chrome/Edge.
  attempts.push({ label: 'Google Chrome', opts: { channel: 'chrome' } });
  attempts.push({ label: 'Microsoft Edge', opts: { channel: 'msedge' } });
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const b = await chromium.launch({ headless: true, args: ARGS, ...a.opts, chromiumSandbox: false });
      lastLaunchInfo = `${a.label} ${b.version()}`;
      b.on('disconnected', () => {
        browserP = null;
      });
      return b;
    } catch (err: any) {
      errors.push(`${a.label}: ${String(err.message).split('\n')[0]}`);
    }
  }
  lastLaunchInfo = 'unavailable';
  throw new Error(`Could not start headless Chromium. ${errors.join(' | ')}`);
}

export function getBrowser(): Promise<Browser> {
  if (!browserP) {
    browserP = launch().catch((e) => {
      browserP = null;
      throw e;
    });
  }
  return browserP;
}

function armIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0 || !browserP) return;
    const b = await browserP.catch(() => null);
    browserP = null;
    await b?.close().catch(() => {});
  }, IDLE_MS);
  idleTimer.unref?.();
}

async function acquire() {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
  armIdle();
}

/**
 * Run `fn` with a fresh browser context (isolated cache/cookies) at the given device scale.
 * `renderToken` is the job's render grant: Chromium sends it with every request so the auth wall
 * lets it read exactly that job's data.
 */
export async function withContext<T>(deviceScaleFactor: number, viewport: { width: number; height: number }, renderToken: string, fn: (ctx: BrowserContext) => Promise<T>): Promise<T> {
  await acquire();
  let ctx: BrowserContext | null = null;
  try {
    const browser = await getBrowser();
    ctx = await browser.newContext({
      deviceScaleFactor,
      viewport,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      extraHTTPHeaders: { [RENDER_HEADER]: renderToken },
      serviceWorkers: 'block',
    });
    return await fn(ctx);
  } finally {
    await ctx?.close().catch(() => {});
    release();
  }
}

export async function rendererStatus(): Promise<{ available: boolean; detail: string }> {
  try {
    const b = await getBrowser();
    armIdle();
    return { available: true, detail: lastLaunchInfo || b.version() };
  } catch (err: any) {
    return { available: false, detail: err.message };
  }
}

export async function closeBrowser() {
  const b = await browserP?.catch(() => null);
  browserP = null;
  await b?.close().catch(() => {});
}
