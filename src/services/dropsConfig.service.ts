export interface DropConfigItem {
    name: string;
    category: string;
    duration: string;
}

export interface DropsConfig {
    lastUpdated: string;
    featuredImage: string;
    endsAt: string;
    drops: DropConfigItem[];
}

const MAX_DROPS = 50;

function cleanText(value: unknown, maxLength: number): string {
    return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeEndDate(value: unknown): string {
    const endDate = cleanText(value, 100);
    if (!endDate) return '';

    const timestamp = Date.parse(endDate);
    if (!Number.isFinite(timestamp)) {
        throw new Error('Invalid Drops configuration end date');
    }

    return new Date(timestamp).toISOString();
}

export function normalizeDropsConfig(input: unknown): DropsConfig {
    if (!input || typeof input !== 'object' || !Array.isArray((input as any).drops)) {
        throw new Error('Invalid Drops configuration');
    }

    const source = input as any;
    if (source.drops.length > MAX_DROPS) {
        throw new Error(`Drops configuration may contain no more than ${MAX_DROPS} items`);
    }

    const drops = source.drops
        .map((drop: any) => ({
            name: cleanText(drop?.name, 120),
            category: cleanText(drop?.category, 80),
            duration: cleanText(drop?.duration, 80),
        }))
        .filter((drop: DropConfigItem) => drop.name || drop.category || drop.duration);

    return {
        lastUpdated: cleanText(source.lastUpdated, 100),
        featuredImage: cleanText(source.featuredImage, 500),
        endsAt: normalizeEndDate(source.endsAt),
        drops,
    };
}

export function getPublicDropsConfig(config: DropsConfig, now = new Date()): DropsConfig {
    if (!config.endsAt || now.getTime() < Date.parse(config.endsAt)) return config;

    return {
        ...config,
        featuredImage: '',
        drops: [],
    };
}
