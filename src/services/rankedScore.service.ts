import fs from "fs/promises";
import path from "path";

import logger from "../util/logger";

export interface RankedPlayer {
  name: string;
  rankScore?: any;
  [key: string]: any;
}

function getCacheDir(): string {
  return path.resolve(__dirname, "../../cache");
}

async function getLatestRegularCacheFile(): Promise<string | null> {
  try {
    const files = await fs.readdir(getCacheDir());
    const latest = files
      .filter((file) => file.startsWith("regular_s") && file.endsWith(".json"))
      .map((file) => ({
        file,
        season: Number.parseInt(file.match(/\d+/)?.[0] ?? "0", 10),
      }))
      .filter(({ season }) => season > 0)
      .sort((a, b) => b.season - a.season)[0];

    return latest ? path.join(getCacheDir(), latest.file) : null;
  } catch (error) {
    logger.error("[rankedScore] Failed to list regular leaderboard cache:", error);
    return null;
  }
}

export async function getLatestRegularLeaderboardData(): Promise<
  RankedPlayer[] | null
> {
  const file = await getLatestRegularCacheFile();
  if (!file) return null;

  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    logger.error("[rankedScore] Failed to read regular leaderboard cache:", error);
    return null;
  }
}

export function findRankedPlayer(
  data: RankedPlayer[] | null | undefined,
  playerId: string
): RankedPlayer | null {
  if (!Array.isArray(data) || typeof playerId !== "string") return null;

  const normalizedId = playerId.toLowerCase();
  const exact = data.find(
    (player) =>
      typeof player?.name === "string" &&
      player.name.toLowerCase() === normalizedId
  );
  if (exact) return exact;

  if (!normalizedId.includes("#")) return null;
  const baseName = normalizedId.split("#")[0];
  return (
    data.find(
      (player) =>
        typeof player?.name === "string" &&
        player.name.toLowerCase().startsWith(baseName)
    ) ?? null
  );
}

export async function getCurrentRankedScore(
  playerId: string
): Promise<number | null> {
  const player = findRankedPlayer(
    await getLatestRegularLeaderboardData(),
    playerId
  );
  const score = player?.rankScore;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}
