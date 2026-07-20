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
type SearchPlayerOptions = {
  fuzzy?: boolean;
};

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function commonPrefixLength(left: string, right: string): number {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
  return length;
}

function fuzzyScore(query: string, candidate: string): number {
  const normalizedQuery = query.replace(/[^a-z0-9]+/g, '');
  const normalizedCandidate = candidate.replace(/[^a-z0-9]+/g, '');
  const tokens = candidate.split(/[^a-z0-9]+/).filter(Boolean);
  const tokenAffinity = tokens.reduce((best, token) => {
    const shorterLength = Math.min(normalizedQuery.length, token.length);
    if (!shorterLength) return best;
    return Math.max(best, commonPrefixLength(normalizedQuery, token) / shorterLength);
  }, 0);
  const longestLength = Math.max(normalizedQuery.length, normalizedCandidate.length, 1);
  const editSimilarity = 1 - editDistance(normalizedQuery, normalizedCandidate) / longestLength;
  return tokenAffinity * 2 + editSimilarity;
}

export function searchPlayer(data: any[] | null, query: string, options: SearchPlayerOptions = {}): any | null {
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

  if (options.fuzzy) {
    const candidates = data
      .filter(p => typeof p?.name === 'string')
      .map(player => ({
        player,
        score: fuzzyScore(q, player.name.toLowerCase().split('#')[0]),
      }))
      .sort((left, right) =>
        right.score - left.score || Number(left.player.rank ?? Infinity) - Number(right.player.rank ?? Infinity)
      );
    return candidates[0]?.player ?? null;
  }

  return null;
}
