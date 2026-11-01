import type { InboundChatMessage } from './inboundChatMessage';
import { stripInvisibleChars } from '../util/chatText';

/**
 * Convert an EventSub channel.chat.message event into the IRC-shaped message
 * the shared dispatcher accepts. Pure: no I/O. Returns null for shared-chat
 * messages that originated in another room.
 */
export function toInboundChatMessage(
  event: any,
  messageTimestamp: string
): InboundChatMessage | null {
  const source = event.source_broadcaster_user_id;
  if (source != null && source !== event.broadcaster_user_id) return null;

  const sets = new Set<string>((event.badges ?? []).map((b: any) => b.set_id));
  const badges = (event.badges ?? []).map((b: any) => `${b.set_id}/${b.id}`).join(',');

  const tags: Record<string, any> = {
    id: event.message_id,
    'message-id': event.message_id,
    'display-name': event.chatter_user_name,
    username: event.chatter_user_login,
    'user-id': event.chatter_user_id,
    'room-id': event.broadcaster_user_id,
    badges,
    mod: sets.has('moderator') ? '1' : '0',
    subscriber: sets.has('subscriber') || sets.has('founder') ? '1' : '0',
    color: event.color || '',
    'tmi-sent-ts': String(Date.parse(messageTimestamp)),
  };
  if (source != null) tags['source-room-id'] = source;

  return {
    channel: event.broadcaster_user_login,
    broadcasterId: event.broadcaster_user_id,
    user: event.chatter_user_login,
    text: stripInvisibleChars(event.message?.text ?? ''),
    tags,
    transport: 'eventsub',
  };
}
