# @particle-academy/fancy-http-errors

Turn **any** HTTP error response into one safe sentence for the UI.

```ts
import { normaliseResponse, normaliseFailure } from "@particle-academy/fancy-http-errors";

try {
  const res = await fetch("/api/invites", { method: "POST", body });
  const error = await normaliseResponse(res); // null on a 2xx/3xx
  if (error) {
    toast(error.sentence);          // "This request is 12.4 MB, over this endpoint's limit of 10 MB."
    form.setErrors(error.fields);   // { "items.3.price": "This must be a finite number." }
  }
} catch (e) {
  toast(normaliseFailure(e).sentence); // "We could not reach the server. ..."
}
```

It reads the **Fancy error envelope** (from `particle-academy/fancy-http-guard`
for Laravel and `fancy-http-guard` for FastAPI/Starlette), and also what servers
send without it:

| Server sent | You get |
|---|---|
| `{error, message, field?, errors?, limit?, retryAfter?, requestId}` | the code, the sentence, the fields |
| FastAPI `{"detail": "..."}` | that sentence |
| FastAPI `{"detail": [{loc, msg}]}` (422) | dotted `fields`, "2 fields need attention." |
| Laravel `{"message", "errors": {field: [...]}}` | the first message per field |
| an nginx/Cloudflare HTML page, plain text, nothing | the sentence for the status |
| `Retry-After: 30` or an HTTP-date | `retryAfter` and "Try again in 30 seconds." |

<!-- fancy-agents-note:start -->
> **For agents.** This package is not listed on the Fancy MCP catalog server
> yet. The server, `https://ui.particle.academy/mcp` (streamable HTTP, no API key; MCP id
> `fancy-ui`), lists the released Fancy packages with install commands and
> docs. How an agent installs and uses this package is in [AGENTS.md](https://github.com/Particle-Academy/fancy-http-errors/blob/main/AGENTS.md).
<!-- fancy-agents-note:end -->

## What it will never do

- **Show server text on a 5xx.** A Laravel app with `APP_DEBUG=true` answers a
  crash with the SQL error and a stack trace. You get "Something went wrong on
  our side. If it keeps happening, quote reference 4f8c2a9e-…" instead, and
  `fields` is empty.
- **Read an unbounded body.** It reads at most 64 KiB and cancels the rest.
- **Give you HTML.** The sentence is text: render it as text.

## Result

```ts
interface HttpError {
  status: number;                    // 0 = no response
  code: string;                      // "body_too_large", "validation_failed", an app's own code ...
  sentence: string;                  // one plain sentence, at most maxMessageLength (300) code points
  fields: Record<string, string>;    // dotted path -> message; {} on a 5xx
  retryAfter: number | null;         // seconds
  requestId: string | null;          // for a support ticket
}
```

## Options (every limit is a setting)

```ts
normalise(input, {
  maxBodyBytes: 65536,
  maxDepth: 64,
  maxMessageLength: 300,
  requestIdHeader: "x-request-id",
  messages: {                                   // the translation seam
    not_found: "No encontrado.",
    rate_limited: (c) => `Zu viele Anfragen. ${c.retryAfter ?? ""}`,
  },
});
```

`maxMessageLength` stays 300 by default. A Fancy server may send up to 4,000
code points when its app raises the guard's `maxMessageLength` (CC-fancy-0063);
this client still cuts at its own option, so a consumer that wants those
messages whole raises it: `normalise(input, { maxMessageLength: 4000 })`. The
message is cleaned the same way at any length.

`normalise({status, headers, body, now?})` takes a response you have already
read. `formatBytes`, `formatDuration` and `sanitise` are the shared sentence
helpers, and `@particle-academy/fancy-http-errors/envelope.schema.json` is the
envelope's JSON Schema.

## Contract

The rules are fancy-conformance `suites/http/SPEC.md`, and this package runs
its `http/error-envelope` table in CI, as does the Laravel normaliser. Zero
runtime dependencies. MIT.
