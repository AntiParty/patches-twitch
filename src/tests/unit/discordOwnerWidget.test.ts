import { strict as assert } from 'assert';
import {
  buildOwnerWidgetPayload,
  createOwnerWidgetSync,
  loadOwnerWidgetStats,
  type OwnerWidgetStats,
} from '@/services/discordOwnerWidget.service';
import { Channel, PeakRank, StreamSession } from '@/db';
import { getRankIconUrl } from '@/util/rankIcons';

const stats: OwnerWidgetStats = {
  playerName: 'twitch-Antiparty#8470',
  currentRank: 42,
  currentLeague: 'Ruby',
  currentRS: 61234,
  sessionChange: 418,
  peakLeague: 'Ruby',
  peakRS: 64110,
  peakSeason: 'Season 9',
  ownerLabel: 'Founder · FinalsRS.com',
  rankIconUrl: 'https://www.thefinals.wiki/w/images/8/81/League_Ruby.png',
};

describe('Discord owner profile widget', () => {
  it('preserves the fully linked account name in the Discord widget payload', () => {
    assert.deepEqual(buildOwnerWidgetPayload(stats), {
      username: 'twitch-Antiparty#8470',
      data: {
        dynamic: [
          { type: 1, name: 'player_name', value: 'twitch-Antiparty#8470' },
          {
            type: 3,
            name: 'rank_icon',
            value: { url: 'https://www.thefinals.wiki/w/images/8/81/League_Ruby.png' },
          },
          { type: 1, name: 'current_league', value: 'Ruby' },
          { type: 1, name: 'current_rank', value: '#42' },
          { type: 1, name: 'current_rs', value: '61,234 RS' },
          { type: 1, name: 'session_change', value: '+418 RS' },
          { type: 1, name: 'peak_rank', value: '64,110 RS' },
          { type: 1, name: 'peak_record', value: 'Ruby · S9' },
          { type: 1, name: 'owner_label', value: 'Founder · FinalsRS.com' },
        ],
      },
    });
  });

  it('uses the linked account name as stored instead of the leaderboard display name', async () => {
    const originalChannelFindOne = Channel.findOne;
    const originalPeakFindOne = PeakRank.findOne;
    const originalSessionFindOne = StreamSession.findOne;

    try {
      (Channel as any).findOne = async () => ({ player_id: 'twitch-Antiparty#8470' });
      (PeakRank as any).findOne = async () => null;
      (StreamSession as any).findOne = async () => null;

      const loaded = await loadOwnerWidgetStats('antiparty', [{
        name: 'twitch-antiparty#8470',
        rank: 42,
        rankScore: 61234,
        league: 'Ruby',
      }]);

      assert.equal(loaded?.playerName, 'twitch-Antiparty#8470');
    } finally {
      (Channel as any).findOne = originalChannelFindOne;
      (PeakRank as any).findOne = originalPeakFindOne;
      (StreamSession as any).findOne = originalSessionFindOne;
    }
  });

  it('uses the same rank icon URLs as the stream overlays', () => {
    assert.equal(
      getRankIconUrl('Diamond 1'),
      'https://www.thefinals.wiki/w/images/2/2c/League_Diamond_1.png',
    );
    assert.equal(
      getRankIconUrl('Ruby'),
      'https://www.thefinals.wiki/w/images/8/81/League_Ruby.png',
    );
    assert.equal(
      getRankIconUrl('Something unexpected'),
      'https://www.thefinals.wiki/w/images/d/d4/League_Unranked.png',
    );
  });

  it('patches only the configured owner identity and keeps the token out of the payload', async () => {
    const requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const sync = createOwnerWidgetSync(
      {
        applicationId: 'app-123',
        ownerUserId: 'owner-456',
        botToken: 'secret-token',
        channel: 'antiparty',
        identityId: '0',
      },
      {
        loadStats: async (channel) => {
          assert.equal(channel, 'antiparty');
          return stats;
        },
        patch: async (url, body, options) => {
          requests.push({ url, body, headers: options.headers });
        },
      },
    );

    const result = await sync();

    assert.deepEqual(result, { ok: true });
    assert.equal(
      requests[0].url,
      'https://discord.com/api/v9/applications/app-123/users/owner-456/identities/0/profile',
    );
    assert.equal(requests[0].headers.Authorization, 'Bot secret-token');
    assert.equal(JSON.stringify(requests[0].body).includes('secret-token'), false);
  });
});
