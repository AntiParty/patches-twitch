import { strict as assert } from "assert";
import fs from "fs/promises";
import path from "path";

import {
  findRankedPlayer,
  getCurrentRankedScore,
} from "../../services/rankedScore.service";

describe("Ranked score service", () => {
  const cacheDir = path.join(process.cwd(), "cache");
  const cacheFile = path.join(cacheDir, "regular_s99999.json");

  afterEach(async () => {
    await fs.rm(cacheFile, { force: true });
  });

  it("prefers an exact case-insensitive Embark ID match", () => {
    const exact = { name: "Player#1234", rankScore: 51000 };
    const fallback = { name: "Player#9999", rankScore: 49000 };

    assert.equal(
      findRankedPlayer([fallback, exact], "pLaYeR#1234"),
      exact
    );
  });

  it("falls back to the existing base-name match", () => {
    const player = { name: "Player#9999", rankScore: 49000 };

    assert.equal(findRankedPlayer([player], "player#1234"), player);
  });

  it("returns null when no player matches", () => {
    assert.equal(
      findRankedPlayer(
        [{ name: "SomeoneElse#1234", rankScore: 49000 }],
        "player#1234"
      ),
      null
    );
  });

  it("reads a finite score from the latest regular leaderboard cache", async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      cacheFile,
      JSON.stringify([{ name: "Player#1234", rankScore: 50123 }]),
      "utf8"
    );

    assert.equal(await getCurrentRankedScore("player#1234"), 50123);
  });

  it("returns null for a missing player or invalid score", async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(
      cacheFile,
      '[{"name":"Invalid#1234","rankScore":"50123"},' +
        '{"name":"Infinite#1234","rankScore":1e309}]',
      "utf8"
    );

    assert.equal(await getCurrentRankedScore("missing#1234"), null);
    assert.equal(await getCurrentRankedScore("invalid#1234"), null);
    assert.equal(await getCurrentRankedScore("infinite#1234"), null);
  });
});
