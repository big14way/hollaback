import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig public URL", () => {
  it("prefers SERVER_PUBLIC_URL, then Render's RENDER_EXTERNAL_URL, then localhost", () => {
    expect(loadConfig({ SERVER_PUBLIC_URL: "https://hb.example.com/", RENDER_EXTERNAL_URL: "https://hb.onrender.com" }).publicUrl).toBe(
      "https://hb.example.com",
    );
    expect(loadConfig({ RENDER_EXTERNAL_URL: "https://hb.onrender.com" }).publicUrl).toBe("https://hb.onrender.com");
    expect(loadConfig({ PORT: "4100" }).publicUrl).toBe("http://localhost:4100");
  });

  it("keeps the demo shopper's number on the console by default and normalizes CONSOLE_NUMBERS", () => {
    expect(loadConfig({}).consoleNumbers).toEqual(["+2348031234567"]);
    expect(loadConfig({ CONSOLE_NUMBERS: "+1 415 555 0100, 00447700900123, not-a-number" }).consoleNumbers).toEqual([
      "+14155550100",
      "+447700900123",
    ]);
  });

  it("falls back to mock PayPal when credentials are missing", () => {
    expect(loadConfig({}).mockPaypal).toBe(true);
    expect(loadConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" }).mockPaypal).toBe(false);
  });
});
