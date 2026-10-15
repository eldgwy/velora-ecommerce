import { describe, it, expect } from "vitest";

import {
  GUEST_STORAGE_KEY,
  HISTORY_LIMIT,
  parseGuestHistory,
  prependGuestView,
} from "@/modules/recently-viewed/domain/history-rules";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("guest history parsing", () => {
  it("accepts well-formed entries newest-first", () => {
    const parsed = parseGuestHistory([
      { id: ID_A, at: 100 },
      { id: ID_B, at: 300 },
    ]);
    expect(parsed).toEqual([
      { id: ID_B, at: 300 },
      { id: ID_A, at: 100 },
    ]);
  });

  it("drops malformed rows, dedupes, bounds, and never throws", () => {
    expect(parseGuestHistory(null)).toEqual([]);
    expect(parseGuestHistory("garbage")).toEqual([]);
    expect(
      parseGuestHistory([
        { id: ID_A, at: 50 },
        { id: ID_A, at: 200 },
        { id: "not-a-uuid", at: 999 },
        { id: 123, at: 1 },
        null,
        "x",
      ]),
    ).toEqual([{ id: ID_A, at: 200 }]);

    const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
      id: `0000000${i}-0000-4000-8000-00000000000${i % 10}`,
      at: i,
    }));
    expect(parseGuestHistory(many)).toHaveLength(HISTORY_LIMIT);
  });

  it("prepends views with refresh and cap", () => {
    const next = prependGuestView([{ id: ID_A, at: 1 }], ID_B, 2);
    expect(next.map((e) => e.id)).toEqual([ID_B, ID_A]);
    const refreshed = prependGuestView(next, ID_A, 3);
    expect(refreshed.map((e) => e.id)).toEqual([ID_A, ID_B]);
    expect(refreshed[0]!.at).toBe(3);
    expect(prependGuestView([{ id: ID_A, at: 1 }], "bad-id!", 2)).toHaveLength(1);
  });

  it("pins the storage contract", () => {
    expect(GUEST_STORAGE_KEY).toBe("velora_recently_viewed");
    expect(HISTORY_LIMIT).toBe(20);
  });
});
