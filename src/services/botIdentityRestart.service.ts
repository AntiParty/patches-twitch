interface RestartChannel {
    username: string;
    access_token: string | null;
    refresh_token: string | null;
    twitch_user_id: string | null;
}

interface RestartDependencies {
    getChannel: (username: string) => Promise<RestartChannel | null>;
    stopBot: (username: string) => Promise<void>;
    startBot: (channel: RestartChannel) => Promise<void>;
    hasClient: (username: string) => boolean;
    isAuthenticated: (username: string) => boolean;
    sleep: (milliseconds: number) => Promise<void>;
}

export interface BotIdentityRestartResult {
    success: boolean;
    error?: string;
}

async function waitFor(
    predicate: () => boolean,
    expected: boolean,
    sleep: RestartDependencies['sleep'],
    attempts = 20,
): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (predicate() === expected) return true;
        await sleep(50);
    }
    return predicate() === expected;
}

export async function restartBotIdentity(
    username: string,
    dependencies: RestartDependencies,
): Promise<BotIdentityRestartResult> {
    const channel = await dependencies.getChannel(username);
    if (!channel) return { success: false, error: 'Channel not found' };

    await dependencies.stopBot(username);
    const removed = await waitFor(
        () => dependencies.hasClient(username),
        false,
        dependencies.sleep,
    );
    if (!removed) return { success: false, error: 'Previous bot connection did not stop' };

    await dependencies.startBot(channel);
    const authenticated = await waitFor(
        () => dependencies.isAuthenticated(username),
        true,
        dependencies.sleep,
        100,
    );
    return authenticated
        ? { success: true }
        : { success: false, error: 'Replacement bot did not authenticate' };
}
