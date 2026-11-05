// patchNotes.service.ts
// Official THE FINALS patch notes via Steam's news API (Embark posts every
// update as a Steam community announcement). Bodies are BBCode with a very
// regular balance section:
//   [h2]GAME UPDATE | BALANCE CHANGES[/h2] [h3]Weapon[/h3] [b]FCAR[/b]
//   [list][*][p]Increased damage from 23 to 25[/p][/*]...
// We only extract numeric "from X to Y" changes; anything else in a balance
// section is kept as an unparsed line for a human to read.
import axios from 'axios';

export const FINALS_STEAM_APP_ID = 2073850;
export const STEAM_NEWS_URL = 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/';
const OFFICIAL_FEED = 'steam_community_announcements';

export interface SteamNewsItem {
  gid: string;
  title: string;
  url: string;
  contents: string;
  feedname: string;
  date: number; // unix seconds
}

export async function fetchOfficialNews(count = 10): Promise<SteamNewsItem[]> {
  const res = await axios.get(STEAM_NEWS_URL, {
    params: { appid: FINALS_STEAM_APP_ID, count, maxlength: 0, format: 'json' },
    timeout: 20000,
  });
  const items: any[] = res.data?.appnews?.newsitems;
  if (!Array.isArray(items)) throw new Error('Steam news response has no newsitems');
  return items
    .filter((i) => i?.feedname === OFFICIAL_FEED && typeof i.gid === 'string' && typeof i.contents === 'string')
    .map((i) => ({ gid: i.gid, title: String(i.title ?? ''), url: String(i.url ?? ''), contents: i.contents, feedname: i.feedname, date: Number(i.date) }));
}

export type ChangeKind = 'weapon' | 'class' | 'other';

export interface ParsedChange {
  /** The [h3] heading the line sat under ("Weapon", "Gadgets", "Heavy"...). */
  category: string;
  /** Canonical weapon name when matched, class name for class lines, else the name as written. */
  target: string;
  /** The name exactly as written in the notes ("R.357"). */
  rawTarget: string;
  /** Words before the verb ("Primary Attack"), when the line had any. */
  qualifier: string;
  kind: ChangeKind;
  /** The stat as written ("rate of fire"). */
  stat: string;
  /** Our field path (see weaponStats.ts) or 'health' for classes; null when we don't track the stat. */
  field: string | null;
  from: number;
  to: number;
  rawLine: string;
}

export interface ParsedPatch {
  changes: ParsedChange[];
  /** Balance-section lines with no numeric from/to we could read. */
  unparsed: Array<{ category: string; target: string; line: string }>;
  hasBalanceSection: boolean;
}

const CLASS_NAMES = ['light', 'medium', 'heavy'];

export function classFromName(name: string): 'Light' | 'Medium' | 'Heavy' | null {
  const n = name.toLowerCase().replace(/\b(archetype|class|build|contestants?)\b/g, '').replace(/s\b/, '').trim();
  if (!CLASS_NAMES.includes(n)) return null;
  return (n[0].toUpperCase() + n.slice(1)) as 'Light' | 'Medium' | 'Heavy';
}

/** BBCode → plain text for one line. */
export function bbToText(s: string): string {
  return s
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps a stat phrase to our field path. Class lines only understand health. */
export function mapStat(stat: string, kind: ChangeKind): string | null {
  const s = stat.toLowerCase();
  if (kind === 'class') return /\b(health|hp)\b/.test(s) ? 'health' : null;
  if (kind !== 'weapon') return null;
  if (/head ?shot|critical|crit\b/.test(s)) return /multiplier/.test(s) || !/damage/.test(s) ? 'headshotMult' : null;
  if (/burst/.test(s) && /(rate|rpm|delay)/.test(s)) return /rate|rpm/.test(s) ? 'burstRpm' : null;
  if (/rate of fire|fire rate|firing rate|\brpm\b|rounds per minute/.test(s)) return 'rpm';
  if (/falloff|fall-off/.test(s)) {
    // "falloff modifier at max range from 67% to 55%" is the multiplier, not the range.
    if (/multiplier|modifier|minimum damage|min damage|percent/.test(s)) return 'falloffMult';
    if (/\b(start|min|minimum|begin)/.test(s)) return 'falloffMinM';
    if (/\b(end|max|maximum)/.test(s)) return 'falloffMaxM';
    return null;
  }
  if (/splash|explosion|blast/.test(s) && /damage/.test(s)) return 'mode:Splash.damage';
  if (/pellet/.test(s) && /(count|number|amount)|^pellets$/.test(s)) return 'projectiles';
  if (/reload/.test(s)) return /tactical|tac\b|partial/.test(s) ? null : 'reloadS';
  if (/ammo|magazine|mag size|clip/.test(s)) return 'magSize';
  if (/^(?:base |body |direct (?:hit )?|pellet |bullet |impact )?damage(?: per (?:shot|bullet|pellet|hit))?$/.test(s)) return 'damage';
  return null;
}

/** Normalises a value to the field's unit (seconds, multiplier as a ratio). */
function normaliseValue(value: number, unit: string, field: string | null): number {
  const u = unit.toLowerCase();
  if (field === 'reloadS' && u === 'ms') return value / 1000;
  if (field === 'falloffMult' && u === '%') return value / 100;
  return value;
}

const VERB = '(?:increased|decreased|reduced|raised|lowered|changed|adjusted|buffed|nerfed|set|updated|increase|decrease|reduce|raise|lower)';
const NUM = '(-?\\d[\\d.,]*)\\s*(ms|s|m|%|x|×|rpm|hp)?';
// "[Primary Attack] Increased [the] base damage from 42 to 49"
const CHANGE_RE = new RegExp(`^(.*?)\\b${VERB}\\s+(?:the\\s+)?(.+?)\\s+from\\s+${NUM}\\s*to\\s+${NUM}(?![\\w])`, 'i');
// "Cooldown increased from 20s to 30s"
const STAT_FIRST_RE = new RegExp(`^(.+?)\\s+${VERB}\\s+from\\s+${NUM}\\s*to\\s+${NUM}(?![\\w])`, 'i');
const ARROW_RE = /^(.+?)\s*:?\s+(-?\d[\d.,]*)\s*(ms|s|m|%|x|×|rpm|hp)?\s*(?:→|->|⇒)\s*(-?\d[\d.,]*)\s*(ms|s|m|%|x|×|rpm|hp)?/i;

function toNum(s: string): number {
  return Number(s.replace(/,/g, '').replace(/\.$/, ''));
}

export interface ChangeLine {
  stat: string;
  /** Words before the verb, e.g. "Primary Attack". */
  qualifier: string;
  from: number;
  to: number;
  unit: string;
}

/** Parses one bullet. Returns null when it isn't a numeric from/to change. */
export function parseChangeLine(line: string): ChangeLine | null {
  const text = line.replace(/\s+/g, ' ').trim();
  const build = (qualifier: string, rawStat: string, from: string, u1: string | undefined, to: string, u2: string | undefined): ChangeLine | null => {
    let stat = rawStat.trim().replace(/\s*\(.*\)$/, '');
    if (/rpm/i.test(u1 ?? '') || /rpm/i.test(u2 ?? '')) stat = /rate|rpm/i.test(stat) ? stat : `${stat} rpm`;
    const a = toNum(from);
    const b = toNum(to);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { stat, qualifier: qualifier.trim().replace(/[:,-]$/, '').trim(), from: a, to: b, unit: (u2 || u1 || '').trim() };
  };

  const statFirst = text.match(STAT_FIRST_RE);
  // Stat-first only when the words before the verb read like a stat name, not a qualifier or sentence.
  if (statFirst && statFirst[1].split(' ').length <= 4 && !/\b(?:primary|secondary|alt)\b/i.test(statFirst[1])) {
    return build('', statFirst[1], statFirst[2], statFirst[3], statFirst[4], statFirst[5]);
  }
  const m = text.match(CHANGE_RE);
  if (m) return build(m[1], m[2], m[3], m[4], m[5], m[6]);
  const a = text.match(ARROW_RE);
  if (a) return build('', a[1], a[2], a[3], a[4], a[5]);
  return null;
}

const NON_WEAPON_CATEGORY = /gadget|specialization|ui|map|mode/i;

/** Decides what a changed line is about. Weapon names only match when `knownWeapons` is given. */
export function classifyChange(
  category: string,
  target: string,
  stat: string,
  knownWeapons?: string[]
): { kind: ChangeKind; target: string } {
  const who = target || category;
  const cls = classFromName(who) ?? (target ? null : classFromName(category));
  if (cls && /\b(health|hp)\b/i.test(stat)) return { kind: 'class', target: cls };
  if (knownWeapons) {
    const matched = matchWeaponName(who, knownWeapons);
    return matched ? { kind: 'weapon', target: matched } : { kind: 'other', target: who };
  }
  const heuristic = /weapon/i.test(category) || (!NON_WEAPON_CATEGORY.test(category) && !!target);
  return { kind: heuristic ? 'weapon' : 'other', target: who };
}

/** Qualifier → field decision: secondary/alt attacks need a human to pick the right mode. */
export function fieldForQualifier(qualifier: string, field: string | null): string | null {
  return /secondary|\balt\b|alternate/i.test(qualifier) ? null : field;
}

/** Walks the BBCode and extracts balance changes. */
export function parsePatchNotes(contents: string, knownWeapons?: string[]): ParsedPatch {
  // Dev notes are italic paragraphs; drop them so their bold "Dev Note:" isn't read as a target.
  const body = contents.replace(/\[i\][\s\S]*?\[\/i\]/gi, ' ');
  const token =
    /\[h2\]([\s\S]*?)\[\/h2\]|\[h3\]([\s\S]*?)\[\/h3\]|\[\*\]([\s\S]*?)\[\/\*\]|(?:\[p\]|\n)\s*\[b\]([^[\]]+?)\[\/b\]\s*(?=\[\/p\]|\n)/gi;

  const result: ParsedPatch = { changes: [], unparsed: [], hasBalanceSection: false };
  let inBalance = false;
  let category = '';
  let target = '';

  for (const m of body.matchAll(token)) {
    if (m[1] !== undefined) {
      inBalance = /balance|weapon changes|tuning/i.test(bbToText(m[1]));
      if (inBalance) result.hasBalanceSection = true;
      category = '';
      target = '';
    } else if (m[2] !== undefined) {
      category = bbToText(m[2]);
      target = '';
    } else if (m[4] !== undefined) {
      target = bbToText(m[4]).replace(/:$/, '');
    } else if (m[3] !== undefined && inBalance) {
      const line = bbToText(m[3]);
      if (!line) continue;
      const who = target || category;
      const parsed = parseChangeLine(line);
      if (!parsed) {
        result.unparsed.push({ category, target: who, line });
        continue;
      }
      const { kind, target: resolved } = classifyChange(category, target, parsed.stat, knownWeapons);
      const field = kind === 'weapon' ? fieldForQualifier(parsed.qualifier, mapStat(parsed.stat, kind)) : mapStat(parsed.stat, kind);
      result.changes.push({
        category,
        target: resolved,
        rawTarget: who,
        qualifier: parsed.qualifier,
        kind,
        stat: parsed.stat,
        field,
        from: normaliseValue(parsed.from, parsed.unit, field),
        to: normaliseValue(parsed.to, parsed.unit, field),
        rawLine: line,
      });
    }
  }
  return result;
}

// ---------- weapon name matching ----------

const ALIASES: Record<string, string> = {
  minigun: 'M134 Minigun',
  lewis: 'Lewis Gun',
  sledge: 'Sledgehammer',
  sawedoff: 'SH1900',
  sawnoff: 'SH1900',
  bow: 'Recurve Bow',
  knives: 'Throwing Knives',
  shield: 'Riot Shield',
  akimbo: '.50 Akimbo',
  revolver: 'R .357',
  repeater: 'CB-01 Repeater',
  titan: 'BFR Titan',
  mgl: 'MGL32',
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Matches a weapon name from the notes to one of our stored weapon names. */
export function matchWeaponName(raw: string, known: string[]): string | null {
  const n = norm(raw);
  if (!n) return null;
  const exact = known.find((k) => norm(k) === n);
  if (exact) return exact;
  const alias = ALIASES[n];
  if (alias && known.includes(alias)) return alias;
  // "CB-01" → "CB-01 Repeater", "M134" → "M134 Minigun"; only when unambiguous.
  const partial = known.filter((k) => {
    const kn = norm(k);
    return n.length >= 3 && (kn.startsWith(n) || n.startsWith(kn));
  });
  return partial.length === 1 ? partial[0] : null;
}
