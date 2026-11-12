/**
 * @particle-academy/fancy-http-errors
 *
 * Turns ANY error response into one safe sentence for the UI. The contract is
 * fancy-conformance `suites/http/SPEC.md` (CC-fancy-0031), sections 2 and 6,
 * and this package runs its `http/error-envelope` table in CI.
 *
 * Two rules that are the reason it exists:
 *
 *   - **A 5xx never shows server text.** Not the message, not a field, not in
 *     any shape. Laravel with APP_DEBUG=true answers a crash with the SQL error
 *     and a stack trace; a misconfigured proxy can do the same.
 *   - **Every input is bounded.** The body is read to a byte cap and then
 *     cancelled, nesting is capped, messages are cleaned and capped, and no
 *     regular expression ever touches the body. It handles text it did not
 *     author, from servers nobody here wrote.
 */

export interface HttpErrorInput {
  /** The HTTP status; 0 for no response at all. */
  status: number;
  /** Response headers; names are matched case-insensitively. */
  headers?: Record<string, string> | Headers;
  /** The response body as text, or null. */
  body?: string | null;
  /** The clock, for an HTTP-date Retry-After. Omit it and a date gives null. */
  now?: string | number | Date;
}

export interface HttpError {
  status: number;
  /** A snake_case code: the envelope's own, or one derived from the status. */
  code: string;
  /** One plain sentence, safe to show a person as TEXT (never as HTML). */
  sentence: string;
  /** Field path (dotted, as Inertia's flat errors) to one message. Empty on a 5xx. */
  fields: Record<string, string>;
  /** Seconds to wait before retrying, when the server said. */
  retryAfter: number | null;
  /** The server's request id, for a support ticket. */
  requestId: string | null;
}

/** What a `messages` override receives. Never the raw body, and on a 5xx never server text. */
export interface SentenceContext {
  status: number;
  code: string;
  fields: Record<string, string>;
  retryAfter: number | null;
  requestId: string | null;
  limit: { name: string; max: number; actual?: number } | null;
  /** The sentence this package would show. */
  sentence: string;
}

export interface NormaliseOptions {
  /** Override a code's sentence: a string, or a function of the parts (the i18n seam). */
  messages?: Partial<Record<string, string | ((context: SentenceContext) => string)>>;
  /** Bytes of body read before it is treated as unrecognised. Default 65536. */
  maxBodyBytes?: number;
  /** Nesting accepted in a JSON body. Default 64. */
  maxDepth?: number;
  /** Code points in one sentence or field message. Default 300. */
  maxMessageLength?: number;
  /** The request-id header. Default `x-request-id`. */
  requestIdHeader?: string;
}

export const DEFAULTS = {
  maxBodyBytes: 65536,
  maxDepth: 64,
  maxMessageLength: 300,
  requestIdHeader: "x-request-id",
} as const;

const CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RID = /^[A-Za-z0-9._:-]{1,128}$/;

type J = unknown;
type Obj = Record<string, J>;
const isObj = (x: J): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const isCount = (x: J): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

// ---------------------------------------------------------------------------
// Shared sentence helpers (SPEC section 2). The PHP and Python guards write
// their envelopes with the same rules, pinned by the same rows.
// ---------------------------------------------------------------------------

/** `1048576` -> `"1,048,576"`. */
export function formatCount(n: number): string {
  const s = String(Math.trunc(n));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ",";
    out += s[i];
  }
  return out;
}

const UNITS: ReadonlyArray<readonly [number, string]> = [
  [1024 ** 3, "GB"],
  [1024 ** 2, "MB"],
  [1024, "KB"],
];

/**
 * A byte count for a person: `1,023 bytes`, `1.3 KB`, `12.4 MB`. Tenths are
 * rounded in INTEGER arithmetic, half up, so every runtime agrees on an exact
 * half; `toFixed` and Python's `round` do not.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return n === 1 ? "1 byte" : `${formatCount(n)} bytes`;
  const [unit, name] = UNITS.find(([size]) => size <= n)!;
  const tenths = Math.floor((n * 10 + Math.floor(unit / 2)) / unit);
  const frac = tenths % 10;
  return `${formatCount(Math.floor(tenths / 10))}${frac ? `.${frac}` : ""} ${name}`;
}

/** The retry clause, without its leading space. Minutes and hours round UP. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Try again now.";
  const unit = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? "" : "s"}`;
  if (seconds < 60) return `Try again in ${unit(seconds, "second")}.`;
  if (seconds < 3600) return `Try again in ${unit(Math.ceil(seconds / 60), "minute")}.`;
  return `Try again in ${unit(Math.ceil(seconds / 3600), "hour")}.`;
}

/**
 * Controls become spaces, runs of spaces collapse, the ends trim, and anything
 * over `max` CODE POINTS keeps `max - 1` and gains an ellipsis.
 */
export function sanitise(text: string, max: number = DEFAULTS.maxMessageLength): string {
  let out = "";
  let space = true; // drops leading spaces and collapses runs in one pass
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isSpace = cp === 0x20 || cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
    if (isSpace) {
      if (!space) out += " ";
      space = true;
    } else {
      out += ch;
      space = false;
    }
  }
  if (out.endsWith(" ")) out = out.slice(0, -1);
  const points = Array.from(out);
  return points.length > max ? points.slice(0, Math.max(0, max - 1)).join("") + "…" : out;
}

const STATUS: Readonly<Record<number, readonly [string, string]>> = {
  0: ["network_error", "We could not reach the server. Check your connection and try again."],
  400: ["bad_request", "The request could not be understood."],
  401: ["unauthenticated", "Please sign in to continue."],
  403: ["forbidden", "You do not have permission to do that."],
  404: ["not_found", "That could not be found."],
  405: ["method_not_allowed", "That action is not allowed here."],
  408: ["request_timeout", "The request took too long. Please try again."],
  409: ["conflict", "This conflicts with a change made elsewhere. Reload and try again."],
  410: ["gone", "This is no longer available."],
  413: ["body_too_large", "This request is too large for the server."],
  415: ["unsupported_media_type", "That type of content is not accepted here."],
  422: ["validation_failed", "Some fields need attention."],
  429: ["rate_limited", "Too many requests."],
  500: ["server_error", "Something went wrong on our side."],
  502: ["upstream_error", "A service this depends on did not respond."],
  503: ["unavailable", "The service is unavailable right now."],
  504: ["upstream_error", "A service this depends on did not respond."],
};

/** The code and default sentence for a status (SPEC 2.1). */
export function statusDefaults(status: number): readonly [code: string, sentence: string] {
  return STATUS[status] ?? (status >= 500 ? STATUS[500]! : ["client_error", "The request could not be completed."]);
}

function serverSentence(status: number, retryAfter: number | null, requestId: string | null): string {
  let s = statusDefaults(status)[1];
  if (retryAfter !== null) s += " " + formatDuration(retryAfter);
  if (requestId !== null && status !== 0) s += ` If it keeps happening, quote reference ${requestId}.`;
  return s;
}

type Limit = { name: string; max: number; actual?: number };
const asLimit = (l: J): Limit | null =>
  isObj(l) && typeof l.name === "string" && isCount(l.max) && (l.actual === undefined || isCount(l.actual))
    ? (l as Limit)
    : null;

function bodyTooLarge(l: Limit): string {
  return l.actual === undefined
    ? `This request is over this endpoint's limit of ${formatBytes(l.max)}.`
    : `This request is ${formatBytes(l.actual)}, over this endpoint's limit of ${formatBytes(l.max)}.`;
}

/** The sentence for a holy-sheet refusal (SPEC 2.2). */
export function workbookSentence(l: Limit): string {
  const { name, max, actual } = l;
  if (name === "maxCompressionRatio") return "This spreadsheet is compressed too tightly to open safely.";
  if (actual === undefined) return "This spreadsheet is too large to open here.";
  const c = formatCount;
  const b = formatBytes;
  switch (name) {
    case "maxRows":
      return `This spreadsheet has ${c(actual)} rows, over the limit of ${c(max)}.`;
    case "maxColumns":
      return `This spreadsheet has ${c(actual)} columns, over the limit of ${c(max)}.`;
    case "maxCells":
      return `This spreadsheet has at least ${c(actual)} cells, over the limit of ${c(max)}.`;
    case "maxSharedStrings":
      return `This spreadsheet has ${c(actual)} shared strings, over the limit of ${c(max)}.`;
    case "maxEntries":
      return `This spreadsheet has ${c(actual)} parts, over the limit of ${c(max)}.`;
    case "maxArchiveBytes":
      return `This spreadsheet is ${b(actual)}, over the limit of ${b(max)}.`;
    case "maxPartBytes":
    case "maxExpandedBytes":
      return `This spreadsheet needs at least ${b(actual)} to open, over the limit of ${b(max)}.`;
    default:
      return "This spreadsheet is too large to open here.";
  }
}

// ---------------------------------------------------------------------------
// The normaliser (SPEC section 6)
// ---------------------------------------------------------------------------

function headerOf(headers: HttpErrorInput["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  const want = name.toLowerCase();
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(want) ?? undefined;
  for (const [k, v] of Object.entries(headers as Record<string, string>)) if (k.toLowerCase() === want) return v;
  return undefined;
}

/** Every string well-formed (no lone surrogate) and nesting within maxDepth; iterative. */
function acceptable(value: J, maxDepth: number): boolean {
  const stack: Array<[J, number]> = [[value, 1]];
  while (stack.length) {
    const [x, depth] = stack.pop()!;
    if (typeof x === "string") {
      if (!x.isWellFormed()) return false;
      continue;
    }
    if (typeof x !== "object" || x === null) continue;
    if (depth > maxDepth) return false;
    if (Array.isArray(x)) for (const e of x) stack.push([e, depth + 1]);
    else
      for (const [k, e] of Object.entries(x)) {
        if (!k.isWellFormed()) return false;
        stack.push([e, depth + 1]);
      }
  }
  return true;
}

const OVERSIZE = Symbol("oversize");

function readBody(body: string | null | undefined | typeof OVERSIZE, o: Required<Omit<NormaliseOptions, "messages">>): Obj | null {
  if (body === OVERSIZE || body === null || body === undefined || body === "") return null;
  if (new TextEncoder().encode(body).length > o.maxBodyBytes) return null;
  let v: J;
  try {
    v = JSON.parse(body);
  } catch {
    return null; // includes a RangeError from nesting too deep for the engine
  }
  return isObj(v) && acceptable(v, o.maxDepth) ? v : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Applied to a HEADER only (bounded, and anchored with no nested quantifiers).
const IMF_FIXDATE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;

function retryAfterFrom(header: string | undefined, now: HttpErrorInput["now"]): number | null {
  if (header === undefined || header.length > 64) return null;
  const t = header.trim();
  if (/^[0-9]{1,10}$/.test(t)) return Number(t);
  const d = IMF_FIXDATE.exec(t);
  if (!d || now === undefined) return null;
  const at = Date.UTC(Number(d[3]), MONTHS.indexOf(d[2]!), Number(d[1]), Number(d[4]), Number(d[5]), Number(d[6]));
  const clock = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(at) || !Number.isFinite(clock)) return null;
  return Math.max(0, Math.ceil((at - clock) / 1000));
}

function resolved(options: NormaliseOptions): Required<Omit<NormaliseOptions, "messages">> {
  return {
    maxBodyBytes: options.maxBodyBytes ?? DEFAULTS.maxBodyBytes,
    maxDepth: options.maxDepth ?? DEFAULTS.maxDepth,
    maxMessageLength: options.maxMessageLength ?? DEFAULTS.maxMessageLength,
    requestIdHeader: options.requestIdHeader ?? DEFAULTS.requestIdHeader,
  };
}

function normaliseWith(input: Omit<HttpErrorInput, "body"> & { body?: string | null | typeof OVERSIZE }, options: NormaliseOptions): HttpError | null {
  const o = resolved(options);
  const status = input.status;
  if (status >= 100 && status < 400) return null;
  const serverSide = status === 0 || status >= 500;
  const b = readBody(input.body, o);
  const clean = (s: string) => sanitise(s, o.maxMessageLength);

  let requestId: string | null = null;
  const hid = headerOf(input.headers, o.requestIdHeader);
  if (hid !== undefined && RID.test(hid)) requestId = hid;
  else if (b && typeof b.requestId === "string" && RID.test(b.requestId)) requestId = b.requestId;

  let retryAfter = retryAfterFrom(headerOf(input.headers, "retry-after"), input.now);
  if (retryAfter === null && b && isCount(b.retryAfter) && b.retryAfter <= 2147483647) retryAfter = b.retryAfter;

  let code = statusDefaults(status)[0];
  let serverMessage: string | null = null;
  let items = 0;
  let firstItem: string | null = null;
  let limit: Limit | null = null;
  // Built as entries and turned into an object at the end: assigning a body's
  // key into a plain object lets `__proto__` set the prototype instead.
  const entries = new Map<string, string>();
  const put = (field: string, message: string) => {
    if (!entries.has(field)) entries.set(field, clean(message));
  };
  const clientSide = status >= 400 && status < 500;

  if (b && typeof b.error === "string" && CODE.test(b.error) && typeof b.message === "string") {
    code = b.error;
    serverMessage = b.message;
    limit = asLimit(b.limit);
    if (Array.isArray(b.errors)) {
      for (const it of b.errors) {
        if (!isObj(it) || typeof it.message !== "string") continue;
        items++;
        firstItem ??= it.message;
        if (typeof it.field === "string") put(it.field, it.message);
      }
    }
    if (typeof b.field === "string") put(b.field, b.message);
  } else if (
    b &&
    Array.isArray(b.detail) &&
    b.detail.length > 0 &&
    b.detail.every((d) => isObj(d) && Array.isArray(d.loc) && typeof d.msg === "string")
  ) {
    if (clientSide) code = "validation_failed";
    for (const d of b.detail as Array<{ loc: J[]; msg: string }>) {
      items++;
      firstItem ??= d.msg;
      const loc = [...d.loc];
      if (typeof loc[0] === "string" && ["body", "query", "path", "header", "cookie"].includes(loc[0])) loc.shift();
      const path = loc.map(String).join(".");
      if (path !== "") put(path, d.msg);
    }
  } else if (b && typeof b.detail === "string") {
    serverMessage = b.detail;
  } else if (b && isObj(b.errors) && Object.values(b.errors).every((v) => typeof v === "string" || Array.isArray(v))) {
    if (clientSide) code = "validation_failed";
    for (const [field, v] of Object.entries(b.errors)) {
      const first = typeof v === "string" ? v : (v as J[]).find((x): x is string => typeof x === "string");
      if (first === undefined) continue;
      items++;
      firstItem ??= first;
      put(field, first);
    }
    if (typeof b.message === "string") serverMessage = b.message;
  } else if (b && typeof b.message === "string") {
    serverMessage = b.message;
  }

  let sentence: string;
  if (serverSide) {
    sentence = serverSentence(status, retryAfter, requestId);
  } else if (code === "validation_failed" && items > 0) {
    sentence = items === 1 ? clean(entries.values().next().value ?? firstItem ?? "") : `${items} fields need attention.`;
    if (sentence === "") sentence = statusDefaults(422)[1];
  } else if (code === "rate_limited" || status === 429) {
    sentence = "Too many requests. " + (retryAfter === null ? "Try again shortly." : formatDuration(retryAfter));
  } else if (code === "body_too_large" && limit) {
    sentence = bodyTooLarge(limit);
  } else if (code === "workbook_too_large" && limit) {
    sentence = workbookSentence(limit);
  } else {
    const s = serverMessage === null ? "" : clean(serverMessage);
    sentence = s || statusDefaults(status)[1];
  }

  const fields: Record<string, string> = serverSide ? {} : Object.fromEntries(entries);
  const override = options.messages?.[code];
  if (override !== undefined) {
    const context: SentenceContext = { status, code, fields: { ...fields }, retryAfter, requestId, limit: serverSide ? null : limit, sentence };
    const text = typeof override === "function" ? override(context) : override;
    if (typeof text === "string" && text !== "") sentence = text;
  }

  return { status, code, sentence, fields, retryAfter, requestId };
}

/** An error response, already read, as one sentence. `null` for a status under 400. */
export function normalise(input: HttpErrorInput, options: NormaliseOptions = {}): HttpError | null {
  return normaliseWith(input, options);
}

/**
 * A `fetch` Response as one sentence. The body is read only for an error
 * status, and only to `maxBodyBytes`: the reader is cancelled the moment the
 * cap is passed, so an endless or enormous body costs at most one chunk more.
 */
export async function normaliseResponse(response: Response, options: NormaliseOptions = {}): Promise<HttpError | null> {
  if (response.status >= 100 && response.status < 400) return null;
  const cap = resolved(options).maxBodyBytes;
  let body: string | null | typeof OVERSIZE = null;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > cap) {
          body = OVERSIZE;
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    } catch {
      body = OVERSIZE; // a body that failed mid-read is not one to trust
    }
    if (body !== OVERSIZE) {
      const all = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
      }
      body = new TextDecoder("utf-8").decode(all);
    }
  }
  return normaliseWith({ status: response.status, headers: response.headers, body }, options);
}

/**
 * No response at all: `fetch` threw (offline, DNS, CORS, aborted). The error's
 * own text is never shown.
 */
export function normaliseFailure(_error?: unknown, options: NormaliseOptions = {}): HttpError {
  return normaliseWith({ status: 0, headers: {}, body: null }, options)!;
}
