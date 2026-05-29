const SERIOUS_RANKS = [
  "Bronze 4",
  "Bronze 3",
  "Bronze 2",
  "Bronze 1",
  "Silver 4",
  "Silver 3",
  "Silver 2",
  "Silver 1",
  "Gold 4",
  "Gold 3",
  "Gold 2",
  "Gold 1",
  "Platinum 4",
  "Platinum 3",
  "Platinum 2",
  "Platinum 1",
  "Diamond 4",
  "Diamond 3",
  "Diamond 2",
  "Diamond 1",
  "Ruby",
];

const JOKE_RANKS = [
  "Running It Down 1",
  "Rank 1 In Excuses",
  "RPG Self-Damage Champion",
  "Ruby (According To Mom)",
  "Top 500 In Practice Range"
];

const JOKE_RANK_CHANCE = 0.15;

type ResponseFormatter = (username: string, rank: string) => string;

const RESPONSE_TEMPLATES: ResponseFormatter[] = [
  (username, rank) => `@${username} peaked at ${rank} and has been talking about it ever since`,
(username, rank) => `Matchmaking has classified @${username} as ${rank}`,
(username, rank) => `After reviewing the footage, @${username} is ${rank}`,
(username, rank) => `The cashout gods have assigned @${username}: ${rank}`,
(username, rank) => `CONFIRMED: @${username} is ${rank}`,
(username, rank) => `Leaked MMR report: @${username} = ${rank}`,
(username, rank) => `@${username} is ${rank} (source: trust me bro)`,
(username, rank) => `Breaking: @${username} promoted to ${rank}`,
];

interface CommandContext {
  say: (message: string, replyToId?: string) => Promise<void>;
  user: string;
  tags?: Record<string, any>;
}

export const name = "myrank";
export const description = "Get a random THE FINALS-style rank for yourself.";

function pickRank(ranks: readonly string[], rng: () => number): string {
  const index = Math.min(Math.floor(rng() * ranks.length), ranks.length - 1);
  return ranks[index];
}

export function getRandomFinalsRank(rng: () => number = Math.random): string {
  return rng() < JOKE_RANK_CHANCE ? pickRank(JOKE_RANKS, rng) : pickRank(SERIOUS_RANKS, rng);
}

export function formatMyRankResponse(
  username: string,
  rank: string,
  rng: () => number = () => 0
): string {
  const index = Math.min(
    Math.floor(rng() * RESPONSE_TEMPLATES.length),
    RESPONSE_TEMPLATES.length - 1
  );
  return RESPONSE_TEMPLATES[index](username, rank);
}

export const execute = async (ctx: CommandContext) => {
  const username = ctx.tags?.["display-name"] || ctx.user || "user";
  const messageId = ctx.tags?.["id"];
  const rng = Math.random;
  const rank = getRandomFinalsRank(rng);
  await ctx.say(formatMyRankResponse(username, rank, rng), messageId);
};

export const aliases = ["randomrank", "rrank"];
