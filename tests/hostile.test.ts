import { describe, expect, it } from "vitest";

import { normalise, normaliseFailure, normaliseResponse } from "../src/index";

/**
 * Hostile input. The normaliser handles text it did not author, from servers
 * nobody here wrote, and it is published: consumer-reachable by definition.
 * Each test here names the thing a port would plausibly get wrong.
 */

const CANARY = "SQLSTATE[42S02] users@10.0.0.4 /var/www/app/.env";

describe("a 5xx never shows server text, in any shape", () => {
  const shapes: Array<[string, unknown]> = [
    ["envelope message", { error: "server_error", message: CANARY, requestId: "r-1" }],
    ["envelope errors", { error: "server_error", message: "x", errors: [{ error: "e", message: CANARY, field: "a" }], requestId: "r-1" }],
    ["detail sentence", { detail: CANARY }],
    ["FastAPI list", { detail: [{ loc: ["body", "a"], msg: CANARY, type: "x" }] }],
    ["Laravel message + trace", { message: CANARY, exception: "QueryException", trace: [{ file: CANARY }] }],
    ["Laravel field map", { message: "x", errors: { a: [CANARY] } }],
    ["public-looking app code", { error: "maintenance", message: CANARY, requestId: "r-1" }],
  ];
  for (const status of [500, 501, 502, 503, 504, 507, 599]) {
    for (const [name, body] of shapes) {
      it(`${status} ${name}`, () => {
        const r = normalise({ status, headers: {}, body: JSON.stringify(body) });
        expect(JSON.stringify(r)).not.toContain("SQLSTATE");
        expect(JSON.stringify(r)).not.toContain("10.0.0.4");
        expect(r!.fields).toEqual({});
      });
    }
  }

  it("a plain-text 500 body is not shown", () => {
    const r = normalise({ status: 500, headers: {}, body: CANARY });
    expect(r!.sentence).toBe("Something went wrong on our side.");
  });
});

describe("bounded reading", () => {
  /** An endless body that counts every byte the reader pulls. */
  function endless(chunk = 4096) {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk;
        controller.enqueue(new Uint8Array(chunk).fill(0x61));
      },
      cancel() {
        cancelled = true;
      },
    });
    return { stream, pulled: () => pulled, cancelled: () => cancelled };
  }

  it("stops reading an endless body just past the cap, and cancels it", async () => {
    const body = endless();
    const res = new Response(body.stream, { status: 400 });
    const r = await normaliseResponse(res);
    expect(r!.sentence).toBe("The request could not be understood.");
    expect(body.pulled()).toBeLessThanOrEqual(65536 + 4096 * 2);
    expect(body.cancelled()).toBe(true);
  });

  it("the cap is a setting", async () => {
    const body = endless(256);
    const r = await normaliseResponse(new Response(body.stream, { status: 400 }), { maxBodyBytes: 1024 });
    expect(r!.code).toBe("bad_request");
    expect(body.pulled()).toBeLessThanOrEqual(1024 + 256 * 2);
  });

  it("a body under the cap is read whole", async () => {
    const res = new Response(JSON.stringify({ detail: "Gone for good." }), { status: 410 });
    expect((await normaliseResponse(res))!.sentence).toBe("Gone for good.");
  });

  it("a body with no stream at all", async () => {
    expect((await normaliseResponse(new Response(null, { status: 404 })))!.sentence).toBe("That could not be found.");
  });

  it("a 2xx is null and its body is never read", async () => {
    const body = endless();
    expect(await normaliseResponse(new Response(body.stream, { status: 200 }))).toBeNull();
    expect(body.pulled()).toBeLessThanOrEqual(4096);
  });
});

describe("nesting and encoding bombs", () => {
  it("100,000 open brackets is unrecognised, not a crash", () => {
    const r = normalise({ status: 400, headers: {}, body: "[".repeat(100000) });
    expect(r!.sentence).toBe("The request could not be understood.");
  });

  it("deep but closed nesting beyond the depth cap is unrecognised", () => {
    const body = '{"detail":"Deep.","x":' + "[".repeat(5000) + "]".repeat(5000) + "}";
    expect(normalise({ status: 400, headers: {}, body })!.sentence).toBe("The request could not be understood.");
  });

  it("the depth cap is a setting", () => {
    const body = '{"detail":"Deep.","x":[[[]]]}';
    expect(normalise({ status: 400, headers: {}, body })!.sentence).toBe("Deep.");
    expect(normalise({ status: 400, headers: {}, body }, { maxDepth: 3 })!.sentence).toBe("The request could not be understood.");
  });

  it("a lone surrogate in a KEY is refused too", () => {
    const r = normalise({ status: 422, headers: {}, body: '{"message":"x","errors":{"a\\udc00":["Bad."]}}' });
    expect(r!.fields).toEqual({});
    expect(r!.code).toBe("validation_failed");
    expect(r!.sentence).toBe("Some fields need attention.");
  });
});

describe("prototype safety", () => {
  it("a __proto__ field is an own key and pollutes nothing", () => {
    const r = normalise({ status: 422, headers: {}, body: '{"errors":{"__proto__":["Polluted?"],"constructor":["Also?"]}}' })!;
    expect(Object.prototype.hasOwnProperty.call(r.fields, "__proto__")).toBe(true);
    expect(r.fields["__proto__"]).toBe("Polluted?");
    expect(Object.getPrototypeOf(r.fields)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("message hygiene", () => {
  it("strips controls and caps a 4xx message", () => {
    const r = normalise({ status: 400, headers: {}, body: JSON.stringify({ detail: "a\u0000b\u001b[31mc" + "z".repeat(500) }) })!;
    expect(r.sentence).not.toMatch(/[\u0000-\u001f]/);
    expect(Array.from(r.sentence).length).toBe(300);
  });

  it("maxMessageLength is a setting", () => {
    const r = normalise({ status: 400, headers: {}, body: JSON.stringify({ detail: "abcdefghij" }) }, { maxMessageLength: 5 })!;
    expect(r.sentence).toBe("abcd…");
  });

  it("markup is returned as text, never interpreted", () => {
    const r = normalise({ status: 400, headers: {}, body: JSON.stringify({ detail: "<img src=x onerror=alert(1)>" }) })!;
    expect(r.sentence).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("headers", () => {
  it("are matched case-insensitively", () => {
    const r = normalise({ status: 429, headers: { "Retry-After": "30", "X-Request-ID": "abc" }, body: null })!;
    expect(r.retryAfter).toBe(30);
    expect(r.requestId).toBe("abc");
  });

  it("the request-id header name is a setting", () => {
    const r = normalise({ status: 410, headers: { "x-correlation-id": "c-1" }, body: null }, { requestIdHeader: "X-Correlation-Id" })!;
    expect(r.requestId).toBe("c-1");
  });

  it("a Headers object works through normaliseResponse", async () => {
    const res = new Response("", { status: 503, headers: { "retry-after": "120", "x-request-id": "r-9" } });
    expect((await normaliseResponse(res))!.sentence).toBe(
      "The service is unavailable right now. Try again in 2 minutes. If it keeps happening, quote reference r-9.",
    );
  });
});

describe("messages override (the i18n seam)", () => {
  it("replaces a code's sentence with a string", () => {
    const r = normalise({ status: 404, headers: {}, body: null }, { messages: { not_found: "No encontrado." } })!;
    expect(r.sentence).toBe("No encontrado.");
  });

  it("a function gets the parts, never the raw body", () => {
    const r = normalise(
      { status: 429, headers: { "retry-after": "30" }, body: '{"message":"Too Many Attempts."}' },
      { messages: { rate_limited: (c) => `Zu viele Anfragen (${c.retryAfter}s).` } },
    )!;
    expect(r.sentence).toBe("Zu viele Anfragen (30s).");
  });

  it("a 5xx override still cannot see server text", () => {
    let seen: unknown;
    normalise(
      { status: 500, headers: {}, body: JSON.stringify({ message: CANARY }) },
      {
        messages: {
          server_error: (c) => {
            seen = c;
            return "Fehler.";
          },
        },
      },
    );
    expect(JSON.stringify(seen)).not.toContain("SQLSTATE");
  });
});

describe("no response at all", () => {
  it("a fetch that threw becomes the network sentence", () => {
    const r = normaliseFailure(new TypeError("fetch failed"));
    expect(r).toEqual({
      status: 0,
      code: "network_error",
      sentence: "We could not reach the server. Check your connection and try again.",
      fields: {},
      retryAfter: null,
      requestId: null,
    });
  });

  it("the error's own text is not shown", () => {
    expect(JSON.stringify(normaliseFailure(new Error(CANARY)))).not.toContain("SQLSTATE");
  });
});
