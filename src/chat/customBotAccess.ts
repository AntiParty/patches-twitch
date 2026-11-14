const CUSTOM_BOT_ROLES = ['subscriber', 'tester', 'staff', 'admin'];

/** Custom bot accounts are limited to subscribed channels and privileged roles (same set as the web gates). */
export function hasCustomBotAccess(channel: { has_subscription?: boolean | null; role?: string | null }): boolean {
  return Boolean(channel.has_subscription) || CUSTOM_BOT_ROLES.includes((channel.role ?? '').toLowerCase());
}
