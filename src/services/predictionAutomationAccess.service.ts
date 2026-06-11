interface PredictionAutomationAccount {
  has_subscription?: boolean;
  hasSubscription?: boolean;
  role?: string | null;
}

const EARLY_ACCESS_ROLES = new Set(['subscriber', 'tester', 'staff', 'admin']);

export function hasPredictionAutomationAccess(
  account: PredictionAutomationAccount | null | undefined,
): boolean {
  if (process.env.NODE_ENV === 'development') return true;
  if (account?.has_subscription || account?.hasSubscription) return true;
  return EARLY_ACCESS_ROLES.has(String(account?.role || '').toLowerCase());
}
