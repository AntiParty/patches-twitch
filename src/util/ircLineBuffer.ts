// TCP chunks don't line up with IRC lines: a busy channel regularly delivers a
// PRIVMSG split across two `data` events. Hold the trailing partial line until
// the rest arrives so it isn't dropped or parsed as two broken messages.
const MAX_PARTIAL_LINE = 64 * 1024;

export function createIrcLineBuffer() {
  let pending = '';
  return (chunk: string): string[] => {
    pending += chunk;
    const lines = pending.split('\r\n');
    pending = lines.pop() ?? '';
    // A peer that never sends CRLF shouldn't grow this without bound.
    if (pending.length > MAX_PARTIAL_LINE) pending = '';
    return lines.filter(Boolean);
  };
}
