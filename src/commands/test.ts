import { CommandContext } from "./record";

export const execute = async (
  ctx: CommandContext,
  _channel: string,
  message: string,
  tags: Record<string, any>,
  args: string[]
) => {
  await ctx.say(`Test command received! Args: ${args.join(", ")}`);
};

export const aliases = ["testcmd", "testcommand"];