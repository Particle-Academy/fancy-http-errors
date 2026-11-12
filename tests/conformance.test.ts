import { describe, expect, it } from "vitest";

import { formatBytes, formatDuration, normalise, sanitise } from "../src/index";
import { loader } from "./conformance-root";

/**
 * The shared table every implementation of the contract asserts:
 * fancy-conformance `http/error-envelope`, written from suites/http/SPEC.md.
 * The Laravel HTTP-client normaliser runs the same rows.
 *
 * The summary is printed unconditionally, skips included, because a log that
 * shows only a count cannot be told apart from full coverage.
 */
describe("fancy-conformance http/error-envelope", () => {
  it("passes every row, with no skips for node", async () => {
    const { runTable, formatSummary } = await loader();
    const summary = runTable(
      "http/error-envelope",
      (c) => {
        const input = c.input as Record<string, unknown>;
        switch (c.fn) {
          case "formatBytes":
            return formatBytes(input.n as number);
          case "formatDuration":
            return formatDuration(input.s as number);
          case "sanitise":
            return input.max === undefined ? sanitise(input.text as string) : sanitise(input.text as string, input.max as number);
          case "normalise":
            return normalise(input as never);
        }
        throw new Error(`no runner for ${c.fn}`);
      },
      { language: "node" },
    );
    console.log(formatSummary(summary));
    expect(summary.failed, JSON.stringify(summary.results.filter((r) => r.status === "fail"), null, 1)).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.passed).toBe(82);
  });
});
