import { describe, expect, it } from "vitest";
import { friendRequestFeedback } from "./socialFeedback";
import type { Social } from "./types";

const player = { playerId: "other", handle: "friend", displayName: "Friend" };
const empty: Social = { incoming: [], outgoing: [], friends: [], blocked: [] };

describe("friend request feedback", () => {
  it("distinguishes an incoming crossed request from a sent request", () => {
    expect(friendRequestFeedback({ ...empty, incoming: [{ requestId: "r", player }] }, "other")).toBe("received");
    expect(friendRequestFeedback({ ...empty, outgoing: [{ requestId: "r", player }] }, "other")).toBe("sent");
    expect(friendRequestFeedback({ ...empty, friends: [player] }, "other")).toBe("friends");
  });
});
