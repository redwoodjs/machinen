import { describe, expect, it } from "vitest";

import { cmdMove } from "../commands/move.ts";

describe("move command module", () => {
  it("exports the move command handler", () => {
    expect(typeof cmdMove).toBe("function");
  });
});
