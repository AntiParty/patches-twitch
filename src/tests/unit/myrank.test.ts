import assert from "assert";
import { formatMyRankResponse, getRandomFinalsRank } from "../../commands/myrank";

describe("myrank command", () => {
  it("formats the random rank response for the chatter", () => {
    assert.strictEqual(
      formatMyRankResponse("Antiparty", "Ruby", () => 0),
      "@Antiparty is currently ranked Ruby"
    );
  });

  it("can pick a funny response template", () => {
    const msg = formatMyRankResponse("Antiparty", "Goo Barrel Sommelier", () => 0.99);
    assert.ok(msg.includes("Antiparty"));
    assert.ok(msg.includes("Goo Barrel Sommelier"));
    assert.notStrictEqual(msg, "@Antiparty is currently ranked Goo Barrel Sommelier");
  });

  it("usually selects a serious THE FINALS rank", () => {
    const rolls = [0.15, 0];
    assert.strictEqual(getRandomFinalsRank(() => rolls.shift() ?? 0), "Bronze 4");
  });

  it("only selects a joke rank when the rare joke roll hits", () => {
    const rolls = [0.14, 0];
    assert.strictEqual(
      getRandomFinalsRank(() => rolls.shift() ?? 0),
      "Unranked, but the drip is Ruby"
    );
  });

  it("caps the random index at the last fun rank", () => {
    const rolls = [0, 1];
    assert.strictEqual(getRandomFinalsRank(() => rolls.shift() ?? 0), "Ruby in Quick Cash Only");
  });
});
