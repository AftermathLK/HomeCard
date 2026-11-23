/**
 * Holiday calendar: the real dates of every dated occasion, what's coming up next, and the words
 * HomeCard uses to find matching photos (Immich tags, album names, visual search).
 *
 * Dates are calendar days ("2026-11-26") with no time zone. The browser asks with its own local
 * day, so "today" is always the person's today. Lunar and lunisolar holidays come from a table
 * (2020–2035). Islamic dates depend on moon sighting and Diwali on the regional almanac, so a
 * family's own date can be a day either side; the table follows the commonly published date.
 */
import { getOccasion, OCCASIONS } from './holidays';

/** A calendar day, "YYYY-MM-DD". */
export type IsoDay = string;

type DateRule =
  | { kind: 'fixed'; month: number; day: number }
  | { kind: 'easter' }
  /** The nth weekday (0 = Sunday) of a month: Thanksgiving is the 4th Thursday of November. */
  | { kind: 'nth-weekday'; month: number; weekday: number; n: number }
  /** Start dates looked up per year (lunar and lunisolar calendars). */
  | { kind: 'table'; dates: readonly IsoDay[] };

export interface HolidayRule {
  rule: DateRule;
  /** How many days it lasts (Hanukkah 8 nights, Kwanzaa 7 days). Default 1. */
  days?: number;
  /** Jewish holidays begin at sundown on the listed date. */
  startsAtSundown?: boolean;
  /** A season that leads up to the date (Season's Greetings: December 1–25). */
  seasonDays?: number;
}

const fixed = (month: number, day: number): DateRule => ({ kind: 'fixed', month, day });

/** First table year: past-year photo windows reach back four years from 2024 onwards. */
export const HOLIDAY_TABLE_FIRST_YEAR = 2020;
export const HOLIDAY_TABLE_LAST_YEAR = 2035;

/** Every dated occasion. Occasions not listed here (milestones, Graduation, Custom) have no fixed date. */
export const HOLIDAY_RULES: Record<string, HolidayRule> = {
  christmas: { rule: fixed(12, 25) },
  holiday: { rule: fixed(12, 25), seasonDays: 24 },
  'winter-solstice': { rule: fixed(12, 21) },
  kwanzaa: { rule: fixed(12, 26), days: 7 },
  'new-year': { rule: fixed(1, 1) },
  valentines: { rule: fixed(2, 14) },
  'st-patricks': { rule: fixed(3, 17) },
  'july-4': { rule: fixed(7, 4) },
  halloween: { rule: fixed(10, 31) },
  easter: { rule: { kind: 'easter' } },
  'mothers-day': { rule: { kind: 'nth-weekday', month: 5, weekday: 0, n: 2 } },
  'fathers-day': { rule: { kind: 'nth-weekday', month: 6, weekday: 0, n: 3 } },
  thanksgiving: { rule: { kind: 'nth-weekday', month: 11, weekday: 4, n: 4 } },
  // First candle at sundown.
  hanukkah: {
    days: 8,
    startsAtSundown: true,
    rule: { kind: 'table', dates: ['2020-12-10', '2021-11-28', '2022-12-18', '2023-12-07', '2024-12-25', '2025-12-14', '2026-12-04', '2027-12-24', '2028-12-12', '2029-12-01', '2030-12-20', '2031-12-09', '2032-11-27', '2033-12-16', '2034-12-06', '2035-12-25'] },
  },
  // First Seder at sundown.
  passover: {
    days: 8,
    startsAtSundown: true,
    rule: { kind: 'table', dates: ['2020-04-08', '2021-03-27', '2022-04-15', '2023-04-05', '2024-04-22', '2025-04-12', '2026-04-01', '2027-04-21', '2028-04-10', '2029-03-30', '2030-04-17', '2031-04-07', '2032-03-26', '2033-04-13', '2034-04-03', '2035-04-23'] },
  },
  'rosh-hashanah': {
    days: 2,
    startsAtSundown: true,
    rule: { kind: 'table', dates: ['2020-09-18', '2021-09-06', '2022-09-25', '2023-09-15', '2024-10-02', '2025-09-22', '2026-09-11', '2027-10-01', '2028-09-20', '2029-09-09', '2030-09-27', '2031-09-17', '2032-09-05', '2033-09-23', '2034-09-13', '2035-10-03'] },
  },
  'lunar-new-year': {
    rule: { kind: 'table', dates: ['2020-01-25', '2021-02-12', '2022-02-01', '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03', '2031-01-23', '2032-02-11', '2033-01-31', '2034-02-19', '2035-02-08'] },
  },
  // Lakshmi Puja.
  diwali: {
    rule: { kind: 'table', dates: ['2020-11-14', '2021-11-04', '2022-10-24', '2023-11-12', '2024-10-31', '2025-10-20', '2026-11-08', '2027-10-29', '2028-10-17', '2029-11-05', '2030-10-26', '2031-11-14', '2032-11-02', '2033-10-22', '2034-11-10', '2035-10-30'] },
  },
  // The Islamic year is ~11 days shorter, so 2033 has two Eid al-Fitr dates.
  'eid-al-fitr': {
    rule: { kind: 'table', dates: ['2020-05-24', '2021-05-13', '2022-05-02', '2023-04-21', '2024-04-10', '2025-03-30', '2026-03-20', '2027-03-10', '2028-02-27', '2029-02-15', '2030-02-05', '2031-01-25', '2032-01-14', '2033-01-03', '2033-12-23', '2034-12-12', '2035-12-01'] },
  },
  'eid-al-adha': {
    rule: { kind: 'table', dates: ['2020-07-31', '2021-07-20', '2022-07-09', '2023-06-28', '2024-06-16', '2025-06-06', '2026-05-27', '2027-05-16', '2028-05-05', '2029-04-24', '2030-04-14', '2031-04-03', '2032-03-22', '2033-03-12', '2034-03-01', '2035-02-18'] },
  },
};

export function isDatedOccasion(occasionId: string): boolean {
  return occasionId in HOLIDAY_RULES;
}

/* ---------------- Day arithmetic (no time zones) ---------------- */

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDay(year: number, month: number, day: number): IsoDay {
  const d = new Date(Date.UTC(year, month - 1, day));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today (or `now`) as a calendar day in this machine's time zone. */
export function localIsoDay(now: Date = new Date()): IsoDay {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parts(day: IsoDay): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Not a calendar day: ${day}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const dayNumber = (day: IsoDay) => {
  const [y, m, d] = parts(day);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function addDays(day: IsoDay, n: number): IsoDay {
  const [y, m, d] = parts(day);
  return isoDay(y, m, d + n);
}

export function daysBetween(from: IsoDay, to: IsoDay): number {
  return dayNumber(to) - dayNumber(from);
}

/** Easter Sunday (Western), by the Anonymous Gregorian algorithm. */
export function easterSunday(year: number): IsoDay {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDay(year, month, day);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDay {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return isoDay(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** Start dates of an occasion that fall in `year` (usually one; none for undated occasions or years off the table). */
export function occasionDatesIn(occasionId: string, year: number): IsoDay[] {
  const r = HOLIDAY_RULES[occasionId]?.rule;
  if (!r) return [];
  switch (r.kind) {
    case 'fixed':
      return [isoDay(year, r.month, r.day)];
    case 'easter':
      return [easterSunday(year)];
    case 'nth-weekday':
      return [nthWeekday(year, r.month, r.weekday, r.n)];
    case 'table':
      return r.dates.filter((d) => d.startsWith(`${year}-`));
  }
}

/* ---------------- What's coming up ---------------- */

export interface HolidayOccurrence {
  occasionId: string;
  /** First day (for Jewish holidays: the evening it begins). */
  date: IsoDay;
  /** Last day it is celebrated. */
  endDate: IsoDay;
  /** Days from today to `date`; 0 while it is on. */
  daysAway: number;
  /** Today falls on it. */
  ongoing: boolean;
  startsAtSundown: boolean;
}

/** The next time an occasion happens, counting one that is on today. Null for undated occasions. */
export function nextOccurrence(occasionId: string, today: IsoDay): HolidayOccurrence | null {
  const rule = HOLIDAY_RULES[occasionId];
  if (!rule) return null;
  const year = parts(today)[0];
  const length = rule.days ?? 1;
  const candidates = [year - 1, year, year + 1].flatMap((y) => occasionDatesIn(occasionId, y));
  for (const date of candidates.sort()) {
    const endDate = addDays(date, length - 1);
    if (daysBetween(today, endDate) < 0) continue;
    const away = daysBetween(today, date);
    return { occasionId, date, endDate, daysAway: Math.max(0, away), ongoing: away <= 0, startsAtSundown: !!rule.startsAtSundown };
  }
  return null;
}

export interface UpcomingHolidays {
  /** The holiday to feature: the closest visible one (the next on the calendar if none is inside the window). */
  primary: HolidayOccurrence | null;
  /** The next few after it, for quick switching. */
  others: HolidayOccurrence[];
}

/**
 * Visible dated holidays in date order. `others` holds the next few inside the lookahead window;
 * when the window is quiet it still offers the next two on the calendar.
 */
export function upcomingHolidays(
  today: IsoDay,
  opts: { hidden?: readonly string[]; lookaheadDays?: number; others?: number } = {},
): UpcomingHolidays {
  const hidden = new Set(opts.hidden ?? []);
  const lookahead = opts.lookaheadDays ?? 60;
  const want = opts.others ?? 3;
  const order = new Map(OCCASIONS.map((o, i) => [o.id, i]));
  const all = Object.keys(HOLIDAY_RULES)
    .filter((id) => !hidden.has(id))
    .map((id) => nextOccurrence(id, today))
    .filter((o): o is HolidayOccurrence => !!o)
    .sort((a, b) => a.daysAway - b.daysAway || a.date.localeCompare(b.date) || (order.get(a.occasionId) ?? 0) - (order.get(b.occasionId) ?? 0));
  const [primary = null, ...rest] = all;
  const inWindow = rest.filter((o) => o.daysAway <= lookahead);
  return { primary, others: (inWindow.length ? inWindow : rest.slice(0, 2)).slice(0, want) };
}

/** Print lead time, for the line under the countdown. */
export function leadTimeNote(daysAway: number): string {
  if (daysAway <= 0) return 'It’s today — a digital card can still go out in time.';
  const n = `${daysAway} day${daysAway === 1 ? '' : 's'} away`;
  if (daysAway < 14) return `${n} — ideal for local pickup or a digital share`;
  if (daysAway < 21) return `${n} — order prints this week to arrive in time`;
  if (daysAway <= 45) return `${n} — great time to design & order prints`;
  return `${n} — plenty of time to plan something special`;
}

/** How the hero names an occasion in a sentence. */
const COUNTDOWN_NAME: Record<string, string> = {
  holiday: 'The holiday season',
  'new-year': 'New Year’s Day',
};

/** On the day itself. */
const CELEBRATION: Record<string, string> = {
  christmas: 'Merry Christmas',
  holiday: 'Season’s Greetings',
  'new-year': 'Happy New Year',
  'eid-al-fitr': 'Eid Mubarak',
  'eid-al-adha': 'Eid Mubarak',
  'rosh-hashanah': 'Shana Tova',
  'lunar-new-year': 'Happy Lunar New Year',
};

export function celebrationLine(occasionId: string): string {
  return CELEBRATION[occasionId] ?? `Happy ${getOccasion(occasionId).name}`;
}

/** "Christmas is coming up in 32 days", "… is tomorrow", or "Merry Christmas!" on the day. */
export function countdownLine(o: HolidayOccurrence): string {
  if (o.ongoing) return `${celebrationLine(o.occasionId)}!`;
  const name = COUNTDOWN_NAME[o.occasionId] ?? getOccasion(o.occasionId).name;
  const begins = o.startsAtSundown ? 'begins' : 'is';
  if (o.daysAway === 1) return o.startsAtSundown ? `${name} begins tomorrow evening` : `${name} is tomorrow`;
  if (o.daysAway === 7) return `${name} ${begins} one week from today`;
  if (o.daysAway < 7) return `${name} ${begins} in ${o.daysAway} days`;
  return `${name} ${o.startsAtSundown ? 'begins' : 'is coming up'} in ${o.daysAway} days`;
}

/** "Thursday, Nov 26" (or "Begins at sundown, Friday, Dec 4"). */
export function dayPill(o: Pick<HolidayOccurrence, 'date' | 'startsAtSundown'>, locale?: string): string {
  const [y, m, d] = parts(o.date);
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return o.startsAtSundown ? `Begins at sundown, ${label}` : label;
}

/**
 * The same holiday in earlier years, padded either side ("this time in past years"). Moving
 * holidays use their real date in each year, so Easter 2023 looks around April 9, not April 5.
 */
export function pastWindows(occasionId: string, upcoming: Pick<HolidayOccurrence, 'date'>, years = 4, padDays = 14): Array<{ year: number; from: IsoDay; to: IsoDay }> {
  const rule = HOLIDAY_RULES[occasionId];
  if (!rule) return [];
  const y0 = parts(upcoming.date)[0];
  const out: Array<{ year: number; from: IsoDay; to: IsoDay }> = [];
  for (let y = y0 - 1; y >= y0 - years; y--) {
    for (const date of occasionDatesIn(occasionId, y)) {
      out.push({ year: y, from: addDays(date, -padDays - (rule.seasonDays ?? 0)), to: addDays(date, (rule.days ?? 1) - 1 + padDays) });
    }
  }
  return out;
}

/* ---------------- Words that find matching photos ---------------- */

/** Strongest first. Matched against Immich tag names/paths and album titles. */
export const HOLIDAY_KEYWORDS: Record<string, readonly string[]> = {
  christmas: ['christmas', 'xmas', 'noel', 'santa', 'holiday', 'christmas tree', 'tree', 'winter'],
  hanukkah: ['hanukkah', 'chanukah', 'hanukah', 'menorah', 'dreidel', 'latkes'],
  kwanzaa: ['kwanzaa', 'kinara'],
  holiday: ['holiday', 'holidays', 'season', 'festive', 'christmas', 'xmas', 'winter', 'snow'],
  'winter-solstice': ['solstice', 'yule', 'winter', 'snow'],
  'new-year': ['new year', 'new years', 'nye', 'new years eve', 'fireworks', 'countdown', 'champagne'],
  valentines: ['valentine', 'valentines', 'galentines', 'love', 'heart'],
  'lunar-new-year': ['lunar new year', 'chinese new year', 'tet', 'seollal', 'spring festival', 'red envelope', 'lantern'],
  'st-patricks': ['st patricks', 'saint patricks', 'st paddys', 'shamrock', 'irish'],
  easter: ['easter', 'egg hunt', 'easter eggs', 'bunny', 'spring'],
  passover: ['passover', 'pesach', 'seder', 'matzah', 'matzo'],
  'eid-al-fitr': ['eid al fitr', 'eid ul fitr', 'eid', 'ramadan', 'iftar'],
  'eid-al-adha': ['eid al adha', 'eid ul adha', 'adha', 'eid', 'hajj', 'qurbani'],
  'mothers-day': ['mothers day', 'mother', 'mom', 'mum', 'mama'],
  'fathers-day': ['fathers day', 'father', 'dad', 'papa'],
  graduation: ['graduation', 'grad', 'commencement', 'cap and gown'],
  'july-4': ['4th of july', 'fourth of july', 'july 4th', 'july 4', 'independence day', 'fireworks', 'bbq'],
  'rosh-hashanah': ['rosh hashanah', 'rosh hashana', 'shana tova', 'jewish new year', 'apples and honey'],
  diwali: ['diwali', 'deepavali', 'diya', 'rangoli'],
  halloween: ['halloween', 'costume', 'costumes', 'trick or treat', 'pumpkin', 'jack o lantern', 'spooky'],
  thanksgiving: ['thanksgiving', 'friendsgiving', 'turkey', 'harvest', 'autumn', 'fall'],
  birth: ['newborn', 'baby', 'birth', 'hospital'],
  'first-birthday': ['first birthday', '1st birthday', 'smash cake', 'birthday'],
  'new-home': ['new home', 'housewarming', 'moving', 'move', 'new house'],
  wedding: ['wedding', 'bride', 'groom', 'ceremony', 'reception'],
  'save-the-date': ['engagement', 'engaged', 'proposal', 'save the date'],
  'thank-you': ['thank you', 'thanks'],
  custom: [],
};

/** Read-only visual (CLIP) search phrase per occasion. */
export const HOLIDAY_VISUAL_QUERY: Record<string, string> = {
  christmas: 'christmas tree family holiday',
  hanukkah: 'menorah candles family hanukkah',
  kwanzaa: 'kwanzaa kinara candles family',
  holiday: 'family winter holiday festive lights',
  'winter-solstice': 'winter snow candles evening',
  'new-year': 'new year celebration fireworks party',
  valentines: 'valentines day hearts couple',
  'lunar-new-year': 'lunar new year red lanterns family',
  'st-patricks': 'st patricks day green shamrock',
  easter: 'easter egg hunt children spring',
  passover: 'passover seder table family',
  'eid-al-fitr': 'eid celebration family festive clothes',
  'eid-al-adha': 'eid celebration family gathering',
  'mothers-day': 'mother with children smiling',
  'fathers-day': 'father with children outdoors',
  graduation: 'graduation cap and gown',
  'july-4': 'fourth of july fireworks american flag',
  'rosh-hashanah': 'apples and honey family dinner',
  diwali: 'diwali diya lamps rangoli',
  halloween: 'halloween costumes pumpkins',
  thanksgiving: 'thanksgiving dinner family autumn',
  birth: 'newborn baby',
  'first-birthday': 'first birthday cake baby',
  'new-home': 'family in front of new house',
  wedding: 'wedding bride and groom',
  'save-the-date': 'engaged couple portrait',
  'thank-you': 'family smiling together',
  custom: 'family smiling together',
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function wordMatches(word: string, kw: string): boolean {
  // Exact word, or the word with a plural or a year stuck on ("holidays", "xmas2024", "2023christmas").
  return word === kw || word === `${kw}s` || word === `${kw}es` || new RegExp(`^(\\d{2,4})?${kw}(s|es)?(\\d{2,4})?$`).test(word);
}

/**
 * How well a tag path or album title matches a set of keywords: the index of the strongest
 * keyword that matches (lower is stronger), or -1. Whole words only, so "easter" never matches
 * "eastern" and "eid" never matches "reid".
 */
export function keywordStrength(text: string, keywords: readonly string[]): number {
  const t = norm(text);
  if (!t) return -1;
  const words = t.split(' ');
  for (const [i, raw] of keywords.entries()) {
    const kw = norm(raw);
    if (!kw) continue;
    if (!kw.includes(' ')) {
      if (words.some((w) => wordMatches(w, kw))) return i;
    } else if (` ${t} `.includes(` ${kw} `) || words.some((w) => wordMatches(w, kw.replace(/ /g, '')))) return i;
  }
  return -1;
}

/** A user's own tag names for a holiday ("card-picks"): the tag's name, its full path or its last part. */
export function matchesCustomTag(tag: { name: string; value?: string }, custom: readonly string[]): boolean {
  const name = tag.name.trim().toLowerCase();
  const value = (tag.value ?? tag.name).trim().toLowerCase();
  return custom.some((c) => {
    const x = c.trim().toLowerCase();
    return !!x && (name === x || value === x || value.endsWith(`/${x}`));
  });
}

/* ---------------- Per-user preferences ---------------- */

export const LOOKAHEAD_CHOICES = [30, 45, 60, 90] as const;
export type LookaheadDays = (typeof LOOKAHEAD_CHOICES)[number];

export interface HolidayPrefs {
  /** Show the "upcoming holiday" section on the home page. */
  showHomeBanner: boolean;
  lookaheadDays: LookaheadDays;
  /** Occasion ids the person never wants suggested. */
  hiddenOccasions: string[];
  /** Their own Immich tag names per occasion, e.g. { christmas: ["card-picks"] }. */
  customTagMap: Record<string, string[]>;
}

export const DEFAULT_HOLIDAY_PREFS: HolidayPrefs = { showHomeBanner: true, lookaheadDays: 60, hiddenOccasions: [], customTagMap: {} };

export const MAX_CUSTOM_TAGS = 20;
const TAG_RE = /^[^\u0000-\u001f<>]{1,60}$/;

/** Keep only well-formed values; anything missing or invalid comes from `base`. */
export function sanitizeHolidayPrefs(input: unknown, base: HolidayPrefs = DEFAULT_HOLIDAY_PREFS): HolidayPrefs {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof HolidayPrefs, unknown>>;
  const ids = new Set(OCCASIONS.map((o) => o.id));
  const out: HolidayPrefs = { ...base, hiddenOccasions: [...base.hiddenOccasions], customTagMap: { ...base.customTagMap } };
  if (typeof p.showHomeBanner === 'boolean') out.showHomeBanner = p.showHomeBanner;
  if ((LOOKAHEAD_CHOICES as readonly unknown[]).includes(p.lookaheadDays)) out.lookaheadDays = p.lookaheadDays as LookaheadDays;
  if (Array.isArray(p.hiddenOccasions)) out.hiddenOccasions = [...new Set(p.hiddenOccasions.filter((x): x is string => typeof x === 'string' && ids.has(x)))];
  if (p.customTagMap && typeof p.customTagMap === 'object' && !Array.isArray(p.customTagMap)) {
    const map: Record<string, string[]> = {};
    for (const [id, list] of Object.entries(p.customTagMap as Record<string, unknown>)) {
      if (!ids.has(id) || !Array.isArray(list)) continue;
      const tags = [...new Set(list.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter((t) => TAG_RE.test(t)))].slice(0, MAX_CUSTOM_TAGS);
      if (tags.length) map[id] = tags;
    }
    out.customTagMap = map;
  }
  return out;
}
