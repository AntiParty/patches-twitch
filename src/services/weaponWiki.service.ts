// weaponWiki.service.ts
// Reads weapon stats from thefinals.wiki (MediaWiki, CC BY-SA 4.0 — credit and
// link it wherever the numbers are shown). The Weapons page lists every weapon
// per class; each weapon page carries an {{Infobox weapons}} template and a
// community-tested "Damage Profile" table we use for class health and melee timing.
import axios from 'axios';
import type { AttackMode, Build, ClassHealth } from './weaponTtk';
import { BUILDS } from './weaponTtk';
import type { WeaponStats } from './weaponStats';

export const WIKI_API_URL = 'https://www.thefinals.wiki/w/api.php';
export const WIKI_BASE_URL = 'https://www.thefinals.wiki/wiki/';
export const WIKI_LICENSE = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const USER_AGENT = 'patches-twitch-bot (THE FINALS stats; weekly sync)';

// ---------- wikitext helpers ----------

/** Pulls `| key = value` pairs out of the first {{Infobox weapons ...}} template. */
export function parseInfobox(wikitext: string): Record<string, string> | null {
  const start = wikitext.search(/\{\{\s*Infobox weapons/i);
  if (start < 0) return null;

  // Brace-match to the template's end; values contain nested {{...}} and [[...]].
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i++; }
    else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--; i++;
      if (depth === 0) { end = i - 1; break; }
    }
  }
  if (end < 0) return null;
  const body = wikitext.slice(start + 2, end);

  // Split on top-level pipes only.
  const parts: string[] = [];
  let buf = '';
  let nest = 0;
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { nest++; buf += two; i++; continue; }
    if (two === '}}' || two === ']]') { nest--; buf += two; i++; continue; }
    if (body[i] === '|' && nest === 0) { parts.push(buf); buf = ''; continue; }
    buf += body[i];
  }
  parts.push(buf);

  const out: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Strips wiki markup: [[a|b]] → b, '''bold''' → bold, <br> → newline. */
function plain(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, '');
}

function num(value: string | undefined): number | null {
  if (!value) return null;
  const m = plain(value).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** "13×9 (Max - 117)" → { damage: 13, projectiles: 9 }; "25" → { damage: 25, projectiles: 1 }. */
export function parseDamage(value: string | undefined): { damage: number; projectiles: number } | null {
  if (!value) return null;
  const text = plain(value);
  const multi = text.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+)/);
  if (multi) return { damage: Number(multi[1]), projectiles: Number(multi[2]) };
  const hit = text.match(/Hit\s*-\s*(\d+(?:\.\d+)?)/i);
  if (hit) return { damage: Number(hit[1]), projectiles: 1 };
  const direct = text.match(/Direct\s*-\s*(\d+(?:\.\d+)?)/i);
  if (direct) return { damage: Number(direct[1]), projectiles: 1 };
  const n = num(text);
  return n == null ? null : { damage: n, projectiles: 1 };
}

/** "37.5 (1.5×)" → 1.5. Falls back to crit/body when there's no explicit multiplier. */
export function parseHeadshotMult(crit: string | undefined, bodyDamage: number | null): number | null {
  if (!crit) return null;
  const explicit = plain(crit).match(/\(\s*(\d+(?:\.\d+)?)\s*×\s*\)/);
  if (explicit) return Number(explicit[1]);
  const c = num(crit);
  return c != null && bodyDamage ? Math.round((c / bodyDamage) * 1000) / 1000 : null;
}

/** "220｜1080" / "89丨545.45丨27.7" / "500" → [220, 1080] etc. */
export function parseRpmList(value: string | undefined): number[] {
  if (!value) return [];
  return plain(value)
    .split(/[｜丨|]/)
    .map((p) => num(p))
    .filter((n): n is number => n != null);
}

const WORD_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5 };

/** Burst size from the page prose ("fire a burst of three bullets", "fire two knives"). */
export function detectBurstSize(wikitext: string): number {
  const m = wikitext.match(/(?:burst of|fire)\s+(two|three|four|five|\d+)\s+(?:bullets|rounds|shots|knives)/i);
  if (!m) return 1;
  const word = m[1].toLowerCase();
  return WORD_NUMBERS[word] ?? Number(word) ?? 1;
}

/** "Precise - 100 <br>Glancing blow - 65" → [['Precise', 100], ['Glancing', 65]]. */
export function parseMeleeHits(value: string | undefined): Array<{ label: string; damage: number; projectiles: number }> {
  if (!value) return [];
  const out: Array<{ label: string; damage: number; projectiles: number }> = [];
  for (const line of plain(value).split('\n')) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]*?)\s*-\s*(\d+(?:\.\d+)?)(?:\s*[×x]\s*(\d+))?/);
    if (!m) continue;
    const label = m[1].replace(/\s*blow$/i, '').trim();
    out.push({ label, damage: Number(m[2]), projectiles: m[3] ? Number(m[3]) : 1 });
  }
  if (out.length === 0) {
    // "75 → 125 → 150" (charge levels) or a bare number: use the strongest hit.
    const nums = (plain(value).match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length) out.push({ label: '', damage: Math.max(...nums), projectiles: 1 });
  }
  return out;
}

export interface DamageProfile {
  health: Partial<Record<Build, number>>;
  rows: Array<{ label: string; points: Array<{ build: Build; hits: number; seconds: number | null }> }>;
}

/** Parses the first "Damage Profile" wikitable (header health per class + rows of hits/time). */
export function parseDamageProfile(wikitext: string): DamageProfile | null {
  const text = wikitext.replace(/\{\{!\}\}/g, '|');
  const at = text.search(/=+\s*Damage Profile\s*=+/i);
  if (at < 0) return null;
  const tableStart = text.indexOf('{|', at);
  const tableEnd = text.indexOf('|}', tableStart);
  if (tableStart < 0 || tableEnd < 0) return null;
  const table = text.slice(tableStart, tableEnd);

  const health: Partial<Record<Build, number>> = {};
  const order: Build[] = [];
  for (const m of table.matchAll(/(Light|Medium|Heavy)\s*\((\d+)\s*HP\)/g)) {
    const build = m[1] as Build;
    health[build] = Number(m[2]);
    order.push(build);
  }

  const rows: DamageProfile['rows'] = [];
  for (const chunk of table.split(/\n\|-/).slice(1)) {
    const cells = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|') && !l.startsWith('|-') && !l.startsWith('|}'))
      .flatMap((l) => l.slice(1).split('||'))
      .map((c) => c.trim());
    if (cells.length < 3 || /^\d/.test(cells[0])) continue;
    const label = plain(cells[0]).trim();
    const points: DamageProfile['rows'][number]['points'] = [];
    for (let i = 0; i < order.length; i++) {
      const hits = num(cells[1 + i * 2]);
      if (hits == null) continue;
      points.push({ build: order[i], hits, seconds: num(cells[2 + i * 2]) });
    }
    if (points.length) rows.push({ label, points });
  }
  return { health, rows };
}

/**
 * Melee has no RPM on the wiki. Fit time = first + (hits - 2) * gap over the
 * community-tested rows for one attack type, giving the combo's first interval and cadence.
 */
export function fitMeleeCadence(rows: DamageProfile['rows']): { firstIntervalS: number; rpm: number } | null {
  const pts = rows.flatMap((r) => r.points).filter((p) => p.hits >= 2 && p.seconds != null) as Array<{ hits: number; seconds: number }>;
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.hits - 2);
  const ys = pts.map((p) => p.seconds);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx === 0) {
    // Every point is a 2-hit kill: we know the first interval but not the cadence; reuse it.
    return { firstIntervalS: round3(my), rpm: round3(60 / my) };
  }
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  if (!(slope > 0)) return null;
  return { firstIntervalS: round3(my - slope * mx), rpm: round3(60 / slope) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function parseBuild(value: string | undefined): Build | null {
  const b = value ? plain(value).trim().toLowerCase() : '';
  return (BUILDS.find((x) => x.toLowerCase() === b) as Build) ?? null;
}

function baseMode(label: string, damage: number, projectiles: number): AttackMode {
  return { label, damage, projectiles, headshotMult: null, rpm: null, burstSize: 1, burstRpm: null };
}

/** Builds a WeaponStats from one weapon page's wikitext. Null when there's nothing usable. */
export function parseWeaponPage(name: string, wikitext: string): WeaponStats | null {
  const ib = parseInfobox(wikitext);
  if (!ib) return null;

  const stats: WeaponStats = {
    name,
    build: parseBuild(ib.build),
    wtype: ib.wtype ? plain(ib.wtype).trim() : null,
    modes: [],
    magSize: null,
    reloadS: num(ib.fullreload),
    falloffMinM: num(ib.falloffmin),
    falloffMaxM: num(ib.falloffmax),
    falloffMult: num(ib.falloffmulti),
    notes: [],
  };
  const mag = ib.magsize ? plain(ib.magsize) : '';
  // "30×2" (ARN-220 coupled mags) / "4×4" (SA1216 tubes): rounds before a full reload.
  const magParts = mag.match(/(\d+)\s*×\s*(\d+)/);
  stats.magSize = /∞/.test(mag) ? null : magParts ? Number(magParts[1]) * Number(magParts[2]) : num(mag);
  if (magParts) stats.notes.push(`Magazine listed as ${mag.trim()}; TTK counts ${stats.magSize} rounds before a full reload.`);

  const profile = parseDamageProfile(wikitext);
  const isMelee = /melee/i.test(stats.wtype ?? '') || (!ib.bodydamage && (ib.primaryfire || ib.altfire));

  if (isMelee) {
    stats.magSize = null;
    stats.reloadS = null;
    const groups: Array<{ suffix: string; hits: ReturnType<typeof parseMeleeHits>; alt: boolean }> = [
      { suffix: '', hits: parseMeleeHits(ib.primaryfire), alt: false },
      { suffix: ' (Alt-Fire)', hits: parseMeleeHits(ib.altfire), alt: true },
    ];
    for (const g of groups) {
      const tableRows = (profile?.rows ?? []).filter((r) => /alt/i.test(r.label) === g.alt);
      const cadence = fitMeleeCadence(tableRows);
      for (const h of g.hits) {
        const label = h.label ? `${h.label}${g.suffix}` : g.alt ? 'Alt-Fire' : 'Primary';
        stats.modes.push({
          ...baseMode(label, h.damage, h.projectiles),
          rpm: cadence?.rpm ?? null,
          firstIntervalS: cadence?.firstIntervalS ?? null,
        });
      }
    }
    if (stats.modes.length) stats.notes.push('Melee timing is fitted from community-tested kill times; treat it as approximate.');
    return stats.modes.length ? stats : null;
  }

  const dmg = parseDamage(ib.bodydamage);
  if (!dmg) return null;
  const rpms = parseRpmList(ib.rpm);
  const burstSize = rpms.length >= 2 ? detectBurstSize(wikitext) : 1;
  const primary = baseMode('Primary', dmg.damage, dmg.projectiles);
  primary.headshotMult = parseHeadshotMult(ib.crit, dmg.damage);
  primary.rpm = rpms[0] ?? null;
  if (burstSize > 1) {
    primary.burstSize = burstSize;
    primary.burstRpm = rpms[1] ?? null;
  }
  stats.modes.push(primary);
  const nextRpm = rpms[burstSize > 1 ? 2 : 1];

  const plainBody = plain(ib.bodydamage ?? '');
  const splash = plainBody.match(/Splash[^\d]*(\d+(?:\.\d+)?)/i);
  if (splash) {
    primary.label = 'Direct';
    stats.modes.push({ ...baseMode('Splash', Number(splash[1]), 1), rpm: primary.rpm });
  }
  const burn = plainBody.match(/Burn\s*-\s*([\d.]+\s*\/\s*s)/i);
  if (burn) stats.notes.push(`Burn damage (${burn[1].replace(/\s+/g, '')}) isn't counted in TTK.`);

  if (ib.altfirebody) {
    const altBody = num(plain(ib.altfirebody).replace(/^[^\d]*-\s*/, ''));
    if (altBody != null) {
      const label = /max draw/i.test(ib.altfirebody) ? 'Max Draw' : 'Alt-Fire';
      stats.modes.push({
        ...baseMode(label, altBody, 1),
        headshotMult: parseHeadshotMult(ib.altfirehead, altBody),
        rpm: nextRpm ?? primary.rpm,
      });
    }
  }
  if (/minigun|spin/i.test(name + (stats.wtype ?? ''))) stats.notes.push('Assumes the barrel is fully spun up.');
  return stats;
}

/** Most common health per class across all pages (a few pages still show old values). */
export function voteClassHealth(profiles: Array<DamageProfile | null>): ClassHealth | null {
  const result = {} as ClassHealth;
  for (const build of BUILDS) {
    const counts = new Map<number, number>();
    for (const p of profiles) {
      const hp = p?.health[build];
      if (hp) counts.set(hp, (counts.get(hp) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return null;
    result[build] = best[0];
  }
  return result;
}

/** Weapon page titles from the Weapons overview page's {{EquipmentCard | page=... }} entries. */
export function parseWeaponList(wikitext: string): string[] {
  const names = [...wikitext.matchAll(/EquipmentCard[^}]*?\|\s*page\s*=\s*([^|}]+?)\s*[|}]/g)].map((m) => m[1].trim());
  return [...new Set(names)];
}

// ---------- network ----------

async function wikiGet(params: Record<string, string>): Promise<any> {
  const res = await axios.get(WIKI_API_URL, {
    params: { format: 'json', formatversion: '2', ...params },
    headers: { 'User-Agent': USER_AGENT },
    timeout: 20000,
  });
  return res.data;
}

export interface WikiSnapshot {
  weapons: WeaponStats[];
  health: ClassHealth | null;
  /** Pages we couldn't turn into stats, so the review page can show them. */
  skipped: string[];
}

export async function fetchWikiSnapshot(): Promise<WikiSnapshot> {
  const overview = await wikiGet({ action: 'parse', page: 'Weapons', prop: 'wikitext' });
  const titles = parseWeaponList(overview?.parse?.wikitext ?? '');
  if (titles.length < 10) throw new Error(`Wiki Weapons page listed only ${titles.length} weapons; page shape changed?`);

  const pages: Array<{ title: string; content: string }> = [];
  // MediaWiki allows 50 titles per query.
  for (let i = 0; i < titles.length; i += 50) {
    const data = await wikiGet({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      redirects: '1',
      titles: titles.slice(i, i + 50).join('|'),
    });
    for (const p of data?.query?.pages ?? []) {
      const content = p?.revisions?.[0]?.slots?.main?.content;
      if (typeof content === 'string') pages.push({ title: p.title, content });
    }
  }

  const weapons: WeaponStats[] = [];
  const skipped: string[] = [];
  const profiles: Array<DamageProfile | null> = [];
  for (const { title, content } of pages) {
    profiles.push(parseDamageProfile(content));
    const stats = parseWeaponPage(title, content);
    if (stats) weapons.push(stats);
    else skipped.push(title);
  }
  return { weapons, health: voteClassHealth(profiles), skipped };
}
