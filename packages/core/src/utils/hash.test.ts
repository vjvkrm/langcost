import { describe, expect, it } from "bun:test";

import { sha256 } from "./hash";

describe("sha256", () => {
  it("hashes strings consistently", async () => {
    await expect(sha256("langcost")).resolves.toBe(
      "0c7fc9a7cc4d419926d358ddf875a1a5d42286302c46530f58647db3e1c10fb3"
    );
  });
});
