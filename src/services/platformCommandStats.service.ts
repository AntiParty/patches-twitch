import { CommandUsage } from '@/db';

export interface PlatformCommandStatsDependencies {
  countCommands: () => Promise<number>;
}

export function createPlatformCommandStats(deps: PlatformCommandStatsDependencies) {
  return {
    getCommandsProcessed: () => deps.countCommands(),
  };
}

export const platformCommandStats = createPlatformCommandStats({
  countCommands: () => CommandUsage.count(),
});
