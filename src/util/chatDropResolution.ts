export interface ChatDropResolution {
  code: string;
  title: string;
  action: string;
}

export function getChatDropResolution(dropReason: any): ChatDropResolution | null {
  const code = String(dropReason?.code || "");
  if (code === "followers_only_mode") {
    return {
      code,
      title: "Chat send blocked by followers-only mode",
      action: "Make finalsrs a moderator/VIP, disable followers-only mode, or have the bot account satisfy the required follow age.",
    };
  }
  return null;
}
