import { strict as assert } from "assert";

import logger from "../../util/logger";
import { getLiveStreamsForUsers } from "../../util/twitchUtils";

type FetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

function response(body: unknown): FetchResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

describe("Twitch stream metadata", () => {
  const originalFetch = global.fetch;
  const originalClientId = process.env.TWITCH_CLIENT_ID;
  const originalAppToken = process.env.TWITCH_APP_ACCESS_TOKEN;
  const originalWarn = logger.warn;

  beforeEach(() => {
    process.env.TWITCH_CLIENT_ID = "client-id";
    process.env.TWITCH_APP_ACCESS_TOKEN = "app-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    logger.warn = originalWarn;
    if (originalClientId === undefined) delete process.env.TWITCH_CLIENT_ID;
    else process.env.TWITCH_CLIENT_ID = originalClientId;
    if (originalAppToken === undefined) delete process.env.TWITCH_APP_ACCESS_TOKEN;
    else process.env.TWITCH_APP_ACCESS_TOKEN = originalAppToken;
  });

  it("returns normalized stream identity and category metadata", async () => {
    global.fetch = (async () =>
      response({
        data: [
          {
            user_login: "AntiParty",
            thumbnail_url: "https://img/{width}x{height}.jpg",
            game_id: "2076049542",
            game_name: "THE FINALS",
            started_at: "2026-06-09T01:02:03Z",
          },
        ],
        pagination: {},
      }) as any) as typeof fetch;

    const streams = await getLiveStreamsForUsers(["AntiParty"]);

    assert.deepEqual(streams, [
      {
        username: "antiparty",
        thumbnailUrl: "https://img/320x180.jpg",
        gameId: "2076049542",
        gameName: "THE FINALS",
        startedAt: new Date("2026-06-09T01:02:03Z"),
      },
    ]);
  });

  it("populates metadata on paginated results and normalizes missing game fields", async () => {
    const urls: string[] = [];
    global.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("after=next-page")) {
        return response({
          data: [
            {
              user_login: "Second",
              started_at: "2026-06-09T02:00:00Z",
            },
          ],
          pagination: {},
        }) as any;
      }
      return response({
        data: [
          {
            user_login: "First",
            game_id: "1",
            game_name: "THE FINALS",
            started_at: "2026-06-09T01:00:00Z",
          },
        ],
        pagination: { cursor: "next-page" },
      }) as any;
    }) as typeof fetch;

    const streams = await getLiveStreamsForUsers(["First", "Second"]);

    assert.equal(urls.length, 2);
    assert.equal(streams[1].username, "second");
    assert.equal(streams[1].gameId, "");
    assert.equal(streams[1].gameName, "");
    assert.deepEqual(streams[1].startedAt, new Date("2026-06-09T02:00:00Z"));
  });

  it("skips malformed or missing start times and logs a safe warning", async () => {
    const warnings: unknown[][] = [];
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args);
      return logger;
    }) as typeof logger.warn;
    global.fetch = (async () =>
      response({
        data: [
          { user_login: "MissingStart", game_name: "THE FINALS" },
          {
            user_login: "BadStart",
            game_name: "THE FINALS",
            started_at: "not-a-date",
          },
          {
            user_login: "Valid",
            game_name: "THE FINALS",
            started_at: "2026-06-09T03:00:00Z",
          },
        ],
        pagination: {},
      }) as any) as typeof fetch;

    const streams = await getLiveStreamsForUsers([
      "MissingStart",
      "BadStart",
      "Valid",
    ]);

    assert.deepEqual(streams.map((stream) => stream.username), ["valid"]);
    assert.equal(warnings.length, 2);
    assert.match(String(warnings[0][0]), /^\[getLiveStreams\]/);
    assert.doesNotMatch(JSON.stringify(warnings), /app-token|Authorization/i);
  });
});
