import { describe, it, expect } from "vitest";
import { isDisposableOrRoleEmail } from "../email";

describe("isDisposableOrRoleEmail", () => {
  it("allows a normal personal email", () => {
    expect(isDisposableOrRoleEmail("jane@gmail.com")).toBe(false);
  });

  it("rejects a known disposable domain", () => {
    expect(isDisposableOrRoleEmail("bot@mailinator.com")).toBe(true);
  });

  it("rejects role-based prefixes", () => {
    expect(isDisposableOrRoleEmail("admin@example.com")).toBe(true);
    expect(isDisposableOrRoleEmail("info@example.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isDisposableOrRoleEmail("Admin@Example.com")).toBe(true);
  });
});
