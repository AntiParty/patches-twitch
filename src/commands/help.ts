import fs from "fs";
import path from "path";
import logger from "@/util/logger";

/**
 * Commands we don't want to advertise to viewers — admin tooling,
 * internal plumbing, or staff-only utilities.
 */
const HIDDEN_COMMANDS = new Set([
    "devmode",
    "dev",
    "addaccount",    // admin-only; not a viewer-facing utility
    "suppress",
    "testpremium",
    "role",
    "editcmd",       // hint via !editcmd when needed; not useful in the help list
    "update",
    "finalsrs",
    "nextcache",
    "part",
    "unlink",
    "help",          // we're the help command; self-reference is noisy
    "h",
    "info",
    "cmds",
    "cmd",
    "status",        // alias of ping
    "preset",
    "start",
    "end",
    "cancel",
]);

let cachedCommandList: string[] | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function discoverViewerCommands(): string[] {
    if (cachedCommandList && Date.now() - cacheAt < CACHE_TTL_MS) {
        return cachedCommandList;
    }
    try {
        const dir = path.resolve(__dirname);
        const files = fs.readdirSync(dir).filter(f => /\.(ts|js)$/.test(f));
        const names = files
            .map(f => path.basename(f, path.extname(f)).toLowerCase())
            .filter(n => !HIDDEN_COMMANDS.has(n))
            .sort();
        // Prepend an ! so users can paste directly.
        cachedCommandList = names.map(n => `!${n}`);
        cacheAt = Date.now();
        return cachedCommandList;
    } catch (err) {
        logger.warn("[help] Failed to read commands dir, falling back to static list:", err);
        return ["!rank", "!peak", "!record", "!goal", "!predict", "!drops"];
    }
}

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

        // `!help <command>` → point them at the docs anchor for that command.
        // Fix for issue #6: give new users a real lead-in instead of a wall.
        if (requested) {
            await ctx.say(
                `📘 See ${docsLink}#${requested} for examples of !${requested}. Not working? ${discordLink}`,
                messageId
            );
            return;
        }

        const cmds = discoverViewerCommands();

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
