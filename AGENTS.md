# AGENTS.md — fancy-http-errors

Turns any HTTP error response into one safe sentence for the UI. `CLAUDE.md` is
a symlink to this file. Process rules (publishing, versions, third-party code)
live in the envelope's `RULES.md` and are not repeated here.

## The contract

fancy-conformance `suites/http/SPEC.md` (CC-fancy-0031), sections 2 and 6, and
the `http/error-envelope` table this package runs in `tests/conformance.test.ts`.
The Laravel HTTP-client normaliser in `particle-academy/fancy-http-guard` runs
the same rows; the PHP and Python guards write their envelopes with the same
sentence rules. **Change behaviour in the spec and its rows first**, never here
alone: a sentence that differs between the server that wrote it and the client
that read it is the drift this exists to prevent.

`envelope.schema.json` is a byte copy of the contract's schema, pinned by
sha256 (LF-normalised) in `tests/pin.test.ts`. Never edit it here.

## Invariants (each has a test)

- **A 5xx never shows server text**: not the message, not a field, not in any of
  the five recognised shapes, and not through a `messages` override's context.
  `fields` is `{}` on status 0 and every 5xx.
- **Bounded input.** `normaliseResponse` reads at most `maxBodyBytes` and then
  CANCELS the stream; nesting over `maxDepth` and lone surrogates are
  unrecognised; messages are cleaned and capped by code points. No regex runs
  on the body (the one regex on a header is anchored and bounded).
- **Fields are built as entries**, then `Object.fromEntries`. Assigning a body's
  key into a plain object lets `__proto__` set the prototype.
- **Every limit is an option** (`maxBodyBytes`, `maxDepth`, `maxMessageLength`,
  `requestIdHeader`), with the spec's values as defaults.
- **Zero runtime dependencies**, no React. A test fails if `dependencies` or
  `peerDependencies` gains anything.

## Testing

```bash
npm test          # vitest: the conformance table + hostile cases
npm run lint      # tsc --noEmit
npm run build
```

The table is read from a fancy-conformance CHECKOUT, not from npm:
`FANCY_CONFORMANCE_ROOT` in CI (checked out at `ref: v<PINNED_SUITE_VERSION>`),
else the envelope's sibling `../fancy-conformance`. The loader used is the one
in that checkout, never a copy. A missing checkout fails the run. Move the pin
in `tests/conformance-root.ts` and the ref in `ci.yml` together, after re-running
the table against the new checkout.
