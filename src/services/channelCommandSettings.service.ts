import { DisabledChannelCommand } from '@/db';

export const VIEWER_COMMANDS = [
  { name: 'rank', label: 'Rank', aliases: ['r', 'rs', 'rankscore'] },
  { name: 'record', label: 'Session record', aliases: ['wl', 'winloss', 'session'] },
  { name: 'peak', label: 'Peak rank', aliases: [] },
  { name: 'goal', label: 'Rank goal', aliases: ['setgoal', 'target'] },
  { name: 'drops', label: 'Twitch Drops', aliases: ['drop', 'dropsinfo'] },
  { name: 'tracker', label: 'Tracker profile', aliases: ['profile'] },
] as const;

export type ViewerCommandName = typeof VIEWER_COMMANDS[number]['name'];

export interface ViewerCommandSetting {
  name: ViewerCommandName;
  label: string;
  enabled: boolean;
}

function normalizeCommandName(command: string): string {
  return command.replace(/^!/, '').trim().toLowerCase();
}

export function resolveViewerCommandName(command: string): ViewerCommandName | null {
  const normalized = normalizeCommandName(command);
  const match = VIEWER_COMMANDS.find(({ name, aliases }) => name === normalized || aliases.includes(normalized as never));
  return match?.name ?? null;
}

export async function getViewerCommandSettings(channel: string): Promise<ViewerCommandSetting[]> {
  const disabledCommands = await DisabledChannelCommand.findAll({
    where: { channel },
    attributes: ['command'],
  });
  const disabledNames = new Set(disabledCommands.map((row) => String(row.command)));

  return VIEWER_COMMANDS.map(({ name, label }) => ({
    name,
    label,
    enabled: !disabledNames.has(name),
  }));
}

export async function setViewerCommandEnabled(
  channel: string,
  command: ViewerCommandName,
  enabled: boolean,
): Promise<ViewerCommandSetting> {
  const resolved = resolveViewerCommandName(command);
  if (!resolved || resolved !== command) {
    throw new Error(`Unsupported viewer command: ${command}`);
  }

  if (enabled) {
    await DisabledChannelCommand.destroy({ where: { channel, command } });
  } else {
    await DisabledChannelCommand.findOrCreate({ where: { channel, command } });
  }

  const definition = VIEWER_COMMANDS.find(({ name }) => name === command)!;
  return { name: definition.name, label: definition.label, enabled };
}

export async function isViewerCommandDisabled(channel: string, command: string): Promise<boolean> {
  const resolved = resolveViewerCommandName(command);
  if (!resolved) return false;

  return (await DisabledChannelCommand.count({ where: { channel, command: resolved } })) > 0;
}
