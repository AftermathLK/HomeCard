import { palette } from './harmony';
import type { GreetingStyle, ThemeColors } from './types';

export type OccasionCategory = 'winter' | 'spring-summer' | 'autumn' | 'milestone';

export const OCCASION_CATEGORIES: Array<{ id: OccasionCategory; name: string }> = [
  { id: 'winter', name: 'Winter & Year-End' },
  { id: 'spring-summer', name: 'Spring & Summer' },
  { id: 'autumn', name: 'Autumn' },
  { id: 'milestone', name: 'Life Milestones & Custom' },
];

export interface Greeting {
  headline: string;
  subhead?: string;
  message?: string;
}

export interface OccasionPalette {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface Occasion {
  id: string;
  name: string;
  category: OccasionCategory;
  icon: string;
  aliases: string[];
  when: string;
  ornaments: string[];
  palettes: OccasionPalette[];
  pairing: string;
  frontTemplate: string;
  /** Which year the {{year}} token defaults to. */
  yearMode: 'current' | 'next' | 'auto';
  greetings: Record<GreetingStyle, Greeting[]>;
  letterIntro: string;
  defaultFoil?: string;
}

export const GREETING_STYLES: Array<{ id: GreetingStyle; name: string; hint: string }> = [
  { id: 'short', name: 'Short & Sweet', hint: 'A few words, lots of photo' },
  { id: 'warm', name: 'Warm', hint: 'Heartfelt and cozy' },
  { id: 'formal', name: 'Formal', hint: 'Elegant and classic' },
  { id: 'humorous', name: 'Humorous', hint: 'A wink and a smile' },
  { id: 'family-update', name: 'Family Update', hint: 'Includes a year-in-review letter' },
];

export const SIGNOFFS: Record<GreetingStyle, string> = {
  short: '{{family}}',
  warm: 'With love, {{family}}',
  formal: 'With warm regards, {{family}}',
  humorous: 'Cheers, {{family}}',
  'family-update': 'Love, {{family}}',
};

export const PLACEHOLDER_FAMILY = 'The Smith Family';

/** Strings that indicate unedited placeholder copy. */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /the smith family/i,
  /your names? here/i,
  /lorem ipsum/i,
  /\[[^\]]{3,}\]/,
  /add your (message|text|names?)/i,
  /123 (main|holiday) (st|street|lane)/i,
];

const p = (id: string, name: string, bg: string, text: string, accent: string, accent2: string): OccasionPalette => ({
  id,
  name,
  colors: palette(bg, text, accent, accent2),
});
const g = (headline: string, subhead?: string, message?: string): Greeting => ({ headline, subhead, message });

const GENERIC_LETTER =
  'Dear friends and family,\n\n[Share the biggest highlight of your year here — a trip, a new job, a new tooth!]\n\n[Add a favorite moment for each member of the family.]\n\nThank you for being part of our story. We hope the year ahead brings you health, laughter and plenty of reasons to celebrate.';

export const OCCASIONS: Occasion[] = [
  /* ------------------------------- Winter ------------------------------- */
  {
    id: 'christmas', name: 'Christmas', category: 'winter', icon: 'tree', aliases: ['xmas', 'noel', 'merry'], when: 'December 25',
    ornaments: ['tree', 'holly', 'snowflake', 'bauble', 'pine-branch', 'star', 'wreath', 'candy-cane', 'stocking', 'gift', 'snowfall', 'sparkles'],
    palettes: [
      p('classic-evergreen', 'Classic Evergreen', '#f7f3ea', '#1f3d2b', '#a4161a', '#c9a54a'),
      p('midnight-pine', 'Midnight Pine', '#14281d', '#f4efe3', '#d4af37', '#c0392b'),
      p('candy-cane', 'Candy Cane', '#ffffff', '#2b2b2b', '#c8102e', '#2f6b4f'),
      p('nordic-snow', 'Nordic Snow', '#eef2f3', '#23384a', '#9c2b2b', '#7a9aa8'),
    ],
    pairing: 'script-sans', frontTemplate: 'full-bleed-classic', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Merry Christmas'), g('Merry & Bright'), g('Joy to the World')],
      warm: [g('Merry Christmas', 'and a Happy New Year', 'Wishing you a season filled with warmth, laughter and the people you love most.'), g('Home for Christmas', undefined, 'May your home be filled with love and your heart with peace this Christmas.')],
      formal: [g('Season’s Greetings', 'and best wishes for the New Year', 'With warmest wishes for a joyous Christmas and a peaceful New Year.'), g('Merry Christmas', undefined, 'May the peace and joy of Christmas be with you today and throughout the New Year.')],
      humorous: [g('Merry Christmas, Ya Filthy Animals!'), g('Our Elves Are Tired', 'Merry Christmas anyway', 'We survived another year — mostly on cookies and caffeine.'), g('Sleigh All Day')],
      'family-update': [g('Merry Christmas', 'from our family to yours', 'Here’s a little look at our year…'), g('Our Year in Review', 'Merry Christmas & Happy New Year')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'hanukkah', name: 'Hanukkah', category: 'winter', icon: 'menorah', aliases: ['chanukah', 'festival of lights'], when: '8 nights in Kislev (Nov–Dec)',
    ornaments: ['menorah', 'star-of-david', 'dreidel', 'snowflake', 'sparkles', 'divider-diamond'],
    palettes: [
      p('blue-silver', 'Blue & Silver', '#f3f6fb', '#102a5c', '#2f5fb3', '#9aa5b1'),
      p('midnight-lights', 'Midnight Lights', '#0f1f3d', '#f1f4fa', '#d4af37', '#6f9be0'),
      p('winter-white', 'Winter White', '#ffffff', '#1e2f50', '#c9a54a', '#5b7db1'),
    ],
    pairing: 'engraved', frontTemplate: 'gallery-frame', yearMode: 'current', defaultFoil: 'silver',
    greetings: {
      short: [g('Happy Hanukkah'), g('Chag Sameach'), g('Let It Glow')],
      warm: [g('Happy Hanukkah', undefined, 'May the lights of Hanukkah fill your home with warmth and your heart with joy.'), g('Eight Nights of Light', undefined, 'Wishing you love, latkes and light all eight nights.')],
      formal: [g('Hanukkah Greetings', undefined, 'Wishing you and your family a joyous and peaceful Festival of Lights.'), g('Chag Urim Sameach', 'A Happy Festival of Lights')],
      humorous: [g('Oy to the World'), g('Latke Love', undefined, 'May your latkes be crispy and your dreidel always land on gimel.')],
      'family-update': [g('Happy Hanukkah', 'from our family to yours', 'Eight nights, one family update…'), g('Our Year in Light')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'kwanzaa', name: 'Kwanzaa', category: 'winter', icon: 'kinara', aliases: ['habari gani'], when: 'December 26 – January 1',
    ornaments: ['kinara', 'sun', 'wheat', 'divider-diamond', 'sparkles'],
    palettes: [
      p('kinara', 'Kinara', '#f6efe2', '#1d1a16', '#b22222', '#1f7a3a'),
      p('harvest-night', 'Harvest Night', '#1d1a16', '#f6efe2', '#e0a526', '#2e8b57'),
    ],
    pairing: 'serif-classic', frontTemplate: 'split-half', yearMode: 'current',
    greetings: {
      short: [g('Happy Kwanzaa'), g('Habari Gani?')],
      warm: [g('Happy Kwanzaa', undefined, 'Wishing you unity, purpose and joy as we celebrate family, community and culture.'), g('Joyous Kwanzaa', undefined, 'May the seven principles light your way into the new year.')],
      formal: [g('Kwanzaa Greetings', undefined, 'With best wishes for a meaningful Kwanzaa and a prosperous New Year.')],
      humorous: [g('Seven Days, Seven Principles', 'and seven plates of food')],
      'family-update': [g('Happy Kwanzaa', 'from our family to yours', 'Here’s what we’ve been up to this year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'holiday', name: 'Season’s Greetings', category: 'winter', icon: 'snowflake', aliases: ['happy holidays', 'secular', 'seasons greetings', 'winter'], when: 'December',
    ornaments: ['snowflake', 'snowflake-crystal', 'pine-branch', 'olive-branch', 'sparkles', 'star', 'wreath', 'snowfall', 'flourish'],
    palettes: [
      p('winter-berry', 'Winter Berry', '#f8f4ef', '#3b1f2b', '#8e2c48', '#4a6b5d'),
      p('frosted-sage', 'Frosted Sage', '#eef1ec', '#263a33', '#5e7c6c', '#c08a5b'),
      p('gilded-navy', 'Gilded Navy', '#17233b', '#f3eee2', '#d1a954', '#8fa8c8'),
    ],
    pairing: 'editorial', frontTemplate: 'full-bleed-classic', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Happy Holidays'), g('Season’s Greetings'), g('Peace & Joy')],
      warm: [g('Happy Holidays', undefined, 'Wishing you cozy nights, bright mornings and all the joy the season can hold.'), g('Warmest Wishes', undefined, 'May your holidays be merry and your new year be bright.')],
      formal: [g('Season’s Greetings', undefined, 'With best wishes for a happy holiday season and a peaceful New Year.'), g('Peace on Earth', undefined, 'Wishing you peace and happiness this holiday season and throughout the year.')],
      humorous: [g('Happy Holidays!', undefined, 'Our New Year’s resolution: send cards on time. Nailed it.'), g('Let It Snow', 'somewhere else')],
      'family-update': [g('Happy Holidays', 'from all of us', 'A little peek at our year…'), g('Our Year in Review')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'winter-solstice', name: 'Winter Solstice', category: 'winter', icon: 'sun', aliases: ['yule', 'solstice', 'longest night'], when: 'December 21',
    ornaments: ['sun', 'moon-stars', 'snowflake-crystal', 'pine-branch', 'sparkles', 'snowfall'],
    palettes: [
      p('longest-night', 'Longest Night', '#121a2e', '#eef0f7', '#f2c14e', '#7e8fc7'),
      p('ice-ember', 'Ice & Ember', '#eef3f6', '#1f2c3a', '#d1603d', '#5d7f99'),
    ],
    pairing: 'modern-minimal', frontTemplate: 'circle-medallion', yearMode: 'current',
    greetings: {
      short: [g('Happy Solstice'), g('Return of the Light'), g('Blessed Yule')],
      warm: [g('Happy Winter Solstice', undefined, 'As the days grow longer, may your heart grow lighter. Wishing you warmth on the longest night.')],
      formal: [g('Solstice Greetings', undefined, 'Wishing you peace on the longest night and light in the year ahead.')],
      humorous: [g('It’s All Uphill From Here', 'Happy Solstice', 'More daylight starting tomorrow. You’re welcome.')],
      'family-update': [g('Happy Solstice', 'from our hearth to yours', 'Here’s what lit up our year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'new-year', name: 'New Year’s', category: 'winter', icon: 'firework', aliases: ['happy new year', 'nye', 'new years'], when: 'January 1',
    ornaments: ['firework', 'champagne', 'sparkles', 'confetti', 'star', 'frame-deco', 'divider-stars'],
    palettes: [
      p('champagne', 'Champagne', '#f8f3e6', '#1d1d1f', '#b8892c', '#6b6b6b'),
      p('midnight-gold', 'Midnight Gold', '#0d0d12', '#f5f1e6', '#d4af37', '#9f86c0'),
      p('confetti-pop', 'Confetti Pop', '#ffffff', '#1b1b3a', '#e4572e', '#3a86ff'),
    ],
    pairing: 'poster', frontTemplate: 'year-badge-hero', yearMode: 'next', defaultFoil: 'gold',
    greetings: {
      short: [g('Happy New Year'), g('Cheers to {{year}}'), g('Hello, {{year}}')],
      warm: [g('Happy New Year', undefined, 'Here’s to new adventures, old friends and a year full of love.'), g('Cheers to {{year}}', undefined, 'Thank you for making last year so special. We can’t wait to see what this one brings.')],
      formal: [g('Happy New Year', undefined, 'With best wishes for health, happiness and prosperity in {{year}}.'), g('Season’s Greetings', 'and best wishes for {{year}}')],
      humorous: [g('New Year, Same Us', undefined, 'We resolved to be more organized. This card is proof it’s working.'), g('Pop the Bubbly', 'it’s {{year}}!')],
      'family-update': [g('Happy New Year', 'our year in review', 'Cheers to everything this past year gave us…'), g('Hello, {{year}}', 'Goodbye to a wonderful year')],
    },
    letterIntro: GENERIC_LETTER,
  },
  /* --------------------------- Spring & Summer -------------------------- */
  {
    id: 'valentines', name: 'Valentine’s Day', category: 'spring-summer', icon: 'heart', aliases: ['valentine', 'love'], when: 'February 14',
    ornaments: ['heart', 'hearts', 'heart-outline', 'sparkles', 'envelope', 'frame-scallop'],
    palettes: [
      p('blush', 'Blush', '#fbeff0', '#4a1c24', '#d1495b', '#f2a7b4'),
      p('crimson', 'Crimson', '#7a1020', '#fff3f3', '#f7c6cf', '#ffd6a5'),
    ],
    pairing: 'romantic', frontTemplate: 'heart-cutout', yearMode: 'current', defaultFoil: 'rose-gold',
    greetings: {
      short: [g('Be Mine'), g('XOXO'), g('All You Need Is Love')],
      warm: [g('Happy Valentine’s Day', undefined, 'Sending you all our love today and every day.'), g('With Love', undefined, 'You make every day sweeter.')],
      formal: [g('Happy Valentine’s Day', undefined, 'With affection and warmest wishes.')],
      humorous: [g('You’re My Favorite Notification'), g('I Like You More Than Pizza', 'and that’s saying a lot')],
      'family-update': [g('Love From Our Family', 'Happy Valentine’s Day', 'A little love note about our year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'lunar-new-year', name: 'Lunar New Year', category: 'spring-summer', icon: 'lunar-lantern', aliases: ['chinese new year', 'tet', 'seollal', 'spring festival'], when: 'January–February',
    ornaments: ['lunar-lantern', 'plum-blossom', 'firework', 'sparkles', 'divider-diamond'],
    palettes: [
      p('red-gold', 'Red & Gold', '#b3121f', '#fff5e1', '#f2c14e', '#ffd8a8'),
      p('plum-blossom', 'Plum Blossom', '#fbf1ec', '#3b1f1f', '#c0392b', '#d4a017'),
    ],
    pairing: 'serif-classic', frontTemplate: 'arch-window', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Happy Lunar New Year'), g('Gong Xi Fa Cai'), g('Prosperity & Joy')],
      warm: [g('Happy Lunar New Year', undefined, 'Wishing you good health, happiness and good fortune in the year ahead.')],
      formal: [g('Lunar New Year Greetings', undefined, 'With best wishes for prosperity and peace in the New Year.')],
      humorous: [g('Dumplings Before Diets', 'Happy Lunar New Year')],
      'family-update': [g('Happy Lunar New Year', 'from our family to yours', 'Here’s to the year behind us and the luck ahead…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'st-patricks', name: 'St. Patrick’s Day', category: 'spring-summer', icon: 'shamrock', aliases: ['st patricks', 'paddy', 'irish'], when: 'March 17',
    ornaments: ['shamrock', 'sparkles', 'star', 'divider-diamond'],
    palettes: [
      p('emerald', 'Emerald', '#f2f7f1', '#12391f', '#1e8449', '#d4af37'),
      p('clover-night', 'Clover Night', '#0f3b25', '#f0f7ee', '#7bc96f', '#e8c547'),
    ],
    pairing: 'lively', frontTemplate: 'polaroid-single', yearMode: 'current',
    greetings: {
      short: [g('Lucky Us'), g('Happy St. Patrick’s Day'), g('Sláinte!')],
      warm: [g('Happy St. Patrick’s Day', undefined, 'May the luck of the Irish be with you today and always.')],
      formal: [g('St. Patrick’s Day Greetings', undefined, 'May the road rise up to meet you.')],
      humorous: [g('Feeling Lucky', 'and a little green'), g('Kiss Me, I’m Irish(ish)')],
      'family-update': [g('Top o’ the Morning', 'a lucky little update', 'Here’s what’s new with us…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'easter', name: 'Easter', category: 'spring-summer', icon: 'egg', aliases: ['spring', 'he is risen'], when: 'March–April',
    ornaments: ['egg', 'bunny', 'tulip', 'olive-branch', 'sparkles', 'frame-scallop'],
    palettes: [
      p('spring-pastel', 'Spring Pastel', '#fdf8ee', '#3a3550', '#e07a95', '#8cc0a8'),
      p('garden-morning', 'Garden Morning', '#f1f6ee', '#2e3d2f', '#e3a33b', '#9b8ec4'),
    ],
    pairing: 'lively', frontTemplate: 'scalloped-edge', yearMode: 'current',
    greetings: {
      short: [g('Happy Easter'), g('Hoppy Easter'), g('He Is Risen')],
      warm: [g('Happy Easter', undefined, 'Wishing you a joyful Easter filled with hope, love and springtime blessings.')],
      formal: [g('Easter Blessings', undefined, 'May the hope and joy of Easter be with you and your family.')],
      humorous: [g('Some Bunny Loves You'), g('Egg-cited for Spring')],
      'family-update': [g('Happy Easter', 'a spring update from our family', 'Spring has sprung, and so have we…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'passover', name: 'Passover', category: 'spring-summer', icon: 'kiddush-cup', aliases: ['pesach', 'seder'], when: 'March–April',
    ornaments: ['kiddush-cup', 'star-of-david', 'olive-branch', 'tulip', 'divider-diamond'],
    palettes: [
      p('spring-seder', 'Spring Seder', '#f7f4ec', '#23364d', '#6b2d5c', '#b49b57'),
      p('olive-wine', 'Olive & Wine', '#faf6ef', '#2f3a2a', '#7d2a3a', '#8a9a5b'),
    ],
    pairing: 'engraved', frontTemplate: 'gallery-frame', yearMode: 'current',
    greetings: {
      short: [g('Chag Pesach Sameach'), g('Happy Passover')],
      warm: [g('Happy Passover', undefined, 'Wishing you a sweet and meaningful Passover surrounded by family and friends.')],
      formal: [g('Passover Greetings', undefined, 'May your Seder be filled with meaning and your home with peace.')],
      humorous: [g('Let My People Snack'), g('Matzah Ball Champions')],
      'family-update': [g('Happy Passover', 'from our table to yours', 'A sweet update from our family…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'eid-al-fitr', name: 'Eid al-Fitr', category: 'spring-summer', icon: 'crescent-star', aliases: ['eid mubarak', 'ramadan', 'eid'], when: 'End of Ramadan',
    ornaments: ['crescent-star', 'lantern', 'moon-stars', 'sparkles', 'rangoli', 'divider-stars'],
    palettes: [
      p('emerald-night', 'Emerald Night', '#0f3a3a', '#f4efe2', '#d4af37', '#6fb7a8'),
      p('desert-dawn', 'Desert Dawn', '#faf3e8', '#2c2a4a', '#c27b3a', '#2f7d78'),
    ],
    pairing: 'romantic', frontTemplate: 'arch-window', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Eid Mubarak'), g('Blessed Eid')],
      warm: [g('Eid Mubarak', undefined, 'May this Eid bring peace, happiness and many blessings to you and your loved ones.')],
      formal: [g('Eid Mubarak', undefined, 'With warmest wishes for a blessed and joyous Eid al-Fitr.')],
      humorous: [g('Eid Mubarak!', undefined, 'Officially back to brunch.')],
      'family-update': [g('Eid Mubarak', 'from our family to yours', 'A little update after a beautiful Ramadan…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'eid-al-adha', name: 'Eid al-Adha', category: 'spring-summer', icon: 'lantern', aliases: ['eid', 'adha', 'eid mubarak'], when: '10 Dhu al-Hijjah',
    ornaments: ['lantern', 'crescent-star', 'moon-stars', 'sparkles', 'divider-stars'],
    palettes: [
      p('sapphire-gold', 'Sapphire Gold', '#102a4c', '#f6f0e1', '#d9b25f', '#6c9bd2'),
      p('sand-teal', 'Sand & Teal', '#f7f0e4', '#2b2f36', '#1f7a7a', '#c08a3e'),
    ],
    pairing: 'romantic', frontTemplate: 'arch-window', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Eid al-Adha Mubarak'), g('Blessed Eid')],
      warm: [g('Eid Mubarak', undefined, 'Wishing you and your family a blessed Eid al-Adha full of love, gratitude and togetherness.')],
      formal: [g('Eid al-Adha Mubarak', undefined, 'May your sacrifices be accepted and your prayers answered.')],
      humorous: [g('Eid Mubarak!', undefined, 'Save us a plate.')],
      'family-update': [g('Eid Mubarak', 'from our family to yours', 'With gratitude for the year we’ve had…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'mothers-day', name: 'Mother’s Day', category: 'spring-summer', icon: 'tulip', aliases: ['mom', 'mum', 'mama'], when: 'May (US: 2nd Sunday)',
    ornaments: ['tulip', 'heart', 'hearts', 'plum-blossom', 'frame-scallop', 'flourish'],
    palettes: [
      p('peony', 'Peony', '#fdf1f2', '#4b2a36', '#d36b8c', '#8fb59a'),
      p('lilac', 'Lilac', '#f5f1fa', '#3a2d4f', '#8e6bbf', '#e8a87c'),
    ],
    pairing: 'romantic', frontTemplate: 'polaroid-scrapbook', yearMode: 'current',
    greetings: {
      short: [g('Happy Mother’s Day'), g('Love You, Mom'), g('Best Mom Ever')],
      warm: [g('Happy Mother’s Day', undefined, 'Thank you for your endless love, patience and laughter. We love you more than words can say.')],
      formal: [g('Happy Mother’s Day', undefined, 'With gratitude and love on your special day.')],
      humorous: [g('Thanks for Not Selling Us', 'Happy Mother’s Day'), g('Mom: Unpaid Chef, Chauffeur & Hero')],
      'family-update': [g('Happy Mother’s Day', 'a few of our favorite moments', 'Look how far we’ve come together…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'fathers-day', name: 'Father’s Day', category: 'spring-summer', icon: 'necktie', aliases: ['dad', 'papa'], when: 'June (US: 3rd Sunday)',
    ornaments: ['necktie', 'star', 'sun', 'divider-diamond', 'laurel'],
    palettes: [
      p('navy-tan', 'Navy & Tan', '#f4efe6', '#1e2d45', '#2d4b73', '#b07d48'),
      p('forest-plaid', 'Forest Plaid', '#1f3326', '#f2eee4', '#c8a165', '#8fae7e'),
    ],
    pairing: 'serif-classic', frontTemplate: 'split-half', yearMode: 'current',
    greetings: {
      short: [g('Happy Father’s Day'), g('Best Dad Ever'), g('Our Hero')],
      warm: [g('Happy Father’s Day', undefined, 'Thank you for the advice, the hugs and the terrible jokes. We love you!')],
      formal: [g('Happy Father’s Day', undefined, 'With love, respect and gratitude.')],
      humorous: [g('Dad Joke Champion', 'Happy Father’s Day'), g('Hi Hungry, I’m Dad')],
      'family-update': [g('Happy Father’s Day', 'adventures with Dad', 'Some of our favorite moments this year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'graduation', name: 'Graduation', category: 'spring-summer', icon: 'grad-cap', aliases: ['grad', 'class of', 'commencement'], when: 'May–June',
    ornaments: ['grad-cap', 'laurel', 'star', 'firework', 'confetti', 'sparkles'],
    palettes: [
      p('gold-black', 'Gold & Black', '#111111', '#f8f4e8', '#d4af37', '#8a8a8a'),
      p('school-spirit', 'School Spirit', '#ffffff', '#1b2a4a', '#c8102e', '#1b4f9c'),
    ],
    pairing: 'poster', frontTemplate: 'year-badge-hero', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Class of {{year}}'), g('Congrats, Grad!'), g('She Did It!')],
      warm: [g('Class of {{year}}', undefined, 'We’re so proud of everything you’ve accomplished. The best is yet to come!')],
      formal: [g('Graduation Announcement', undefined, 'With pride we announce the graduation of\n[Graduate’s Name]\nClass of {{year}}')],
      humorous: [g('Finally!', 'Class of {{year}}', 'The tassel was worth the hassle.')],
      'family-update': [g('Class of {{year}}', 'celebrating our graduate', 'From first day to graduation day…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'july-4', name: 'Independence Day', category: 'spring-summer', icon: 'firework', aliases: ['4th of july', 'fourth of july', 'independence', 'usa'], when: 'July 4',
    ornaments: ['firework', 'star', 'star-outline', 'bunting', 'divider-stars', 'confetti'],
    palettes: [
      p('old-glory', 'Old Glory', '#fbfaf6', '#13294b', '#b22234', '#3c5a99'),
      p('firework-night', 'Firework Night', '#0b1a33', '#f5f5f5', '#e63946', '#a8dadc'),
    ],
    pairing: 'festive-bold', frontTemplate: 'collage-3-hero', yearMode: 'current',
    greetings: {
      short: [g('Happy 4th of July'), g('Land of the Free'), g('Stars & Stripes')],
      warm: [g('Happy Independence Day', undefined, 'Wishing you sunshine, sparklers and time with the people you love.')],
      formal: [g('Happy Independence Day', undefined, 'With best wishes on this celebration of freedom.')],
      humorous: [g('Red, White & BBQ'), g('Party Like It’s 1776')],
      'family-update': [g('Happy 4th', 'our summer so far', 'Here’s what we’ve been up to this summer…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  /* ------------------------------- Autumn ------------------------------- */
  {
    id: 'rosh-hashanah', name: 'Rosh Hashanah', category: 'autumn', icon: 'apple', aliases: ['shana tova', 'jewish new year'], when: 'September–October',
    ornaments: ['apple', 'pomegranate', 'star-of-david', 'kiddush-cup', 'divider-diamond'],
    palettes: [
      p('apples-honey', 'Apples & Honey', '#fbf5e8', '#3d2a1e', '#b23a2f', '#d9a441'),
      p('pomegranate', 'Pomegranate', '#4a1424', '#f9efe6', '#e8b04b', '#c9576b'),
    ],
    pairing: 'editorial', frontTemplate: 'split-half', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Shana Tova'), g('A Sweet New Year')],
      warm: [g('Shana Tova', undefined, 'Wishing you a sweet, healthy and happy New Year.')],
      formal: [g('L’Shana Tova', undefined, 'May you be inscribed and sealed for a good year.')],
      humorous: [g('Have a Honey of a Year')],
      'family-update': [g('Shana Tova', 'a sweet update from our family', 'Looking back on a year of blessings…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'diwali', name: 'Diwali', category: 'autumn', icon: 'diya', aliases: ['deepavali', 'festival of lights'], when: 'October–November',
    ornaments: ['diya', 'rangoli', 'lantern', 'lunar-lantern', 'sparkles', 'firework'],
    palettes: [
      p('festival-lights', 'Festival of Lights', '#3b0f40', '#fff3d6', '#f4b400', '#ff6f3c'),
      p('marigold', 'Marigold', '#fff6e5', '#4a1a1a', '#e8891d', '#c2185b'),
    ],
    pairing: 'parisian', frontTemplate: 'circle-medallion', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Happy Diwali'), g('Shubh Deepavali'), g('Let There Be Light')],
      warm: [g('Happy Diwali', undefined, 'May the festival of lights brighten your home with joy, prosperity and love.')],
      formal: [g('Diwali Greetings', undefined, 'Wishing you and your family a prosperous and joyous Diwali.')],
      humorous: [g('Lit Since Forever', 'Happy Diwali'), g('Sweets, Lights & Good Vibes')],
      'family-update': [g('Happy Diwali', 'from our family to yours', 'A bright little update from our year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'halloween', name: 'Halloween', category: 'autumn', icon: 'pumpkin', aliases: ['spooky', 'trick or treat'], when: 'October 31',
    ornaments: ['pumpkin', 'bat', 'moon-stars', 'maple-leaf', 'sparkles'],
    palettes: [
      p('pumpkin-night', 'Pumpkin Night', '#161616', '#f6efe4', '#f28c28', '#8a4fff'),
      p('spooky-sweet', 'Spooky Sweet', '#f6efe4', '#2a1e2e', '#e2711d', '#6a4c93'),
    ],
    pairing: 'festive-bold', frontTemplate: 'collage-4-grid', yearMode: 'current',
    greetings: {
      short: [g('Happy Halloween'), g('Trick or Treat'), g('Boo!')],
      warm: [g('Happy Halloween', undefined, 'Wishing you a night full of treats and not too many tricks!')],
      formal: [g('Halloween Greetings', undefined, 'Wishing you a spooktacular evening.')],
      humorous: [g('Resting Witch Face'), g('Here for the Boos')],
      'family-update': [g('Happy Halloween', 'meet our little monsters', 'Costumes, candy and a few frights…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'thanksgiving', name: 'Thanksgiving', category: 'autumn', icon: 'maple-leaf', aliases: ['grateful', 'harvest', 'friendsgiving'], when: 'November (US: 4th Thursday)',
    ornaments: ['maple-leaf', 'wheat', 'pumpkin', 'apple', 'olive-branch', 'laurel'],
    palettes: [
      p('harvest', 'Harvest', '#f8f0e3', '#3b2416', '#b5541f', '#8a8d3c'),
      p('autumn-ember', 'Autumn Ember', '#3a2117', '#f8ecd9', '#e0973a', '#b8a05a'),
    ],
    pairing: 'cozy-handwritten', frontTemplate: 'split-third-band', yearMode: 'current', defaultFoil: 'copper',
    greetings: {
      short: [g('Happy Thanksgiving'), g('Grateful & Blessed'), g('Give Thanks')],
      warm: [g('Happy Thanksgiving', undefined, 'We are so thankful for you. Wishing you a table full of food and a heart full of gratitude.')],
      formal: [g('Thanksgiving Greetings', undefined, 'With gratitude for your friendship and best wishes for a bountiful season.')],
      humorous: [g('Eat, Drink & Be Thankful', undefined, 'Stretchy pants recommended.'), g('Gobble ’Til You Wobble')],
      'family-update': [g('Happy Thanksgiving', 'what we’re thankful for this year', 'Counting our blessings…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  /* --------------------------- Milestones ------------------------------- */
  {
    id: 'birth', name: 'Birth Announcement', category: 'milestone', icon: 'rattle', aliases: ['baby', 'newborn', 'welcome', 'its a boy', 'its a girl'], when: 'Any time',
    ornaments: ['rattle', 'onesie', 'moon-stars', 'heart', 'balloon', 'frame-scallop', 'sparkles'],
    palettes: [
      p('soft-neutral', 'Soft Neutral', '#faf7f2', '#3d3a36', '#b0896a', '#a7c4bc'),
      p('baby-blue', 'Baby Blue', '#eef5fb', '#24405c', '#5b93c7', '#e8c9a0'),
      p('blush-pink', 'Blush Pink', '#fdf2f3', '#4a2e35', '#d9849a', '#c8b28a'),
    ],
    pairing: 'signature', frontTemplate: 'full-bleed-top-title', yearMode: 'current',
    greetings: {
      short: [g('Hello, World'), g('Welcome, Little One'), g('Introducing…')],
      warm: [g('Welcome to the World', '[Baby’s Full Name]', 'Born [Month Day, Year] · [Weight] · [Length]\nOur hearts are so full.')],
      formal: [g('Introducing', '[Baby’s Full Name]', 'Born [Month Day, Year] at [Time]\n[Weight] · [Length]')],
      humorous: [g('Fresh Out of the Oven', '[Baby’s Name]', 'Batteries not included. Sleep not included either.')],
      'family-update': [g('Our Newest Addition', '[Baby’s Full Name]', 'Born [Month Day, Year]. Mom and baby are doing great!')],
    },
    letterIntro: 'Dear friends and family,\n\n[Share the story of the big day.]\n\n[Add a few fun facts — first impressions, nicknames, who they look like.]\n\nThank you for all of your love and support.',
  },
  {
    id: 'birthday', name: 'Birthday', category: 'milestone', icon: 'cake', aliases: ['bday', 'happy birthday', 'milestone birthday', '30th', '40th', '50th', 'party'], when: 'Any time',
    ornaments: ['cake', 'balloon', 'gift', 'confetti', 'champagne', 'sparkles', 'bunting'],
    palettes: [
      p('champagne-toast', 'Champagne Toast', '#17151c', '#f6efe2', '#d8b45a', '#a89cc8'),
      p('confetti-pop', 'Confetti Pop', '#fffaf3', '#2b2540', '#c8455f', '#d9932b'),
    ],
    pairing: 'festive-bold', frontTemplate: 'polaroid-single', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Happy Birthday', 'Wishing you a wonderful year ahead'), g('Make a Wish'), g('Cheers to You!')],
      warm: [g('Happy Birthday', 'Wishing you a wonderful year ahead', 'May this year bring you joy, laughter and everything you love.')],
      formal: [g('Birthday Celebration', 'In honour of [Name]', '[Day, Date] at [Time]\n[Location]\nRSVP [Name, Phone]')],
      humorous: [g('Another Trip Around the Sun', 'and still the life of the party', 'Here’s to cake first and candles second.')],
      'family-update': [g('Happy Birthday', '[Name]', 'Another wonderful year of [Name]…')],
    },
    letterIntro: 'Dear [Name],\n\n[A favourite memory from this past year.]\n\nWishing you the happiest of birthdays and a wonderful year ahead.',
  },
  {
    id: 'first-birthday', name: 'First Birthday', category: 'milestone', icon: 'cake', aliases: ['birthday', 'one', 'turning one', 'party'], when: 'Any time',
    ornaments: ['cake', 'balloon', 'bunting', 'confetti', 'star', 'sparkles'],
    palettes: [
      p('party-pop', 'Party Pop', '#fffaf0', '#2f2a4a', '#ff6b6b', '#4ecdc4'),
      p('little-one', 'Little One', '#f3f7fb', '#2a3d55', '#f4a259', '#8cb8d8'),
    ],
    pairing: 'lively', frontTemplate: 'collage-5-mosaic', yearMode: 'current',
    greetings: {
      short: [g('ONE'), g('Happy 1st Birthday'), g('Look Who’s One!')],
      warm: [g('Our Little One Is One', '[Baby’s Name]', 'Join us to celebrate [Name]’s first birthday!\n[Day, Date] · [Time]\n[Location]')],
      formal: [g('First Birthday Celebration', '[Baby’s Name]', '[Day, Date] at [Time]\n[Location]\nRSVP [Name, Phone]')],
      humorous: [g('Wild ONE', undefined, 'Cake smashing at [Time]. Bring napkins.')],
      'family-update': [g('One Amazing Year', '[Baby’s Name] is one!', 'A year of firsts…')],
    },
    letterIntro: 'Dear friends and family,\n\n[A few favorite firsts from this year — first smile, first steps, first word.]\n\nThank you for loving our little one so well.',
  },
  {
    id: 'new-home', name: 'Moving / New Home', category: 'milestone', icon: 'house', aliases: ['moving', 'we moved', 'new address', 'housewarming'], when: 'Any time',
    ornaments: ['house', 'key', 'heart', 'olive-branch', 'bunting'],
    palettes: [
      p('front-door', 'Front Door', '#f6f3ee', '#263238', '#2f6f62', '#c9823b'),
      p('brick-ivy', 'Brick & Ivy', '#fbf6f0', '#3c2a24', '#9c3d2e', '#5b7f52'),
    ],
    pairing: 'cozy-handwritten', frontTemplate: 'split-half', yearMode: 'current',
    greetings: {
      short: [g('We’ve Moved!'), g('Home Sweet Home'), g('New Address')],
      warm: [g('We’ve Moved!', undefined, 'Our new address:\n[123 Street Name]\n[City, State ZIP]\nCome visit anytime!')],
      formal: [g('Please Note Our New Address', undefined, '[123 Street Name]\n[City, State ZIP]')],
      humorous: [g('We Moved!', undefined, 'Still unpacking. Send snacks.\n[123 Street Name], [City, State ZIP]')],
      'family-update': [g('Home Sweet Home', 'a new chapter', 'We’ve settled into our new home…')],
    },
    letterIntro: 'Dear friends and family,\n\n[Tell everyone about the new place and what you love about it.]\n\nOur door is always open!',
  },
  {
    id: 'wedding', name: 'Wedding', category: 'milestone', icon: 'rings', aliases: ['marriage', 'just married', 'invitation', 'newlyweds'], when: 'Any time',
    ornaments: ['rings', 'laurel', 'heart-outline', 'flourish', 'corner-flourish', 'frame-double', 'sparkles'],
    palettes: [
      p('ivory-gold', 'Ivory & Gold', '#fbf8f1', '#2e2a25', '#a8834a', '#8a9a8b'),
      p('dusty-rose', 'Dusty Rose', '#f7eeec', '#3e2c2c', '#b76e79', '#8c8c7a'),
    ],
    pairing: 'romantic', frontTemplate: 'gallery-frame', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Just Married'), g('Mr. & Mrs.'), g('Happily Ever After')],
      warm: [g('We Said I Do', '[Name] & [Name]', 'Thank you for celebrating our love with us.')],
      formal: [g('Together with their families', '[Name] & [Name]', 'request the pleasure of your company\nat the celebration of their marriage\n[Day, Date] at [Time]\n[Venue, City]')],
      humorous: [g('Game Over', '[Name] & [Name]', 'Officially stuck with each other.')],
      'family-update': [g('Just Married', '[Name] & [Name]', 'Our favorite moments from the big day…')],
    },
    letterIntro: 'Dear friends and family,\n\n[Share a favorite memory from the wedding day.]\n\nThank you for your love, support and generous gifts.',
  },
  {
    id: 'save-the-date', name: 'Save the Date', category: 'milestone', icon: 'envelope', aliases: ['engagement', 'engaged', 'std'], when: 'Any time',
    ornaments: ['heart-outline', 'rings', 'envelope', 'flourish', 'sparkles', 'frame-deco'],
    palettes: [
      p('modern-blush', 'Modern Blush', '#fbf1ee', '#2b2b2b', '#c97b84', '#7a8b8b'),
      p('black-tie', 'Black Tie', '#121212', '#f5f1e8', '#c9a96e', '#9e9e9e'),
    ],
    pairing: 'editorial', frontTemplate: 'full-bleed-classic', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Save the Date'), g('We’re Engaged!')],
      warm: [g('Save the Date', '[Name] & [Name]', '[Month Day, Year] · [City, State]\nFormal invitation to follow')],
      formal: [g('Please Save the Date', 'for the wedding of [Name] & [Name]', '[Month Day, Year]\n[City, State]')],
      humorous: [g('Save the Date', '[Name] & [Name]', 'Free food. Open bar. Mandatory dancing.\n[Month Day, Year]')],
      'family-update': [g('We’re Getting Married!', '[Name] & [Name]', 'The story of how it happened…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'thank-you', name: 'Thank You', category: 'milestone', icon: 'envelope', aliases: ['thanks', 'gratitude', 'appreciation'], when: 'Any time',
    ornaments: ['heart', 'tulip', 'olive-branch', 'sparkles', 'envelope', 'flourish', 'laurel'],
    palettes: [
      p('gratitude', 'Gratitude', '#faf7f0', '#2f3b35', '#c4793a', '#7f9c8a'),
      p('simply-sage', 'Simply Sage', '#eef2ec', '#2d3a30', '#5d7a63', '#c9a46b'),
    ],
    pairing: 'signature', frontTemplate: 'minimal-type', yearMode: 'current', defaultFoil: 'gold',
    greetings: {
      short: [g('Thank You'), g('Thanks a Bunch'), g('So Grateful')],
      warm: [g('Thank You', undefined, 'Your kindness means the world to us. We are so grateful for you.')],
      formal: [g('With Sincere Thanks', undefined, 'Thank you for your thoughtfulness and generosity.')],
      humorous: [g('You’re the Best', 'seriously, thank you')],
      'family-update': [g('Thank You', 'from all of us', 'Here’s how your kindness helped us this year…')],
    },
    letterIntro: GENERIC_LETTER,
  },
  {
    id: 'custom', name: 'Custom Occasion', category: 'milestone', icon: 'sparkle', aliases: ['blank', 'any', 'other', 'anniversary', 'announcement'], when: 'Any time',
    ornaments: ['sparkle', 'sparkles', 'star', 'heart', 'flourish', 'divider-diamond', 'laurel', 'frame-double', 'confetti'],
    palettes: [
      p('classic', 'Classic', '#faf8f4', '#222222', '#3d5a80', '#ee6c4d'),
      p('charcoal', 'Charcoal', '#222831', '#f2f2f2', '#f2a65a', '#7fc8a9'),
    ],
    pairing: 'editorial', frontTemplate: 'full-bleed-classic', yearMode: 'current',
    greetings: {
      short: [g('Hello!'), g('Celebrate'), g('Cheers!')],
      warm: [g('Thinking of You', undefined, 'Sending love and warm wishes your way.')],
      formal: [g('Best Wishes', undefined, 'With warmest regards.')],
      humorous: [g('Just Because', undefined, 'No reason. We just like you.')],
      'family-update': [g('A Little Update', 'from our family', 'Here’s what’s new with us…')],
    },
    letterIntro: GENERIC_LETTER,
  },
];

const BY_ID = new Map(OCCASIONS.map((o) => [o.id, o]));
export function getOccasion(id: string): Occasion {
  return BY_ID.get(id) ?? BY_ID.get('custom')!;
}

export function searchOccasions(q: string): Occasion[] {
  const s = q.trim().toLowerCase();
  if (!s) return OCCASIONS;
  return OCCASIONS.filter(
    (o) => o.name.toLowerCase().includes(s) || o.aliases.some((a) => a.includes(s)) || o.id.includes(s),
  );
}

/**
 * Last day (month 1–12, day) a card for a dated occasion is still sent for this year's date,
 * a little after the latest the occasion falls. After it, a new card is for next year's.
 * Moving dates (Easter, Eid, Diwali…) use the latest date they reach in the coming years.
 */
const SEASON_ENDS: Record<string, [number, number]> = {
  valentines: [2, 28],
  'lunar-new-year': [2, 28],
  'st-patricks': [3, 31],
  easter: [4, 30],
  passover: [4, 30],
  'eid-al-fitr': [4, 30],
  'mothers-day': [5, 31],
  'eid-al-adha': [6, 30],
  'fathers-day': [6, 30],
  'july-4': [7, 31],
  graduation: [8, 31],
  'rosh-hashanah': [10, 31],
  halloween: [11, 10],
  diwali: [11, 30],
  thanksgiving: [12, 5],
};

/**
 * Default year for an occasion relative to "now": the year of its next date. New Year cards from
 * September on target next year; a dated occasion whose season has passed (Valentine's Day in
 * November) targets next year's; Christmas-season and any-time occasions use this year.
 */
export function defaultYearFor(occasion: Occasion, now = new Date()): number {
  const y = now.getFullYear();
  if (occasion.yearMode === 'next') return now.getMonth() >= 8 ? y + 1 : y;
  const end = SEASON_ENDS[occasion.id];
  if (end && (now.getMonth() + 1 > end[0] || (now.getMonth() + 1 === end[0] && now.getDate() > end[1]))) return y + 1;
  return y;
}
