import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTelegram } from "../notify.mjs";

describe("sendTelegram", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true })));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("does nothing when TELEGRAM_BOT_TOKEN is not set", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    await sendTelegram("test message");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does nothing when TELEGRAM_CHAT_ID is not set", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token123";
    delete process.env.TELEGRAM_CHAT_ID;

    await sendTelegram("test message");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends message when both env vars are set", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token123";
    process.env.TELEGRAM_CHAT_ID = "chat456";

    await sendTelegram("hello world");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken123/sendMessage",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: "chat456", text: "hello world" }),
      }
    );
  });

  it("does not throw when fetch fails", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "token123";
    process.env.TELEGRAM_CHAT_ID = "chat456";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network error"))));

    // Should not throw
    await sendTelegram("test");
  });
});
