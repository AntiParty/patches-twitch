/**
 * Shared leaderboard player matcher.
 *
 * Single source of truth for resolving a linked/queried player name against a
 * cached leaderboard. Used by both the `!rank` command and the peak-rank job so
 * matching behaves identically everywhere (a divergent, looser matcher in the
 * peak job was previously recording the wrong player's rank).
 *
 * Matching priority:
 *   1. Exact full id match — "lamp#5944"
 *   2. With a tag but no exact match — same name, any tag ("lamp#...")
 *   3. No tag — exact name-part match, then name-part prefix; best rank wins.
 *
 * Only the Embark `name` field is consulted (never steam/psn/xbox names), which
 * keeps fuzzy fallbacks from latching onto an unrelated account.
 */
export function searchPlayer(data: any[] | null, query: string): any | null {
  if (!data) return null;
  const q = query.toLowerCase().trim();
  if (!q) return null;

  // 1. Exact full match — "lamp#5944"
  const exact = data.find(p => typeof p?.name === 'string' && p.name.toLowerCase() === q);
  if (exact) return exact;

  if (q.includes('#')) {
    // Has a tag but no exact match — match on name-part prefix as fallback.
    // The trailing '#' is required so "ninja#1234" never matches "ninjawarrior#9999".
    const base = q.split('#')[0];
    return data.find(p => typeof p?.name === 'string' && p.name.toLowerCase().startsWith(base + '#')) ?? null;
  }

  // No tag — search by name portion only.
  // 2. Exact name-part match — "lamp" matches "lamp#5944" and "lamp#1111"; pick best rank.
  const exactName = data.filter(p => typeof p?.name === 'string' && p.name.toLowerCase().split('#')[0] === q);
  if (exactName.length > 0) return exactName.sort((a, b) => a.rank - b.rank)[0];

  // 3. StartsWith match — "lam" matches "lamp#5944"; pick best rank.
  const starts = data.filter(p => typeof p?.name === 'string' && p.name.toLowerCase().split('#')[0].startsWith(q));
  if (starts.length > 0) return starts.sort((a, b) => a.rank - b.rank)[0];

  return null;
}
