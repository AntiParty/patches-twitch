export function getCustomBotOAuthScopes(): string[] {
  return [
    'chat:read',
    'chat:edit',
    'user:read:email',
    'user:write:chat',
    'user:bot',
  ];
}
