// balanceReview.service.ts
// Turns two untrusted sources (official Steam patch notes, thefinals.wiki infoboxes)
// into reviewable BalanceChange rows. Stored weapon stats only ever change when an
// admin approves a change; the first wiki sync seeds the tables directly.
import { Op } from 'sequelize';
import { BalanceChange, BalanceMeta, ClassHealthStat, PatchNote, WeaponStat, balanceDbReady } from '@/dbBalance';
import logger from '@/util/logger';
import { sendInfoToDiscord } from '@/handlers/discordHandler';
import { computeTtk, BUILDS, type AttackMode, type Build, type ClassHealth, type TtkRow } from '@/services/weaponTtk';
import { diffStats, getField, isKnownField, setField, describeField, type WeaponStats } from '@/services/weaponStats';
import { fetchWikiSnapshot, type WikiSnapshot } from '@/services/weaponWiki.service';
import { fetchOfficialNews, parsePatchNotes, type ParsedChange, type SteamNewsItem } from '@/services/patchNotes.service';

const VALUE_EPS = 1e-6;
const BASELINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WEB_BASE_URL = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || '').replace(/\/$/, '');

export type ChangeStatus = 'pending' | 'applied' | 'rejected' | 'info';

/** The slice of a BalanceChange row the pure matching helpers need. */
export interface ChangeKey {
  id?: number;
  source: string;
  kind: string;
  target: string;
  field: string | null;
  to_value: number;
}

// ---------- pure helpers ----------

export function sameValue(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) <= VALUE_EPS;
}

export function sameTarget(a: ChangeKey, b: ChangeKey): boolean {
  return a.kind === b.kind && a.target.toLowerCase() === b.target.toLowerCase() && a.field === b.field;
}

/** Finds a pending change from the other source that says the same thing. */
export function findMatchingChange<T extends ChangeKey>(pending: T[], probe: ChangeKey, source: 'patch' | 'wiki'): T | undefined {
  return pending.find((p) => p.source === source && sameTarget(p, probe) && sameValue(p.to_value, probe.to_value));
}

/** Patch lines we can't apply automatically are shown for information only. */
export function initialStatus(kind: string, field: string | null, knownField: boolean): ChangeStatus {
  if (kind === 'other' || !field || !knownField) return 'info';
  return 'pending';
}

export function isFromMismatch(from: number | null, current: number | null): boolean {
  return from != null && current != null && !sameValue(from, current);
}

/** First-run rule: with no stored patches, posts older than a week are baseline only. */
export function shouldBaseline(tableEmpty: boolean, postedAt: Date, now: Date): boolean {
  return tableEmpty && now.getTime() - postedAt.getTime() > BASELINE_AGE_MS;
}

export interface WikiDiffPlan {
  /** Pending patch changes the wiki now agrees with. */
  confirm: number[];
  /** New wiki-sourced changes to create. */
  create: Array<{ field: string; from: number | null; to: number }>;
  /** Older pending wiki changes the wiki no longer shows. */
  supersede: number[];
}

/**
 * Decides what a wiki diff for one target means given the pending changes.
 * `pending` should hold every pending change for that kind+target.
 */
export function planWikiDiff(
  kind: string,
  target: string,
  diffs: Array<{ field: string; from: number | null; to: number | null }>,
  pending: Array<ChangeKey & { id: number }>
): WikiDiffPlan {
  const plan: WikiDiffPlan = { confirm: [], create: [], supersede: [] };
  for (const d of diffs) {
    if (d.to == null) continue;
    const probe: ChangeKey = { source: 'wiki', kind, target, field: d.field, to_value: d.to };
    const patch = findMatchingChange(pending, probe, 'patch');
    const wiki = findMatchingChange(pending, probe, 'wiki');
    if (patch) plan.confirm.push(patch.id);
    if (wiki) continue;
    // A matching patch change already covers this; don't queue the same edit twice.
    if (patch) continue;
    plan.create.push({ field: d.field, from: d.from, to: d.to });
  }
  for (const p of pending) {
    if (p.source !== 'wiki' || p.kind !== kind || p.target.toLowerCase() !== target.toLowerCase()) continue;
    const stillShown = diffs.some((d) => d.field === p.field && sameValue(d.to, p.to_value));
    if (!stillShown) plan.supersede.push(p.id);
  }
  return plan;
}

export function isClassName(name: string): name is Build {
  return (BUILDS as string[]).includes(name);
}

export function changeLabel(change: { kind: string; field: string | null; stat_label?: string }): string {
  if (change.kind === 'class') return 'Health';
  return change.field ? describeField(change.field) : change.stat_label || '';
}

// ---------- stored data ----------

export async function loadWeapons(): Promise<WeaponStats[]> {
  await balanceDbReady;
  const rows = await WeaponStat.findAll({ order: [['name', 'ASC']] });
  const out: WeaponStats[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data) as WeaponStats);
    } catch (err) {
      logger.error(`[balance] Stored stats for ${row.name} are not valid JSON:`, err);
    }
  }
  return out;
}

export async function loadHealth(): Promise<ClassHealth | null> {
  await balanceDbReady;
  const rows = await ClassHealthStat.findAll();
  const health = {} as ClassHealth;
  for (const build of BUILDS) {
    const row = rows.find((r) => r.build === build);
    if (!row) return null;
    health[build] = row.health;
  }
  return health;
}

export async function getMeta(key: string): Promise<string | null> {
  await balanceDbReady;
  const row = await BalanceMeta.findByPk(key);
  return row ? row.value : null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await balanceDbReady;
  await BalanceMeta.upsert({ key, value });
}

async function saveWeapon(stats: WeaponStats, source: string, updatedFrom: string): Promise<void> {
  await WeaponStat.upsert({
    name: stats.name,
    build: stats.build,
    wtype: stats.wtype,
    data: JSON.stringify(stats),
    source,
    updated_from: updatedFrom,
    updated_at: new Date(),
  });
}

async function pendingFor(kind: string, target?: string) {
  const where: any = { status: 'pending', kind };
  if (target) where.target = target;
  return BalanceChange.findAll({ where });
}

// ---------- wiki sync ----------

export interface WikiSyncSummary {
  seeded: boolean;
  weaponsAdded: number;
  changesCreated: number;
  changesConfirmed: number;
  superseded: number;
  skipped: string[];
}

export async function syncFromWiki(snapshot: WikiSnapshot): Promise<WikiSyncSummary> {
  await balanceDbReady;
  const summary: WikiSyncSummary = {
    seeded: false, weaponsAdded: 0, changesCreated: 0, changesConfirmed: 0, superseded: 0, skipped: snapshot.skipped,
  };
  const stored = new Map((await loadWeapons()).map((w) => [w.name, w]));
  const storedHealth = await loadHealth();
  const seed = stored.size === 0;
  summary.seeded = seed;

  for (const wiki of snapshot.weapons) {
    const current = stored.get(wiki.name);
    if (!current) {
      await saveWeapon(wiki, 'wiki', 'wiki');
      summary.weaponsAdded++;
      continue;
    }
    const diffs = diffStats(current, wiki);
    const pending = await pendingFor('weapon', wiki.name);
    const plan = planWikiDiff('weapon', wiki.name, diffs, pending.map(toKey));
    await applyPlan(plan, 'weapon', wiki.name, current, summary);
  }

  if (snapshot.health) {
    for (const build of BUILDS) {
      const wikiHp = snapshot.health[build];
      const currentHp = storedHealth?.[build] ?? null;
      if (currentHp == null) {
        await ClassHealthStat.upsert({ build, health: wikiHp, updated_from: 'wiki', updated_at: new Date() });
        continue;
      }
      const diffs = sameValue(currentHp, wikiHp) ? [] : [{ field: 'health', from: currentHp, to: wikiHp }];
      const pending = await pendingFor('class', build);
      const plan = planWikiDiff('class', build, diffs, pending.map(toKey));
      await applyPlan(plan, 'class', build, null, summary, currentHp);
    }
  }

  await setMeta('wiki_last_sync', new Date().toISOString());
  await setMeta('wiki_skipped', JSON.stringify(snapshot.skipped));
  logger.info(
    `[patchNotes] Wiki sync: ${seed ? 'seeded ' : ''}${summary.weaponsAdded} new weapons, ${summary.changesCreated} new changes, ` +
      `${summary.changesConfirmed} confirmed, ${summary.superseded} superseded, ${snapshot.skipped.length} pages skipped`
  );
  return summary;
}

function toKey(row: BalanceChange): ChangeKey & { id: number } {
  return { id: row.id, source: row.source, kind: row.kind, target: row.target, field: row.field, to_value: row.to_value };
}

async function applyPlan(
  plan: WikiDiffPlan,
  kind: 'weapon' | 'class',
  target: string,
  current: WeaponStats | null,
  summary: WikiSyncSummary,
  currentHealth?: number
): Promise<void> {
  if (plan.confirm.length) {
    await BalanceChange.update({ confirmed_by_wiki: true }, { where: { id: plan.confirm } });
    summary.changesConfirmed += plan.confirm.length;
  }
  if (plan.supersede.length) {
    await BalanceChange.update(
      { status: 'rejected', decided_by: 'system', decided_at: new Date() },
      { where: { id: plan.supersede } }
    );
    summary.superseded += plan.supersede.length;
  }
  for (const c of plan.create) {
    const currentValue = kind === 'class' ? currentHealth ?? null : current ? getField(current, c.field) : null;
    await BalanceChange.create({
      source: 'wiki',
      patch_gid: null,
      kind,
      target,
      raw_target: target,
      field: c.field,
      stat_label: kind === 'class' ? 'Health' : describeField(c.field),
      from_value: c.from,
      to_value: c.to,
      current_value: currentValue,
      raw_line: null,
      status: 'pending',
      from_mismatch: false,
      confirmed_by_wiki: false,
      confirmed_by_patch: false,
    });
    summary.changesCreated++;
  }
}

// ---------- patch ingest ----------

export interface IngestResult {
  gid: string;
  title: string;
  status: 'skipped' | 'baseline' | 'no_balance' | 'pending' | 'reviewed';
  parsed: number;
  actionable: number;
  mismatched: number;
  unparsed: number;
}

export async function ingestPatch(item: SteamNewsItem, opts: { baseline?: boolean } = {}): Promise<IngestResult> {
  await balanceDbReady;
  const result: IngestResult = { gid: item.gid, title: item.title, status: 'skipped', parsed: 0, actionable: 0, mismatched: 0, unparsed: 0 };
  if (await PatchNote.findByPk(item.gid)) return result;

  const postedAt = new Date(item.date * 1000);
  const base = { gid: item.gid, title: item.title, url: item.url, posted_at: postedAt };

  if (opts.baseline) {
    await PatchNote.create({ ...base, status: 'baseline', unparsed: null });
    result.status = 'baseline';
    return result;
  }

  const weapons = await loadWeapons();
  const stored = new Map(weapons.map((w) => [w.name, w]));
  const health = await loadHealth();
  const parsed = parsePatchNotes(item.contents, weapons.map((w) => w.name));

  if (!parsed.hasBalanceSection || (parsed.changes.length === 0 && parsed.unparsed.length === 0)) {
    await PatchNote.create({ ...base, status: 'no_balance', unparsed: null });
    result.status = 'no_balance';
    return result;
  }

  const pendingWiki = (await BalanceChange.findAll({ where: { status: 'pending', source: 'wiki' } })).map(toKey);
  for (const change of parsed.changes) {
    const row = buildPatchRow(change, stored, health, pendingWiki, item.gid);
    await BalanceChange.create(row);
    result.parsed++;
    if (row.status === 'pending') result.actionable++;
    if (row.from_mismatch) result.mismatched++;
    const twins = row.confirmed_by_wiki
      ? pendingWiki.filter((w) => w.source === 'wiki' && sameTarget(w, row) && sameValue(w.to_value, row.to_value)).map((w) => w.id)
      : [];
    if (twins.length) await BalanceChange.update({ confirmed_by_patch: true }, { where: { id: twins } });
  }
  result.unparsed = parsed.unparsed.length;
  result.status = result.actionable > 0 ? 'pending' : 'reviewed';
  await PatchNote.create({
    ...base,
    status: result.status,
    unparsed: parsed.unparsed.length ? JSON.stringify(parsed.unparsed) : null,
  });
  return result;
}

/** Builds the BalanceChange row for one parsed patch line (no DB access). */
export function buildPatchRow(
  change: ParsedChange,
  stored: Map<string, WeaponStats>,
  health: ClassHealth | null,
  pendingWiki: ChangeKey[],
  gid: string
) {
  let currentValue: number | null = null;
  let known = false;
  if (change.kind === 'class' && isClassName(change.target)) {
    currentValue = health?.[change.target] ?? null;
    known = change.field === 'health' && health != null;
  } else if (change.kind === 'weapon' && change.field) {
    const stats = stored.get(change.target);
    if (stats && isKnownField(stats, change.field)) {
      known = true;
      currentValue = getField(stats, change.field);
    }
  }
  const field = change.field;
  const probe: ChangeKey = { source: 'patch', kind: change.kind, target: change.target, field, to_value: change.to };
  // The wiki often catches up before we poll; a stored value that already equals the
  // new one needs no review and isn't a "from" mismatch.
  if (known && sameValue(currentValue, change.to)) {
    return {
      source: 'patch',
      patch_gid: gid,
      kind: change.kind,
      target: change.target,
      raw_target: change.rawTarget,
      field,
      stat_label: change.qualifier ? `${change.qualifier}: ${change.stat}` : change.stat,
      from_value: change.from,
      to_value: change.to,
      current_value: currentValue,
      raw_line: change.rawLine,
      status: 'applied' as ChangeStatus,
      from_mismatch: false,
      confirmed_by_wiki: true,
      confirmed_by_patch: true,
      decided_by: 'system (stats already match)',
      decided_at: new Date(),
    };
  }
  return {
    source: 'patch',
    patch_gid: gid,
    kind: change.kind,
    target: change.target,
    raw_target: change.rawTarget,
    field,
    stat_label: change.qualifier ? `${change.qualifier}: ${change.stat}` : change.stat,
    from_value: change.from,
    to_value: change.to,
    current_value: currentValue,
    raw_line: change.rawLine,
    status: initialStatus(change.kind, field, known),
    from_mismatch: isFromMismatch(change.from, currentValue),
    confirmed_by_wiki: !!field && !!findMatchingChange(pendingWiki, probe, 'wiki'),
    confirmed_by_patch: true,
  };
}

/** Ingests recent news posts oldest-first, applying the first-run baseline rule. */
export async function ingestNews(items: SteamNewsItem[], now = new Date()): Promise<IngestResult[]> {
  await balanceDbReady;
  const tableEmpty = (await PatchNote.count()) === 0;
  const results: IngestResult[] = [];
  for (const item of [...items].sort((a, b) => a.date - b.date)) {
    const baseline = shouldBaseline(tableEmpty, new Date(item.date * 1000), now);
    results.push(await ingestPatch(item, { baseline }));
  }
  return results;
}

// ---------- review actions ----------

export class BalanceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface ApproveOverrides {
  target?: string;
  field?: string;
  to_value?: number;
}

export async function approveChange(id: number, actor: string, overrides?: ApproveOverrides): Promise<BalanceChange> {
  await balanceDbReady;
  const change = await BalanceChange.findByPk(id);
  if (!change) throw new BalanceError('Change not found', 404);
  if (change.status !== 'pending' && change.status !== 'info') throw new BalanceError(`Change is already ${change.status}`, 409);

  const target = (overrides?.target ?? change.target).trim();
  const field = overrides?.field ?? change.field;
  const toValue = overrides?.to_value ?? change.to_value;
  if (!field) throw new BalanceError('Pick the stat this change applies to');
  if (!Number.isFinite(toValue)) throw new BalanceError('Value must be a number');
  const edited = target !== change.target || field !== change.field || !sameValue(toValue, change.to_value);

  const patch = change.patch_gid ? await PatchNote.findByPk(change.patch_gid) : null;
  const updatedFrom = patch?.title || 'wiki';
  const kind = isClassName(target) && field === 'health' ? 'class' : 'weapon';

  if (kind === 'class') {
    if (!Number.isInteger(toValue) || toValue <= 0) throw new BalanceError('Health must be a positive whole number');
    await ClassHealthStat.upsert({ build: target, health: toValue, updated_from: updatedFrom, updated_at: new Date() });
  } else {
    const row = await WeaponStat.findByPk(target);
    if (!row) throw new BalanceError(`Unknown weapon "${target}"`);
    const stats = JSON.parse(row.data) as WeaponStats;
    if (!isKnownField(stats, field)) throw new BalanceError(`${target} has no stat "${field}"`);
    await saveWeapon(setField(stats, field, toValue), edited ? 'manual' : row.source, updatedFrom);
  }

  const now = new Date();
  await change.update({ kind, target, field, to_value: toValue, status: 'applied', decided_by: actor, decided_at: now });

  // Anything else pending that says the same thing is now moot.
  const twins = await BalanceChange.findAll({ where: { status: 'pending', kind, target, field, id: { [Op.ne]: change.id } } });
  const sameIds = twins.filter((t) => sameValue(t.to_value, toValue));
  if (sameIds.length) {
    await BalanceChange.update({ status: 'applied', decided_by: actor, decided_at: now }, { where: { id: sameIds.map((t) => t.id) } });
  }
  await markReviewed([change.patch_gid, ...sameIds.map((t) => t.patch_gid)]);
  return change;
}

export async function rejectChange(id: number, actor: string): Promise<BalanceChange> {
  await balanceDbReady;
  const change = await BalanceChange.findByPk(id);
  if (!change) throw new BalanceError('Change not found', 404);
  if (change.status !== 'pending' && change.status !== 'info') throw new BalanceError(`Change is already ${change.status}`, 409);
  await change.update({ status: 'rejected', decided_by: actor, decided_at: new Date() });
  await markReviewed([change.patch_gid]);
  return change;
}

async function markReviewed(gids: Array<string | null>): Promise<void> {
  for (const gid of new Set(gids.filter((g): g is string => !!g))) {
    const left = await BalanceChange.count({ where: { patch_gid: gid, status: 'pending' } });
    if (left === 0) await PatchNote.update({ status: 'reviewed' }, { where: { gid, status: 'pending' } });
  }
}

// ---------- TTK ----------

export interface TtkEntry {
  name: string;
  build: string | null;
  wtype: string | null;
  notes: string[];
  rows: TtkRow[];
  /** Raw model so clients can recompute TTK at any range (see falloffMultiplierAt in weaponTtk.ts). */
  modes: AttackMode[];
  magSize: number | null;
  reloadS: number | null;
  falloffMinM: number | null;
  falloffMaxM: number | null;
  falloffMult: number | null;
}

export async function getTtkTable(): Promise<{ health: ClassHealth | null; weapons: TtkEntry[] }> {
  const [weapons, health] = await Promise.all([loadWeapons(), loadHealth()]);
  if (!health) return { health: null, weapons: [] };
  return {
    health,
    weapons: weapons.map((w) => ({ name: w.name, build: w.build, wtype: w.wtype, notes: w.notes, rows: computeTtk(w, health),
      modes: w.modes, magSize: w.magSize, reloadS: w.reloadS,
      falloffMinM: w.falloffMinM, falloffMaxM: w.falloffMaxM, falloffMult: w.falloffMult,
    })),
  };
}

// ---------- orchestration (shared by the watcher job and the admin "check now" button) ----------

export async function syncWikiNow(): Promise<WikiSyncSummary> {
  const snapshot = await fetchWikiSnapshot();
  return syncFromWiki(snapshot);
}

export async function pollPatchNotesNow(): Promise<IngestResult[]> {
  const items = await fetchOfficialNews(10);
  const results = await ingestNews(items);
  await setMeta('steam_last_poll', new Date().toISOString());
  for (const r of results) {
    if (r.status !== 'pending' && r.status !== 'reviewed') continue;
    logger.info(`[patchNotes] ${r.title}: ${r.parsed} changes (${r.actionable} actionable, ${r.mismatched} mismatched), ${r.unparsed} unparsed lines`);
    await sendInfoToDiscord(
      `New patch notes parsed: ${r.title}`,
      `${r.parsed} changes (${r.actionable} need review, ${r.mismatched} mismatched), ${r.unparsed} unparsed lines. Review: ${WEB_BASE_URL}/admin/balance`
    ).catch((err) => logger.warn('[patchNotes] Discord notify failed:', err));
  }
  return results;
}
