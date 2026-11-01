import { axiosConduitHttp, createConduitApi } from './conduitApi';
import { refreshToken } from '../util/twitchUtils';

// Production wiring, kept apart from conduitApi.ts because twitchUtils pulls in the DB.
export const conduitApi = createConduitApi({
  http: axiosConduitHttp,
  get clientId() {
    return process.env.TWITCH_CLIENT_ID || '';
  },
  getAppToken: () => process.env.TWITCH_APP_ACCESS_TOKEN || undefined,
  refreshAppToken: refreshToken,
});
