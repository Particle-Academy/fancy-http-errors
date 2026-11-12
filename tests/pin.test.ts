import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { conformanceRoot, PINNED_SUITE_VERSION, versionOnDisk } from "./conformance-root";

const repo = join(import.meta.dirname, "..");
const lf = (path: string) => readFileSync(path, "latin1").split("\r\n").join("\n");
const sha = (path: string) => createHash("sha256").update(lf(path), "latin1").digest("hex");

describe("the conformance pin", () => {
  it("the checkout on disk is the pinned version", () => {
    expect(versionOnDisk()).toBe(PINNED_SUITE_VERSION);
  });

  it("CI checks out the tag this suite pins, never main", () => {
    const ci = readFileSync(join(repo, ".github", "workflows", "ci.yml"), "utf8");
    const refs = [...ci.matchAll(/repository: Particle-Academy\/fancy-conformance\s+ref: (\S+)/g)].map((m) => m[1]);
    expect(refs).toEqual([`v${PINNED_SUITE_VERSION}`]);
  });
});

describe("the shipped schema", () => {
  it("is a byte copy of the contract's envelope.schema.json", () => {
    // LF-normalised: this estate checks out with core.autocrlf=true, and a
    // CRLF copy of the same schema is the same schema.
    const ours = sha(join(repo, "envelope.schema.json"));
    const theirs = sha(join(conformanceRoot(), "suites", "http", "error-envelope", "envelope.schema.json"));
    expect(ours).toBe(theirs);
  });

  it("is in the published files and exported", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.files).toContain("envelope.schema.json");
    expect(pkg.exports["./envelope.schema.json"]).toBe("./envelope.schema.json");
  });

  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });
});
