/**
 * Single source of truth for chat command metadata (used by !help and checked
 * against src/commands and the docs page by unit tests).
 * Aliases must match each command file's `aliases` export.
 */
export type CommandAudience = 'everyone' | 'broadcaster' | 'mods' | 'tester' | 'staff' | 'owner';

export interface CommandInfo {
  name: string;
  aliases: string[];
  usage: string;
  description: string;
  audience: CommandAudience;
  hidden?: boolean;
}

export const COMMAND_CATALOG: CommandInfo[] = [
  { name: 'addaccount', aliases: ['linkaccount', 'link'], usage: '!link <FinalsName#1234>', description: 'Links your THE FINALS account to the bot.', audience: 'mods' },
  { name: 'bans', aliases: ['banned', 'cheaters'], usage: '!bans', description: 'Shows recently banned players on the ranked leaderboard.', audience: 'everyone' },
  { name: 'cancel', aliases: [], usage: '!cancel p', description: 'Cancels the running channel points prediction and refunds viewers.', audience: 'mods' },
  { name: 'devmode', aliases: ['dev'], usage: '!devmode', description: 'Toggles dev mode for a channel.', audience: 'owner', hidden: true },
  { name: 'drops', aliases: ['drop', 'dropsinfo'], usage: '!drops', description: 'Lists the current active THE FINALS drops.', audience: 'everyone' },
  { name: 'editcmd', aliases: ['setcmd', 'commandedit'], usage: '!editcmd <command> [response | reset]', description: 'Customizes the response for !rank, !record, !peak, !enter, or !tracker.', audience: 'mods' },
  { name: 'end', aliases: [], usage: '!end p <outcome number or text>', description: 'Resolves the running channel points prediction.', audience: 'mods' },
  { name: 'enter', aliases: [], usage: '!enter', description: 'Enters the current giveaway (one entry per person).', audience: 'everyone' },
  { name: 'finalsrs', aliases: ['aboutfinalsrs'], usage: '!finalsrs', description: 'About the FinalsRS bot.', audience: 'everyone', hidden: true },
  { name: 'giveaway', aliases: [], usage: '!giveaway', description: 'Shows the current giveaway status and your entries.', audience: 'everyone' },
  { name: 'goal', aliases: ['setgoal', 'target'], usage: '!goal [rank | remove]', description: 'Sets or shows your leaderboard rank goal and progress.', audience: 'everyone' },
  { name: 'help', aliases: ['info', 'h', 'cmds', 'cmd'], usage: '!help [command]', description: 'Lists commands or shows help for one command.', audience: 'everyone', hidden: true },
  { name: 'myrank', aliases: ['randomrank', 'rrank'], usage: '!myrank', description: 'Gets a random THE FINALS-style rank for yourself.', audience: 'everyone' },
  { name: 'nextcache', aliases: ['cachetime', 'nc'], usage: '!nextcache', description: 'Shows when the leaderboard cache refreshes next.', audience: 'everyone', hidden: true },
  { name: 'part', aliases: ['leave'], usage: '!part', description: 'Makes the bot leave this channel.', audience: 'broadcaster' },
  { name: 'peak', aliases: [], usage: '!peak', description: 'Shows your all-time peak rank and Rank Score.', audience: 'everyone' },
  { name: 'ping', aliases: ['status'], usage: '!ping', description: 'Checks that the bot is responsive and shows latency.', audience: 'everyone' },
  { name: 'predict', aliases: ['cutoff', 'safe'], usage: '!predict <days>', description: 'Forecasts a future Top 500 cutoff from historical trends.', audience: 'tester' },
  { name: 'preset', aliases: [], usage: '!preset p <add|list|show|delete> ...', description: 'Manages channel points prediction presets.', audience: 'broadcaster' },
  { name: 'rank', aliases: ['r', 'rs', 'rankscore'], usage: '!rank [PlayerName#1234]', description: 'Shows current ranked leaderboard rank, league, and Rank Score.', audience: 'everyone' },
  { name: 'rankpred', aliases: [], usage: '!rankpred <start|status|cancel>', description: 'Manages automatic ranked predictions.', audience: 'mods' },
  { name: 'record', aliases: ['wl', 'winloss', 'session'], usage: '!record', description: 'Shows Rank Score gained or lost this stream session.', audience: 'everyone' },
  { name: 'refreshcommands', aliases: ['refresh', 'reload'], usage: '!refreshcommands', description: 'Reloads bot commands.', audience: 'owner', hidden: true },
  { name: 'role', aliases: [], usage: '!role <user> <role>', description: 'Sets a channel role.', audience: 'tester', hidden: true },
  { name: 'start', aliases: [], usage: '!start p <preset alias>', description: 'Starts a channel points prediction from a preset.', audience: 'mods' },
  { name: 'suppress', aliases: [], usage: '!suppress', description: 'Toggles the bot link-account reminder.', audience: 'broadcaster' },
  { name: 'testpremium', aliases: ['tpremium', 'premiumtest'], usage: '!testpremium <status|simulate|info> ...', description: 'Premium access testing tools.', audience: 'tester', hidden: true },
  { name: 'top500', aliases: ['t500'], usage: '!top500', description: 'Shows the RS and player at rank #500.', audience: 'everyone' },
  { name: 'tracker', aliases: ['profile'], usage: '!tracker', description: 'Links to your tracker profile.', audience: 'everyone' },
  { name: 'unlink', aliases: ['remove', 'disconnect'], usage: '!unlink', description: 'Removes the link to your account and parts the bot.', audience: 'broadcaster' },
  { name: 'update', aliases: ['nextupdate', 'updatetime', 'rankupdate'], usage: '!update', description: 'Shows time until the next weekly ranked update (Thursdays 4 AM MDT).', audience: 'everyone' },
];

export function getPublicCommands(): CommandInfo[] {
  return COMMAND_CATALOG
    .filter((c) => !c.hidden && c.audience === 'everyone')
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findCommand(nameOrAlias: string): CommandInfo | undefined {
  const key = (nameOrAlias || '').replace(/^!/, '').trim().toLowerCase();
  if (!key) return undefined;
  return COMMAND_CATALOG.find((c) => c.name === key || c.aliases.includes(key));
}
