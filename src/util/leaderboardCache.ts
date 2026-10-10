import fs from "fs/promises";
import path from "path";
import logger from "./logger";

function getCacheDir() {
  return path.resolve(__dirname, "../../cache");
}

export async function getTransitionSuffix(): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(getCacheDir(), "meta.json"), "utf8");
    const meta = JSON.parse(raw);
    if (meta?.transitioning) return ` [S${meta.season} API not found — waiting on Embark]`;
  } catch {
    // meta.json missing — no suffix
  }
  return "";
}

export async function getLatestCacheFile(prefix: string): Promise<string | null> {
  try {
    const files = await fs.readdir(getCacheDir());
    const matched = files
      .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
      .map(f => {
        const num = parseInt(f.match(/\d+/)?.[0] ?? "0", 10);
        return { file: f, season: num };
      })
      .filter(x => x.season > 0)
      .sort((a, b) => b.season - a.season); // newest first

    return matched.length > 0 ? path.join(getCacheDir(), matched[0].file) : null;
  } catch (err) {
    logger.error(`Failed to list cache files for ${prefix}:`, err);
    return null;
  }
}

export async function getLatestLeaderboardData() {
  const file = await getLatestCacheFile("regular_s");
  if (!file) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    logger.error("Failed to read leaderboard cache file:", err);
    return null;
  }
}
