import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads NWC auto-topup defaults", () => {
    const config = loadConfig({
      ALBOM_BEARER_TOKEN: "abl_test"
    });

    expect(config.nwcUri).toBeUndefined();
    expect(config.nwcThresholdSats).toBe(1_000);
    expect(config.nwcTopupUsd).toBe(2);
    expect(config.nwcMaxDailyUsd).toBe(10);
  });

  it("loads NWC auto-topup overrides", () => {
    const config = loadConfig({
      ALBOM_BEARER_TOKEN: "abl_test",
      ALBOM_NWC_URI: "nostr+walletconnect://relay.example.com?secret=test&relay=wss%3A%2F%2Frelay.example.com",
      ALBOM_NWC_THRESHOLD_SATS: "1500",
      ALBOM_NWC_TOPUP_USD: "3.5",
      ALBOM_NWC_MAX_DAILY: "12.25"
    });

    expect(config.nwcUri).toContain("nostr+walletconnect://");
    expect(config.nwcThresholdSats).toBe(1_500);
    expect(config.nwcTopupUsd).toBe(3.5);
    expect(config.nwcMaxDailyUsd).toBe(12.25);
  });
});
