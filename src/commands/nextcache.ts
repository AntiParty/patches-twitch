import { getNextCacheUpdateInfo } from "@/jobs/cacheUpdater";

export const execute = async (ctx) => {
    const messageId = ctx.tags?.['id'];
    const info = getNextCacheUpdateInfo();
    const min = Math.floor(info.msLeft / 60000);
    const sec = Math.floor((info.msLeft % 60000) / 1000);
    const replyMessage = `Next cache update in ${min}m ${sec}s.`;
    await ctx.say(replyMessage, messageId);
}
export const aliases = ["cachetime", "nc"];