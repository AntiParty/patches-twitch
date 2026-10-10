import logger from "@/util/logger";
import { findCommand, getPublicCommands } from "@/util/commandCatalog";

export const execute = async (
    ctx: any,
    channel: string,
    message: string,
    tags: any,
    args: string[]
) => {
    try {
        const messageId = ctx.tags?.["id"];
        const discordLink = "https://discord.gg/2UKzvzSEqA";
        const docsLink = "https://finalsrs.com/docs";
        const requested = (args?.[0] || "").replace(/^!/, "").toLowerCase();

        // `!help <command>` → describe the command and link its docs row.
        // Fix for issue #6: give new users a real lead-in instead of a wall.
        if (requested) {
            const info = findCommand(requested);
            if (info) {
                await ctx.say(
                    `!${info.name}: ${info.description} Usage: ${info.usage} | ${docsLink}#cmd-${info.name}`,
                    messageId
                );
            } else {
                await ctx.say(
                    `Unknown command !${requested}. See all commands: ${docsLink}#commands`,
                    messageId
                );
            }
            return;
        }

        const cmds = getPublicCommands().map(c => `!${c.name}`);

        const reply = [
            `👋 Start with !link FinalsName#1234 to connect your account.`,
            `📜 Commands: ${cmds.join(", ")}`,
            `📘 Docs: ${docsLink}`,
            `💬 Help: ${discordLink}`,
        ].join(" | ");

        await ctx.say(reply, messageId);
    } catch (err) {
        logger.error("[help] Error executing help command:", err);
    }
};

export const aliases = ["info", "h", "cmds", "cmd"];
