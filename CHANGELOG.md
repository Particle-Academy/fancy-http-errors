# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Pre-1.0, breaking changes land in MINOR releases.** The version number is not
promising otherwise until 1.0.

## [Unreleased]

### Changed

- CI: re-pin org third-party allowlist to 2614224
- Conformance fixtures 0.62.0: the `http/error-envelope` rows are now pinned at fancy-conformance 0.62.0 (was 0.48.0), in the CI checkout ref and `PINNED_SUITE_VERSION`. Test-only; no runtime change, nothing to do.

## [0.1.0] - 2026-11-18

First release (CC-fancy-0031).

### Added

- **`normalise()`, `normaliseResponse()` and `normaliseFailure()`.** Each turns an
  error response, or no response at all, into
  `{status, code, sentence, fields, retryAfter, requestId}`.
  - It reads the Fancy error envelope, FastAPI's `detail` sentence and 422 list,
    Laravel's validation map and `message`, and an HTML or empty body.
  - **A 5xx never shows server text**, and its `fields` are empty.
  - The body is read to a 64 KiB cap and the stream is then cancelled.
- **`messages` option**, to override any code's sentence with a string or a
  function. This is the seam for translation.
- **Every limit is an option:** `maxBodyBytes`, `maxDepth`, `maxMessageLength`
  and `requestIdHeader`.
- **The shared sentence helpers:** `formatBytes`, `formatDuration`, `sanitise`,
  `formatCount`, `statusDefaults` and `workbookSentence`.
- **`envelope.schema.json`**, exported: a byte copy of the contract's schema.
- **Conformance:** passes all 82 rows of fancy-conformance `http/error-envelope`
  (0.48.0).
- Zero runtime dependencies. Test and build tooling (`vitest`, `tsup`,
  `typescript`, `@types/node`) is the estate's standard set.

### Changed

- **CI: the lab-certificate gate verifies against the lab's rotated key list.**
  The lab's first signing key is retired: certificates it already issued still
  verify, and nothing new it signs ever can. Consumers do nothing.

- **Docs:** `AGENTS.md` is now the guide to using this package (install, how to find it on the Fancy MCP catalog server once it is listed, API essentials, traps), and it ships in the package. The contributor notes it held moved to `CONTRIBUTING.md`, and `CLAUDE.md` is now a symlink to it. The README points to the MCP server and to `AGENTS.md`. No code changed; nothing to do.
