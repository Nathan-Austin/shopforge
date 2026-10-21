import { describe, it, expect } from "vitest";
import { isHoneypotTripped, isTooFast } from "../formGuards";

describe("isHoneypotTripped", () => {
  it("is false for an empty honeypot", () => {
    expect(isHoneypotTripped("")).toBe(false);
    expect(isHoneypotTripped("   ")).toBe(false);
    expect(isHoneypotTripped(undefined)).toBe(false);
  });

  it("is true when a bot fills the honeypot", () => {
    expect(isHoneypotTripped("http://spam.example")).toBe(true);
  });
});

describe("isTooFast", () => {
  it("is true for a submission under the minimum delay", () => {
    expect(isTooFast(Date.now() - 500, 2000)).toBe(true);
  });

  it("is false once enough time has passed", () => {
    expect(isTooFast(Date.now() - 3000, 2000)).toBe(false);
  });

  it("is true for a missing/invalid timestamp (fails closed)", () => {
    expect(isTooFast(undefined)).toBe(true);
    expect(isTooFast("not-a-number")).toBe(true);
  });
});
