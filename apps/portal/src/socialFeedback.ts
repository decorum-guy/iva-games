import type { Social } from "./types";

/** The server keeps crossed requests pending; never say the recipient sent one. */
export function friendRequestFeedback(
  social: Social,
  playerId: string,
): "received" | "friends" | "sent" {
  if (social.incoming.some((item) => item.player.playerId === playerId))
    return "received";
  if (social.friends.some((item) => item.playerId === playerId)) return "friends";
  return "sent";
}
