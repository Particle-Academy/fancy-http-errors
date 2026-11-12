import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The fancy-conformance tag these tests are pinned to. CI checks out
 * `ref: v<this>` (.github/workflows/ci.yml), and tests/pin.test.ts fails if the
 * two disagree or if the checkout on disk is a different version.
 *
 * Moving it is a deliberate commit here, never a side effect of someone else's
 * release: re-run the tables against the new checkout FIRST, then move both.
 */
export const PINNED_SUITE_VERSION = "0.48.0";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the fancy-conformance checkout is: FANCY_CONFORMANCE_ROOT in CI, else
 * the sibling checkout in the .agi envelope. A missing checkout is a FAILURE,
 * never a skip -- a skipped table is a green build with no coverage.
 *
 * Read from a checkout rather than installed from npm on purpose: the
 * fixtures are the suite's own alignment tool (internal by owner ruling), and
 * the Python port of this contract reads them the same way.
 */
export function conformanceRoot(): string {
  const root = resolve(process.env.FANCY_CONFORMANCE_ROOT ?? join(here, "..", "..", "fancy-conformance"));
  if (!existsSync(join(root, "suites")) || !existsSync(join(root, "VERSION"))) {
    throw new Error(
      `No fancy-conformance checkout at ${root}. Set FANCY_CONFORMANCE_ROOT, or check it out beside this repository at v${PINNED_SUITE_VERSION}.`,
    );
  }
  return root;
}

export function versionOnDisk(): string {
  return readFileSync(join(conformanceRoot(), "VERSION"), "utf8").trim();
}

/** The loader shipped in the checkout -- the real one, never a copy of it. */
export async function loader(): Promise<typeof import("../../fancy-conformance/src/index")> {
  return import(pathToFileURL(join(conformanceRoot(), "src", "index.ts")).href);
}
