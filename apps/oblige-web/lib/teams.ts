/**
 * Club identity for the player face cards.
 *
 * Behind every player's face sits their club's own backdrop — the mark or
 * landmark you would recognise — washed in that club's two colours. Each
 * silhouette is drawn on the same 400x150 stage so every club crops
 * identically no matter which card it lands in.
 *
 * A club we do not carry still gets a stable identity rather than a blank
 * card: `fallbackTeam` derives a repeatable hue from the club's own code, so
 * the same club always looks the same without anyone hand-entering it.
 */

export type Art =
  | 'mountains' | 'stripes' | 'horns' | 'star' | 'arrow' | 'wing'
  | 'waves' | 'bison' | 'bridge' | 'skyline' | 'bolt' | 'crown'
  | 'pines' | 'shield' | 'sun';

export type Team = { name: string; c1: string; c2: string; art: Art };

/* Colours are each club's own primary and secondary, lifted where a very dark
   primary would disappear against the card. */
const T = (name: string, c1: string, c2: string, art: Art): Team => ({ name, c1, c2, art });

export const TEAMS: Record<string, Team> = {
  /* ---- NFL ---- */
  ARI: T('Arizona Cardinals', '#97233F', '#FFB612', 'shield'),
  ATL: T('Atlanta Falcons', '#A71930', '#A5ACAF', 'wing'),
  BAL: T('Baltimore Ravens', '#5C3C93', '#9E7C0C', 'wing'),
  BUF: T('Buffalo Bills', '#2360D8', '#FF5C79', 'bison'),
  CAR: T('Carolina Panthers', '#0085CA', '#BFC0BF', 'shield'),
  CHI: T('Chicago Bears', '#C83803', '#4A7BC4', 'skyline'),
  CIN: T('Cincinnati Bengals', '#FB4F14', '#FF9E6B', 'stripes'),
  CLE: T('Cleveland Browns', '#FF3C00', '#C8A579', 'shield'),
  DAL: T('Dallas Cowboys', '#2C5EA8', '#C3CDD8', 'star'),
  DEN: T('Denver Broncos', '#FB4F14', '#8FA8C8', 'mountains'),
  DET: T('Detroit Lions', '#0076B6', '#B0B7BC', 'shield'),
  GB: T('Green Bay Packers', '#2E6B4F', '#FFB612', 'pines'),
  HOU: T('Houston Texans', '#2F5FA8', '#C8102E', 'star'),
  IND: T('Indianapolis Colts', '#3B7FD4', '#C8CDD4', 'shield'),
  JAX: T('Jacksonville Jaguars', '#12A5A5', '#9F792C', 'shield'),
  KC: T('Kansas City Chiefs', '#E31837', '#FFB81C', 'arrow'),
  LAC: T('Los Angeles Chargers', '#0080C6', '#FFC20E', 'bolt'),
  LAR: T('Los Angeles Rams', '#2E6BD4', '#FFD100', 'horns'),
  LV: T('Las Vegas Raiders', '#6E7780', '#D8DDE2', 'shield'),
  MIA: T('Miami Dolphins', '#00A7B2', '#FC4C02', 'waves'),
  MIN: T('Minnesota Vikings', '#6D3AB0', '#FFC62F', 'horns'),
  NE: T('New England Patriots', '#2E4C82', '#C8102E', 'star'),
  NO: T('New Orleans Saints', '#B79C63', '#D8D3CC', 'shield'),
  NYG: T('New York Giants', '#1B4FA8', '#A71930', 'skyline'),
  NYJ: T('New York Jets', '#1B7A4C', '#D8DDE2', 'skyline'),
  PHI: T('Philadelphia Eagles', '#0B6E78', '#C7D0D2', 'wing'),
  PIT: T('Pittsburgh Steelers', '#7A7F86', '#FFB612', 'bridge'),
  SEA: T('Seattle Seahawks', '#2B6FA8', '#69BE28', 'wing'),
  SF: T('San Francisco 49ers', '#C8102E', '#D6BC7E', 'bridge'),
  TB: T('Tampa Bay Buccaneers', '#D50A0A', '#B6BCC2', 'waves'),
  TEN: T('Tennessee Titans', '#2F6FB8', '#4B92DB', 'shield'),
  WAS: T('Washington Commanders', '#7A2C1E', '#FFB612', 'shield'),

  /* ---- NBA ---- */
  ATLH: T('Atlanta Hawks', '#E03A3E', '#C1D32F', 'wing'),
  BOS: T('Boston Celtics', '#1B8A54', '#BA9653', 'shield'),
  BKN: T('Brooklyn Nets', '#8A8F96', '#D8DDE2', 'bridge'),
  CHA: T('Charlotte Hornets', '#1D9FC7', '#00788C', 'shield'),
  CHIB: T('Chicago Bulls', '#CE1141', '#B0B7BC', 'skyline'),
  CLEC: T('Cleveland Cavaliers', '#860038', '#FDBB30', 'shield'),
  DALM: T('Dallas Mavericks', '#3B7FD4', '#B8C4CA', 'star'),
  DEN_NBA: T('Denver Nuggets', '#5C7FB8', '#FEC524', 'mountains'),
  DET_NBA: T('Detroit Pistons', '#C8102E', '#5C88DA', 'shield'),
  GSW: T('Golden State Warriors', '#1D6FC7', '#FFC72C', 'bridge'),
  HOUR: T('Houston Rockets', '#CE1141', '#C4CED4', 'bolt'),
  INDP: T('Indiana Pacers', '#FDBB30', '#5C7FB8', 'shield'),
  LACL: T('LA Clippers', '#C8102E', '#1D428A', 'bolt'),
  LAL: T('Los Angeles Lakers', '#6A3FA0', '#FDB927', 'crown'),
  MEM: T('Memphis Grizzlies', '#5D76A9', '#12173F', 'shield'),
  MIAH: T('Miami Heat', '#C8385A', '#F9A01B', 'sun'),
  MIL: T('Milwaukee Bucks', '#1D7A4C', '#EEE1C6', 'horns'),
  MINT: T('Minnesota Timberwolves', '#3B7FD4', '#78BE21', 'pines'),
  NOP: T('New Orleans Pelicans', '#2C5EA8', '#B6952F', 'shield'),
  NYK: T('New York Knicks', '#F58426', '#3B7FD4', 'skyline'),
  OKC: T('Oklahoma City Thunder', '#2E7FD4', '#EF3B24', 'bolt'),
  ORL: T('Orlando Magic', '#3B7FD4', '#C4CED4', 'star'),
  PHIS: T('Philadelphia 76ers', '#2C5EA8', '#C8102E', 'shield'),
  PHX: T('Phoenix Suns', '#5C41A8', '#E56020', 'sun'),
  POR: T('Portland Trail Blazers', '#CE1141', '#C4CED4', 'mountains'),
  SAC: T('Sacramento Kings', '#6A3FA0', '#C4CED4', 'crown'),
  SAS: T('San Antonio Spurs', '#8A9199', '#D8DDE2', 'star'),
  TOR: T('Toronto Raptors', '#CE1141', '#B4975A', 'skyline'),
  UTA: T('Utah Jazz', '#3B7FD4', '#F9A01B', 'mountains'),
  WSH: T('Washington Wizards', '#2C5EA8', '#C8102E', 'shield'),
};

/** Silhouettes, all drawn on one 400x150 stage so every club crops the same. */
export const ART: Record<Art, string> = {
  mountains:
    '<path fill="currentColor" d="M0 150 70 60 112 102 168 34 232 118 274 76 348 150Z"/>' +
    '<path fill="#fff" opacity=".5" d="M168 34 146 60 160 64 174 55 188 66Z"/>' +
    '<path fill="#fff" opacity=".36" d="M70 60 54 80 66 82 76 75 88 84Z"/>',
  stripes:
    '<g fill="none" stroke="currentColor" stroke-width="17" stroke-linecap="round">' +
    '<path d="M18 154C58 112 58 70 28 22"/><path d="M96 154C136 110 132 66 104 16"/>' +
    '<path d="M174 154C214 110 210 66 182 16"/><path d="M252 154C292 110 288 66 260 16"/>' +
    '<path d="M330 154C370 110 366 66 338 16"/></g>',
  horns:
    '<g fill="none" stroke="currentColor" stroke-width="19" stroke-linecap="round">' +
    '<path d="M200 152C118 152 58 108 60 44 60 20 92 18 100 40 112 76 150 96 200 98"/>' +
    '<path d="M200 152c82 0 142-44 140-108 0-24-32-26-40-4-12 36-50 56-100 58"/></g>',
  star: '<path fill="currentColor" d="M200 14 218 67 274 68 230 102 246 155 200 123 154 155 171 102 126 68 182 67Z"/>',
  arrow: '<path fill="currentColor" d="M200 6 320 152 200 112 80 152Z"/>',
  wing:
    '<g fill="none" stroke="currentColor" stroke-width="13" stroke-linecap="round">' +
    '<path d="M28 152C90 126 140 92 176 42"/><path d="M76 152c58-22 106-54 140-100"/>' +
    '<path d="M124 152c56-20 102-50 134-94"/><path d="M172 152c54-18 98-46 128-88"/>' +
    '<path d="M220 152c52-16 94-42 122-82"/></g>',
  waves:
    '<g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round">' +
    '<path d="M-12 58Q50 26 112 58T236 58T360 58T484 58"/>' +
    '<path d="M-12 100Q50 68 112 100T236 100T360 100T484 100"/>' +
    '<path d="M-12 142Q50 110 112 142T236 142T360 142T484 142"/></g>',
  bison:
    '<path fill="currentColor" d="M58 152l4-48c0-18 13-31 33-35l24-4c9-23 31-33 58-31l92 8c29 3 49 19 53 44l6 38h-17l-6 28h-19l-4-28H150l-4 28h-19l-4-28h-17l-5 28Z"/>' +
    '<path fill="currentColor" d="M118 62c-14-12-14-28-4-38 8 12 18 16 28 14zM300 66c15-12 16-28 6-39-8 13-18 17-28 15z"/>',
  bridge:
    '<g fill="none" stroke="currentColor" stroke-width="9">' +
    '<path d="M0 116h400"/><path d="M94 152V28M110 152V28M290 152V28M306 152V28"/>' +
    '<path d="M0 74c48 28 70 34 102 34 50 0 70-48 100-48s48 48 98 48c32 0 56-6 100-34"/>' +
    '<path d="M94 44h16M94 62h16M94 82h16M290 44h16M290 62h16M290 82h16"/></g>',
  skyline:
    '<g fill="currentColor">' +
    '<path d="M16 152V78h44v74ZM72 152V54h38v98ZM122 152V96h40v56ZM174 152V30h44v122ZM230 152V70h34v82ZM276 152V104h38v48ZM326 152V60h40v92Z"/>' +
    '<path d="M192 12h8v20h-8ZM344 40h4v22h-4Z"/></g>',
  bolt: '<path fill="currentColor" d="M228 4 118 88h62l-28 62 112-88h-62Z"/>',
  crown:
    '<path fill="currentColor" d="M72 146 52 44l58 38 44-62 44 62 58-38-20 102Z"/>' +
    '<path fill="currentColor" d="M66 152h176v-6H66Z"/>',
  pines:
    '<g fill="currentColor">' +
    '<path d="M96 152 52 92h26L96 52l18 40h26ZM96 152h0Z"/>' +
    '<path d="M212 152 156 76h34l22-48 22 48h34ZM320 152l-40-54h24l16-36 16 36h24Z"/></g>',
  shield:
    '<path fill="none" stroke="currentColor" stroke-width="11" d="M200 18 316 50v44c0 36-46 66-116 92-70-26-116-56-116-92V50Z"/>' +
    '<path fill="currentColor" opacity=".6" d="M200 56 250 72v28c0 20-22 38-50 52-28-14-50-32-50-52V72Z"/>',
  sun:
    '<g fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round">' +
    '<circle cx="200" cy="120" r="44"/>' +
    '<path d="M200 46V16M138 62 118 38M262 62l20-24M110 120H78M290 120h32M146 78 122 62M254 78l24-16"/></g>',
};

const FALLBACK_ART: Art[] = ['shield', 'star', 'waves', 'skyline', 'mountains', 'bolt'];

/**
 * A club we do not carry still deserves a consistent look, so derive one from
 * its own code: the same code always produces the same hue and the same mark.
 */
export function fallbackTeam(code: string): Team {
  const key = String(code || '').toUpperCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    name: key || 'Team',
    c1: `hsl(${hue} 62% 46%)`,
    c2: `hsl(${(hue + 42) % 360} 58% 64%)`,
    art: FALLBACK_ART[hash % FALLBACK_ART.length],
  };
}

export function teamFor(code?: string | null): Team {
  const key = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!key) return fallbackTeam('OBLIGE');
  return TEAMS[key] || fallbackTeam(key);
}
