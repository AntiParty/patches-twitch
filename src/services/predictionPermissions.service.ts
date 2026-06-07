function badges(tags: Record<string, any>): Record<string, any> {
  if (tags?.badges && typeof tags.badges === 'object') return tags.badges;
  if (typeof tags?.badges !== 'string') return {};
  return Object.fromEntries(
    tags.badges
      .split(',')
      .map((badge: string) => badge.split('/', 2))
      .filter(([name]: string[]) => Boolean(name)),
  );
}

function hasBadge(tags: Record<string, any>, name: string): boolean {
  const value = badges(tags)[name];
  return value === '1' || value === 1 || value === true;
}

export function isBroadcaster(
  user: string,
  channel: string,
  tags: Record<string, any>,
): boolean {
  if (hasBadge(tags, 'broadcaster')) return true;
  return String(user || '').toLowerCase() === String(channel || '').replace(/^#/, '').toLowerCase();
}

export function canManagePredictionPresets(
  user: string,
  channel: string,
  tags: Record<string, any>,
): boolean {
  return isBroadcaster(user, channel, tags);
}

export function canOperatePredictions(
  user: string,
  channel: string,
  tags: Record<string, any>,
): boolean {
  return isBroadcaster(user, channel, tags) || hasBadge(tags, 'moderator');
}
