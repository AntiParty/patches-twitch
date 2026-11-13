export interface EmbarkCapability {
  title: string
  description: string
  /** On-site route a reader can open; omitted when no public page exists. */
  href?: string
  hrefLabel?: string
}

export const embarkCapabilities: EmbarkCapability[] = [
  {
    title: 'Ranked lookups in chat',
    description:
      '!rank gives any viewer a player’s rank, league and RS from the current season’s ranked leaderboard, for the streamer or any name they type.',
    href: '/leaderboard',
    hrefLabel: 'See it live',
  },
  {
    title: 'Session tracking and goals',
    description:
      '!record shows the RS gained or lost since the stream started, and !goal tracks progress toward a rank target such as Ruby.',
    href: '/docs#record-vars',
    hrefLabel: 'Read the docs',
  },
  {
    title: 'Twitch predictions',
    description:
      'Streamers run predictions from chat with saved presets, or have one opened and settled automatically from their ranked RS change. If the RS data is unreliable, the prediction is cancelled and viewers are refunded.',
    href: '/docs#predictions',
    hrefLabel: 'Read the docs',
  },
  {
    title: 'Weapon time to kill',
    description:
      'Compares time to kill across weapons by range, target and hit location, using community wiki weapon stats kept current with the official patch notes.',
    href: '/ttk',
    hrefLabel: 'See it live',
  },
  {
    title: 'Twitch Drops',
    description:
      '!drops tells chat which Drops are active and how to link accounts. The Drops page lists active campaigns and the FinalsRS channels currently playing THE FINALS.',
    href: '/twitch-drops',
    hrefLabel: 'See it live',
  },
  {
    title: 'Public developer API',
    description:
      'Keyless endpoints for the Top 500 cutoff forecast and per-player ranked stats, with CORS enabled and a limit of 60 requests per minute per IP.',
    href: '/developer',
    hrefLabel: 'See the API',
  },
]

export const embarkHowItWorks =
  'FinalsRS is built on the public ranked leaderboard for the current season. It checks the board every 15 minutes, keeps the latest copy, and answers chat commands and session tracking from that copy. That keeps lookups fast, and it sets some limits.'

export const embarkComparison = [
  {
    topic: 'Who can be looked up',
    today: 'Players on the public board, which lists the top 10,000. Anyone else gets a “not on the leaderboard” reply.',
    withOfficialData: 'Lookups could cover ranked players below the top 10,000.',
  },
  {
    topic: 'How current it is',
    today: 'Standings are as of the last 15-minute check.',
    withOfficialData: 'Freshness would follow what Embark provides, not a fixed check interval.',
  },
  {
    topic: 'Session movement',
    today: 'RS gained in a stream shows up once the board refreshes, not as each match ends.',
    withOfficialData: 'RS changes could reach chat closer to when they happen.',
  },
  {
    topic: 'Season changes',
    today: 'Around a season change, replies note that the new board is not published yet.',
    withOfficialData: 'Rollovers could follow Embark’s own signal instead.',
  },
] as const

export const embarkProposals = [
  {
    title: 'Official data access',
    description:
      'Access to an official ranked-data source for the current season, so FinalsRS reads from Embark directly instead of the public leaderboard page. FinalsRS would work within whatever terms Embark sets.',
  },
  {
    title: 'Creator programme collaboration',
    description:
      'Offer FinalsRS to creators in Embark’s programmes, and shape the roadmap with Embark’s input on what streamers and viewers need. The Drops page already lists FinalsRS channels playing the game.',
  },
  {
    title: 'Licensing, acquisition or continued work',
    description:
      'Talk through licensing the product, acquiring it, or Embark supporting its continued development, whichever fits Embark’s plans. It lives in one repository, so there is one thing to hand over.',
  },
] as const

export const embarkBuilder =
  'Designed, built, deployed, and operated independently by AntiParty: frontend and backend, Twitch integrations, APIs, databases, infrastructure, and product design. FinalsRS is independent and not affiliated with Embark Studios.'

export const embarkGallery = [
  {
    kind: 'dashboard',
    title: 'Streamer dashboard',
    detail:
      'After signing in with Twitch, a streamer manages commands, predictions, giveaways, the rank tracker and OBS overlays in one place.',
  },
  {
    kind: 'chat',
    title: 'Twitch chat',
    detail: 'A viewer types !rank and the bot replies in chat with rank, league and RS, so nobody leaves the stream to look it up.',
  },
  {
    kind: 'tracking',
    title: 'Rank tracking',
    detail: 'The streamer’s RS at the start of the stream against now; viewers see the same movement through !record.',
  },
  {
    kind: 'predictions',
    title: 'Predictions',
    detail: 'The streamer opens a Twitch prediction on the next RS milestone and viewers vote with channel points.',
  },
] as const

export const embarkContact = {
  site: '/',
  x: 'https://x.com/AntipartyGG',
  email: 'partnerships@finalsrs.com',
}
