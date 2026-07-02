import { describe, expect, it, vi } from "vitest";
import { handleEmail, type Bindings } from "./index";

const SAMPLE_MIME =
  "From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Hello\r\n\r\nBody text.\r\n";

/** Build a mock ForwardableEmailMessage backed by real MIME bytes. */
function mockMessage(
  overrides: Partial<{ to: string; from: string; body: string }> = {},
): ForwardableEmailMessage {
  const body = overrides.body ?? SAMPLE_MIME;
  const bytes = new TextEncoder().encode(body);
  return {
    to: overrides.to ?? "recipient@example.com",
    from: overrides.from ?? "sender@example.com",
    raw: new Response(bytes).body as ReadableStream,
    rawSize: bytes.byteLength,
    headers: new Headers(),
    setReject: vi.fn(),
    forward: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

function mockEnv(put = vi.fn().mockResolvedValue(null)): { env: Bindings; put: typeof put } {
  return { env: { RAW_MAIL: { put } as unknown as R2Bucket }, put };
}

const ctx = {} as ExecutionContext;

describe("handleEmail", () => {
  it("writes the buffered raw MIME to R2 exactly once with the expected key/metadata", async () => {
    const { env, put } = mockEnv();
    const message = mockMessage();

    await handleEmail(message, env, ctx);

    expect(put).toHaveBeenCalledTimes(1);
    const [key, body, options] = put.mock.calls[0];

    expect(key).toMatch(/^inbox\/\d+-[0-9a-f-]{36}\.eml$/);

    const bodyText = new TextDecoder().decode(body as ArrayBuffer);
    expect(bodyText).toBe(SAMPLE_MIME);

    expect(options.httpMetadata).toEqual({ contentType: "message/rfc822" });
    expect(options.customMetadata).toEqual({
      to: "recipient@example.com",
      from: "sender@example.com",
    });
  });

  it("sanitizes CR/LF and non-ASCII characters out of envelope addresses", async () => {
    const { env, put } = mockEnv();
    const message = mockMessage({
      from: "attacker@example.com\r\nX-Injected: evil",
      to: "üser@example.com",
    });

    await handleEmail(message, env, ctx);

    const options = put.mock.calls[0][2];
    expect(options.customMetadata.from).not.toMatch(/[\r\n]/);
    expect(options.customMetadata.from).toBe("attacker@example.comX-Injected: evil");
    expect(options.customMetadata.to).toBe("ser@example.com");
  });

  it("truncates long envelope addresses so metadata stays well under the 8192-byte cap", async () => {
    const { env, put } = mockEnv();
    const longLocalPart = "a".repeat(1000);
    const message = mockMessage({ from: `${longLocalPart}@example.com` });

    await handleEmail(message, env, ctx);

    const options = put.mock.calls[0][2];
    expect(options.customMetadata.from.length).toBeLessThanOrEqual(320);
  });

  it("propagates a put() rejection instead of swallowing it", async () => {
    const failure = new Error("R2 unavailable");
    const { env } = mockEnv(vi.fn().mockRejectedValue(failure));
    const message = mockMessage();

    await expect(handleEmail(message, env, ctx)).rejects.toThrow("R2 unavailable");
  });
});

describe("handleEmail — portal signal nudge (Path B)", () => {
  const signalEnv = (): Bindings => ({
    RAW_MAIL: { put: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket,
    SIGNAL_URL: "https://mail-signal.example/api/signal",
    SIGNAL_KEY: "sig-key",
  });

  /** ctx whose waitUntil records the fire-and-forget promise so we can await it. */
  function capturingCtx(pending: Promise<unknown>[]): ExecutionContext {
    return { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
  }

  it("does NOT nudge when SIGNAL_URL/SIGNAL_KEY are unconfigured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env } = mockEnv();
    await handleEmail(mockMessage(), env, {} as ExecutionContext);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fires a best-effort POST with the signal key after the R2 write when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending: Promise<unknown>[] = [];

    await handleEmail(mockMessage(), signalEnv(), capturingCtx(pending));
    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://mail-signal.example/api/signal");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Signal-Key"]).toBe("sig-key");
    vi.unstubAllGlobals();
  });

  it("swallows a nudge failure — the mail is already in R2, so handleEmail must not reject", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("edge unreachable"));
    vi.stubGlobal("fetch", fetchMock);
    const pending: Promise<unknown>[] = [];

    await expect(handleEmail(mockMessage(), signalEnv(), capturingCtx(pending))).resolves.toBeUndefined();
    await expect(Promise.all(pending)).resolves.toBeDefined(); // .catch() neutralizes the rejection
    vi.unstubAllGlobals();
  });
});
