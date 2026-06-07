function badges(tags: Record<string, any>): Record<string, any> {
  return tags?.badges && typeof tags.badges === 'object' ? tags.badges : {};
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
