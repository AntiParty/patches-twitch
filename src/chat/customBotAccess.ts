/** Custom bot accounts are limited to subscribed channels and privileged roles. */
export function hasCustomBotAccess(channel: { has_subscription?: boolean | null; role?: string | null }): boolean {
  return Boolean(channel.has_subscription) || ['tester', 'Staff', 'admin'].includes(channel.role ?? '');
}
