export function getBroadcasterOAuthScopes(): string[] {
  return [
    'channel:moderate',
    'user:read:chat',
    'user:bot',
    'channel:bot',
    'user:read:subscriptions',
    'channel:manage:predictions',
  ];
}

export function getCustomBotOAuthScopes(): string[] {
  return [
    'chat:read',
    'chat:edit',
    'user:read:email',
    'user:write:chat',
    'user:bot',
  ];
}
