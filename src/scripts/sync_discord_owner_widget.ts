import 'dotenv/config';
import { dbReady } from '@/db';
import {
  readOwnerWidgetConfig,
  syncConfiguredOwnerWidget,
} from '@/services/discordOwnerWidget.service';

async function main(): Promise<void> {
  await dbReady;

  const config = readOwnerWidgetConfig();
  if (!config) {
    console.error(
      '[discord-owner-widget] Configure DISCORD_WIDGET_APPLICATION_ID, '
      + 'DISCORD_WIDGET_OWNER_USER_ID, and DISCORD_WIDGET_BOT_TOKEN first.',
    );
    process.exit(1);
  }

  const result = await syncConfiguredOwnerWidget();
  if (!result.ok) {
    console.error(`[discord-owner-widget] Sync failed: ${result.reason}`);
    process.exit(1);
  }

  console.log(
    `[discord-owner-widget] Synced ${config.channel} to Discord owner ${config.ownerUserId}.`,
  );
}

main().catch((error: any) => {
  console.error('[discord-owner-widget] Failed:', error?.message || String(error));
  process.exit(1);
});
