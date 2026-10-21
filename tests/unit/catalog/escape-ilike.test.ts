import { describe, it, expect } from "vitest";

import { escapeILike } from "@/shared/lib/like-patterns";

describe("escapeILike", () => {
  it("escapes LIKE wildcards with a single backslash", () => {
    expect(escapeILike("50%")).toBe("50\\%");
    expect(escapeILike("under_score")).toBe("under\\_score");
    expect(escapeILike("back\\slash")).toBe("back\\\\slash");
  });

  it("treats backslash-bearing input as literal, not as an escape operator", () => {
    // A native backslash must never demote the wildcards that follow it.
    expect(escapeILike("a\\%b")).toBe("a\\\\\\%b");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeILike("silk scarf")).toBe("silk scarf");
    expect(escapeILike("αβγTest-№3 (2024)")).toBe("αβγTest-№3 (2024)");
  });

  it("escapes mixed input exactly once", () => {
    expect(escapeILike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});
