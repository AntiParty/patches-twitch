export const embarkCapabilities = [
  'Live ranked and RS tracking',
  'Twitch chat commands',
  'Stream and session statistics',
  'Automated Twitch predictions',
  'Streamer dashboard',
  'Public and developer API',
]

export const embarkGallery = [
  { kind: 'dashboard', title: 'Streamer dashboard', detail: 'A single operating surface for a channel.' },
  { kind: 'chat', title: 'Twitch chat', detail: 'Ranked context delivered where viewers already are.' },
  { kind: 'tracking', title: 'Rank tracking', detail: 'Session movement, RS, and long-term progress.' },
  { kind: 'predictions', title: 'Predictions', detail: 'Structured viewer participation around live play.' },
] as const

export const embarkContact = {
  site: '/',
  twitch: 'https://twitch.tv/antiparty',
  email: 'your-email@example.com',
}
