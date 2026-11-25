# Using @particle-academy/fancy-http-errors — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

```bash
npm install @particle-academy/fancy-http-errors
```

- **Not published to npm yet** (version `0.1.0` in the repo). The command above
  works once it is.
- Zero runtime dependencies, no React; it runs anywhere `fetch` does.

## Find it on the Fancy MCP server

Not listed on the Fancy MCP catalog server
(`https://ui.particle.academy/mcp`, MCP id `fancy-ui`) yet; it appears there
once published. Look for it later with `search-backend-packages` or
`search-components`. The server-side packages that write the Fancy error
envelope are `particle-academy/fancy-http-guard` (Laravel) and
`fancy-http-guard` (Python, FastAPI / Starlette).

## API essentials

```ts
import { normaliseResponse, normaliseFailure } from "@particle-academy/fancy-http-errors";

const error = await normaliseResponse(res);   // null on a 2xx / 3xx
if (error) {
  toast(error.sentence);
  form.setErrors(error.fields);
}
// fetch() threw (no response at all):
toast(normaliseFailure(e).sentence);
```

- `normaliseResponse(response, options?)` reads a `fetch` `Response`.
  `normalise({ status, headers, body, now? }, options?)` takes one you already
  read. `normaliseFailure(error?, options?)` covers no response (`status: 0`).
- Result `HttpError`: `status`, `code` (`body_too_large`, `validation_failed`,
  an app's own code, ...), `sentence` (at most `maxMessageLength`, 300 by default, code points), `fields`
  (dotted path to message), `retryAfter` (seconds or `null`), `requestId`.
- It recognises the Fancy error envelope, FastAPI `detail` (string or 422 list),
  Laravel `{ message, errors }`, and non-JSON pages, falling back to a sentence
  for the status. `Retry-After` (seconds or an HTTP-date) fills `retryAfter`.
- Options, all with the spec's defaults: `maxBodyBytes` (65536), `maxDepth`
  (64), `maxMessageLength` (300), `requestIdHeader` (`x-request-id`), and
  `messages`, a per-code string or function: the translation seam.
- **Longer server messages:** a Fancy guard whose app raised its
  `maxMessageLength` may send up to 4,000 code points. The default here stays
  300, so pass `{ maxMessageLength: 4000 }` (or what the server allows) to read
  them whole; nothing else about cleaning changes.
- Helpers: `formatBytes`, `formatDuration`, `sanitise`. The envelope's JSON
  Schema is `@particle-academy/fancy-http-errors/envelope.schema.json`.

## Traps

- **Render `sentence` as text, never as HTML.**
- **A 5xx never carries server text**, and its `fields` is `{}` (as on
  status 0). Show the sentence; quote `requestId` for support.
- **The body is read to at most `maxBodyBytes`, then the stream is
  cancelled.**
- A `messages` override for a 5xx code does not receive server text in its
  context either.
