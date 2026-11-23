import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  countdownLine,
  daysBetween,
  DEFAULT_HOLIDAY_PREFS,
  easterSunday,
  HOLIDAY_RULES,
  isDatedOccasion,
  keywordStrength,
  HOLIDAY_KEYWORDS,
  leadTimeNote,
  localIsoDay,
  matchesCustomTag,
  MAX_CUSTOM_TAGS,
  nextOccurrence,
  occasionDatesIn,
  OCCASIONS,
  pastWindows,
  sanitizeHolidayPrefs,
  upcomingHolidays,
} from '../src/index';

test('Easter follows the Gregorian computus', () => {
  const known: Record<number, string> = {
    2008: '2008-03-23',
    2019: '2019-04-21',
    2024: '2024-03-31',
    2025: '2025-04-20',
    2026: '2026-04-05',
    2027: '2027-03-28',
    2038: '2038-04-25',
  };
  for (const [y, d] of Object.entries(known)) assert.equal(easterSunday(Number(y)), d, `Easter ${y}`);
});

test('nth-weekday holidays land on the right day', () => {
  assert.deepEqual(occasionDatesIn('thanksgiving', 2025), ['2025-11-27']);
  assert.deepEqual(occasionDatesIn('thanksgiving', 2026), ['2026-11-26']);
  assert.deepEqual(occasionDatesIn('mothers-day', 2025), ['2025-05-11']);
  assert.deepEqual(occasionDatesIn('mothers-day', 2026), ['2026-05-10']);
  assert.deepEqual(occasionDatesIn('fathers-day', 2025), ['2025-06-15']);
  assert.deepEqual(occasionDatesIn('fathers-day', 2026), ['2026-06-21']);
});

test('every dated occasion has a date in every year 2025–2035; undated ones never appear', () => {
  for (const id of Object.keys(HOLIDAY_RULES)) {
    assert.ok(OCCASIONS.some((o) => o.id === id), `${id} is a real occasion`);
    for (let y = 2025; y <= 2035; y++) {
      const dates = occasionDatesIn(id, y);
      assert.ok(dates.length >= 1, `${id} ${y}`);
      for (const d of dates) assert.match(d, new RegExp(`^${y}-\\d{2}-\\d{2}$`));
    }
  }
  // Eid al-Fitr moves ~11 days a year, so 2033 has two.
  assert.equal(occasionDatesIn('eid-al-fitr', 2033).length, 2);
  const undated = OCCASIONS.filter((o) => !isDatedOccasion(o.id)).map((o) => o.id);
  for (const id of ['birth', 'wedding', 'graduation', 'custom', 'thank-you']) assert.ok(undated.includes(id), id);
  for (const id of undated) assert.equal(nextOccurrence(id, '2026-06-01'), null, id);
  for (const day of ['2026-01-15', '2026-05-01', '2026-08-20', '2026-11-23']) {
    const up = upcomingHolidays(day, { lookaheadDays: 90, others: 20 });
    for (const o of [up.primary!, ...up.others]) assert.ok(isDatedOccasion(o.occasionId), `${o.occasionId} on ${day}`);
  }
});

test('the hero features the closest holiday and the next few', () => {
  const up = upcomingHolidays('2026-11-23');
  assert.equal(up.primary?.occasionId, 'thanksgiving');
  assert.equal(up.primary?.date, '2026-11-26');
  assert.equal(up.primary?.daysAway, 3);
  assert.equal(up.others.length, 3);
  assert.equal(up.others[0].occasionId, 'hanukkah');
  assert.equal(up.others[0].date, '2026-12-04');
  assert.equal(up.others[0].startsAtSundown, true);
  for (let i = 1; i < up.others.length; i++) assert.ok(up.others[i].daysAway >= up.others[i - 1].daysAway);
});

test('hidden holidays are skipped', () => {
  const up = upcomingHolidays('2026-11-23', { hidden: ['thanksgiving', 'hanukkah'] });
  assert.equal(up.primary?.occasionId, 'winter-solstice');
  for (const o of up.others) assert.ok(!['thanksgiving', 'hanukkah'].includes(o.occasionId));
  // Everything hidden: nothing to feature.
  assert.equal(upcomingHolidays('2026-11-23', { hidden: Object.keys(HOLIDAY_RULES) }).primary, null);
});

test('a quiet lookahead window still features the next holiday on the calendar', () => {
  const up = upcomingHolidays('2026-07-05', { lookaheadDays: 30 });
  assert.equal(up.primary?.occasionId, 'rosh-hashanah');
  assert.ok(up.primary!.daysAway > 30);
  assert.equal(up.others.length, 2, 'falls back to the next two');
  const roomy = upcomingHolidays('2026-07-05', { lookaheadDays: 90 });
  assert.equal(roomy.primary?.occasionId, 'rosh-hashanah');
});

test('the calendar rolls over the new year and counts multi-day holidays as ongoing', () => {
  const nye = upcomingHolidays('2026-12-31', { hidden: ['kwanzaa'] });
  assert.equal(nye.primary?.occasionId, 'new-year');
  assert.equal(nye.primary?.date, '2027-01-01');
  assert.equal(nye.primary?.daysAway, 1);
  const kw = nextOccurrence('kwanzaa', '2026-12-29')!;
  assert.equal(kw.date, '2026-12-26');
  assert.equal(kw.endDate, '2027-01-01');
  assert.equal(kw.ongoing, true);
  assert.equal(kw.daysAway, 0);
  assert.equal(nextOccurrence('christmas', '2026-12-26')!.date, '2027-12-25');
  assert.equal(daysBetween('2026-12-31', addDays('2026-12-31', 1)), 1);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(localIsoDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('greeting lines read naturally', () => {
  assert.equal(countdownLine(nextOccurrence('christmas', '2026-12-25')!), 'Merry Christmas!');
  assert.equal(countdownLine(nextOccurrence('christmas', '2026-12-24')!), 'Christmas is tomorrow');
  assert.equal(countdownLine(nextOccurrence('hanukkah', '2026-12-03')!), 'Hanukkah begins tomorrow evening');
  assert.equal(countdownLine(nextOccurrence('christmas', '2026-11-23')!), 'Christmas is coming up in 32 days');
  assert.equal(countdownLine(nextOccurrence('eid-al-fitr', '2026-03-20')!), 'Eid Mubarak!');
  assert.match(leadTimeNote(0), /today/);
  assert.match(leadTimeNote(10), /local pickup|digital/);
  assert.match(leadTimeNote(18), /this week/);
  assert.match(leadTimeNote(32), /design & order prints/);
  assert.match(leadTimeNote(80), /plenty of time/);
});

test('past-year windows use each year’s real date', () => {
  const w = pastWindows('easter', { date: '2027-03-28' });
  assert.deepEqual(
    w.map((x) => x.year),
    [2026, 2025, 2024, 2023],
  );
  assert.equal(w[0].from, addDays('2026-04-05', -14));
  assert.equal(w[0].to, addDays('2026-04-05', 14));
  // Season's Greetings covers December 1–25 plus padding.
  const s = pastWindows('holiday', { date: '2026-12-25' })[0];
  assert.equal(s.from, addDays('2025-12-25', -14 - 24));
});

test('keyword matching is whole-word and tolerates plurals and years', () => {
  const easter = HOLIDAY_KEYWORDS.easter;
  assert.equal(keywordStrength('Eastern Europe trip', easter), -1);
  assert.equal(keywordStrength('Easter 2024', easter), 0);
  assert.equal(keywordStrength('Holidays/Christmas', HOLIDAY_KEYWORDS.christmas), 0);
  assert.equal(keywordStrength('xmas2024', HOLIDAY_KEYWORDS.christmas), 1);
  assert.equal(keywordStrength('Reid family reunion', HOLIDAY_KEYWORDS['eid-al-fitr']), -1);
  assert.ok(keywordStrength('Eid 2025', HOLIDAY_KEYWORDS['eid-al-fitr']) >= 0);
  assert.equal(keywordStrength('Mother’s Day brunch', HOLIDAY_KEYWORDS['mothers-day']), 0);
  assert.equal(keywordStrength('', HOLIDAY_KEYWORDS.christmas), -1);
  assert.equal(matchesCustomTag({ name: 'Picks', value: 'Cards/Picks' }, ['picks']), true);
  assert.equal(matchesCustomTag({ name: 'Picks', value: 'Cards/Picks' }, ['Cards/Picks']), true);
  assert.equal(matchesCustomTag({ name: 'Picks', value: 'Cards/Picks' }, ['cards']), false);
  assert.equal(matchesCustomTag({ name: 'Picks' }, ['  ']), false);
});

test('holiday preferences are validated before they are stored', () => {
  assert.deepEqual(sanitizeHolidayPrefs(null), DEFAULT_HOLIDAY_PREFS);
  assert.deepEqual(sanitizeHolidayPrefs('nope'), DEFAULT_HOLIDAY_PREFS);
  const p = sanitizeHolidayPrefs({
    showHomeBanner: 'yes',
    lookaheadDays: 50,
    hiddenOccasions: ['halloween', 'halloween', 'not-a-holiday', 7],
    customTagMap: { christmas: [' card-picks ', '<script>', 'card-picks', ''], nope: ['x'], easter: [] },
  });
  assert.equal(p.showHomeBanner, true, 'non-boolean ignored');
  assert.equal(p.lookaheadDays, 60, 'only 30/45/60/90');
  assert.deepEqual(p.hiddenOccasions, ['halloween']);
  assert.deepEqual(p.customTagMap, { christmas: ['card-picks'] });
  const many = sanitizeHolidayPrefs({ customTagMap: { christmas: Array.from({ length: 40 }, (_, i) => `tag-${i}`) } });
  assert.equal(many.customTagMap.christmas.length, MAX_CUSTOM_TAGS);
  // A partial update keeps the rest.
  const merged = sanitizeHolidayPrefs({ lookaheadDays: 90 }, { ...DEFAULT_HOLIDAY_PREFS, hiddenOccasions: ['easter'], customTagMap: {} });
  assert.equal(merged.lookaheadDays, 90);
  assert.deepEqual(merged.hiddenOccasions, ['easter']);
});
