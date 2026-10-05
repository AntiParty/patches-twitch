interface LiveStream {
    username: string;
    gameName: string;
    thumbnailUrl?: string;
}

interface DropsStreamer {
    channel: string;
    thumbnail_url?: string;
}

/** Cache Twitch category checks independently of bot-process session state. */
export function createDropsStreamersService(
    loadLiveStreams: () => Promise<LiveStream[]>,
    refreshAppToken: () => Promise<unknown>,
    now = Date.now,
) {
    let cached: DropsStreamer[] = [];
    let expiresAt = 0;
    let tokenExpiresAt = 0;
    let pending: Promise<DropsStreamer[]> | undefined;

    return async (): Promise<DropsStreamer[]> => {
        if (now() < expiresAt) return cached;
        if (pending) return pending;
        pending = (async () => {
            // The web process cannot see tokens refreshed in the bot process.
            if (now() >= tokenExpiresAt) {
                await refreshAppToken();
                tokenExpiresAt = now() + 30 * 60_000;
            }
            let streams: LiveStream[];
            try {
                streams = await loadLiveStreams();
            } catch (error) {
                if (!(error instanceof Error) || !/^Twitch live-stream request failed: 401\b/.test(error.message)) throw error;
                tokenExpiresAt = 0;
                await refreshAppToken();
                streams = await loadLiveStreams();
                tokenExpiresAt = now() + 30 * 60_000;
            }
            const seen = new Set<string>();
            cached = streams.filter(stream => {
                const username = stream.username.toLowerCase();
                if (stream.gameName.trim().toLowerCase() !== 'the finals' || seen.has(username)) return false;
                seen.add(username);
                return true;
            }).slice(0, 12).map(stream => ({
                channel: stream.username.toLowerCase(),
                thumbnail_url: stream.thumbnailUrl,
            }));
            expiresAt = now() + 60_000;
            return cached;
        })();
        try {
            return await pending;
        } finally {
            pending = undefined;
        }
    };
}
