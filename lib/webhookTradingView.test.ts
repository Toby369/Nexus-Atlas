import { describe, it, expect } from "vitest";
import {
  REQUIRED_WEBHOOK_STRING_FIELDS,
  isValidWebhookSecret,
  resolveProvidedSecret,
  validateRequiredWebhookFields,
  stripSecretFromWebhookPayload,
} from "./webhookTradingView";

describe("REQUIRED_WEBHOOK_STRING_FIELDS", () => {
  it("verlangt genau ticker und signal_type", () => {
    expect(REQUIRED_WEBHOOK_STRING_FIELDS).toEqual(["ticker", "signal_type"]);
  });
});

describe("isValidWebhookSecret", () => {
  it("true, wenn provided exakt expected entspricht", () => {
    expect(isValidWebhookSecret("s3cr3t", "s3cr3t")).toBe(true);
  });

  it("false bei abweichendem Secret", () => {
    expect(isValidWebhookSecret("falsch", "s3cr3t")).toBe(false);
  });

  it("false, wenn kein Secret uebermittelt wurde (null)", () => {
    expect(isValidWebhookSecret(null, "s3cr3t")).toBe(false);
  });

  it("false, wenn der Server nicht konfiguriert ist (expected null) -- auch bei provided null", () => {
    expect(isValidWebhookSecret(null, null)).toBe(false);
    expect(isValidWebhookSecret("irgendwas", null)).toBe(false);
  });

  it("false bei leerem provided-String (kein Secret zaehlt als kein Secret)", () => {
    expect(isValidWebhookSecret("", "s3cr3t")).toBe(false);
  });
});

describe("resolveProvidedSecret", () => {
  it("nutzt den Header, wenn gesetzt", () => {
    expect(resolveProvidedSecret("header-secret", "body-secret")).toBe("header-secret");
  });

  it("faellt auf das Body-Feld zurueck, wenn kein Header gesetzt ist", () => {
    expect(resolveProvidedSecret(null, "body-secret")).toBe("body-secret");
  });

  it("liefert null, wenn weder Header noch Body-Secret vorhanden sind", () => {
    expect(resolveProvidedSecret(null, undefined)).toBeNull();
  });

  it("ignoriert ein Body-Secret, das kein String ist (z.B. Zahl/Objekt)", () => {
    expect(resolveProvidedSecret(null, 12345)).toBeNull();
    expect(resolveProvidedSecret(null, { nested: true })).toBeNull();
  });
});

describe("validateRequiredWebhookFields", () => {
  it("valid, wenn ticker und signal_type als nicht-leere Strings vorliegen", () => {
    expect(
      validateRequiredWebhookFields({ ticker: "BTCUSDT", signal_type: "BULLISH_BREAKOUT" })
    ).toEqual({ valid: true, missingField: null });
  });

  it("meldet ticker als fehlendes Feld, wenn es fehlt", () => {
    expect(validateRequiredWebhookFields({ signal_type: "BULLISH_BREAKOUT" })).toEqual({
      valid: false,
      missingField: "ticker",
    });
  });

  it("meldet signal_type als fehlendes Feld, wenn es fehlt", () => {
    expect(validateRequiredWebhookFields({ ticker: "BTCUSDT" })).toEqual({
      valid: false,
      missingField: "signal_type",
    });
  });

  it("lehnt einen leeren String als 'fehlend' ab, nicht als gueltigen Wert", () => {
    expect(validateRequiredWebhookFields({ ticker: "", signal_type: "X" })).toEqual({
      valid: false,
      missingField: "ticker",
    });
  });

  it("lehnt einen Nicht-String-Wert ab (z.B. Zahl)", () => {
    expect(validateRequiredWebhookFields({ ticker: 123, signal_type: "X" })).toEqual({
      valid: false,
      missingField: "ticker",
    });
  });
});

describe("stripSecretFromWebhookPayload", () => {
  it("entfernt das secret-Feld, behaelt alle anderen Felder", () => {
    const result = stripSecretFromWebhookPayload({
      secret: "s3cr3t",
      ticker: "BTCUSDT",
      signal_type: "BULLISH_BREAKOUT",
      timeframe: "1H",
    });
    expect(result).toEqual({ ticker: "BTCUSDT", signal_type: "BULLISH_BREAKOUT", timeframe: "1H" });
    expect(result).not.toHaveProperty("secret");
  });

  it("funktioniert unveraendert, wenn gar kein secret-Feld vorhanden ist", () => {
    const result = stripSecretFromWebhookPayload({ ticker: "BTCUSDT", signal_type: "X" });
    expect(result).toEqual({ ticker: "BTCUSDT", signal_type: "X" });
  });
});
