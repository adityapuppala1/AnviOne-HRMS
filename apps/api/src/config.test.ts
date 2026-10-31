import { describe, expect, it } from "vitest";
import { readConfig } from "./config";
const local = {
  NODE_ENV: "development",
  AUTH_MODE: "demo",
  API_HOST: "127.0.0.1",
  APP_ORIGIN: "http://127.0.0.1:5173",
  DATABASE_URL: "postgresql://localhost/example",
};
describe("deployment boundaries", () => {
  it("allows an explicit loopback development demo", () =>
    expect(readConfig(local).AUTH_MODE).toBe("demo"));
  it("rejects demo in production", () =>
    expect(() => readConfig({ ...local, NODE_ENV: "production" })).toThrow());
  it("rejects public demo binds and origins", () => {
    expect(() => readConfig({ ...local, API_HOST: "0.0.0.0" })).toThrow();
    expect(() =>
      readConfig({ ...local, APP_ORIGIN: "https://demo.example" }),
    ).toThrow();
  });
  it("never defaults to demo auth", () =>
    expect(() => readConfig({ ...local, AUTH_MODE: undefined })).toThrow(
      "OIDC",
    ));
  it("trusts only explicitly configured proxies", () => {
    expect(readConfig(local).TRUST_PROXY).toBeUndefined();
    expect(() => readConfig({ ...local, TRUST_PROXY: "1" })).toThrow(
      "trusted proxy",
    );
    const oidc = {
      ...local,
      AUTH_MODE: "oidc",
      OIDC_ISSUER: "https://login.example.com/tenant-id/v2.0",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URI: "http://127.0.0.1:5173/api/v1/auth/callback",
    };
    expect(readConfig({ ...oidc, TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(
      readConfig({ ...oidc, TRUST_PROXY: "10.0.0.0/8, 192.168.1.4" })
        .TRUST_PROXY,
    ).toEqual(["10.0.0.0/8", "192.168.1.4"]);
    for (const value of ["true", "0", "9", "*", "loopback; rm"])
      expect(() => readConfig({ ...oidc, TRUST_PROXY: value })).toThrow(
        "TRUST_PROXY",
      );
  });
  it("requires a shared TLS rate-limit store in production", () => {
    const production = {
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      API_HOST: "0.0.0.0",
      APP_ORIGIN: "https://hr.example.com",
      DATABASE_URL: "postgresql://db.example.com/anvione?sslmode=verify-full",
      OIDC_ISSUER: "https://login.example.com/tenant-id/v2.0",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URI: "https://hr.example.com/api/v1/auth/callback",
      OIDC_REQUIRED_ACR: "mfa",
      PROFILE_DATA_KEY: "ab".repeat(32),
    };
    for (const value of [undefined, "redis://cache.example.com:6379"])
      expect(() =>
        readConfig({ ...production, RATE_LIMIT_URL: value }),
      ).toThrow("rate-limit store");
    expect(
      readConfig({
        ...production,
        RATE_LIMIT_URL: "rediss://cache.example.com:6380",
      }).RATE_LIMIT_URL,
    ).toBe("rediss://cache.example.com:6380");
    expect(() =>
      readConfig({ ...local, RATE_LIMIT_URL: "http://cache.example.com" }),
    ).toThrow("RATE_LIMIT_URL");
  });
  it("requires a profile data key in production", () => {
    expect(() =>
      readConfig({
        NODE_ENV: "production",
        AUTH_MODE: "oidc",
        API_HOST: "0.0.0.0",
        APP_ORIGIN: "https://hr.example.com",
        DATABASE_URL: "postgresql://db.example.com/anvione?sslmode=verify-full",
        OIDC_ISSUER: "https://login.example.com/tenant-id/v2.0",
        OIDC_CLIENT_ID: "client",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_REDIRECT_URI: "https://hr.example.com/api/v1/auth/callback",
        OIDC_REQUIRED_ACR: "mfa",
        RATE_LIMIT_URL: "rediss://cache.example.com:6380",
      }),
    ).toThrow("PROFILE_DATA_KEY");
    expect(() => readConfig({ ...local, PROFILE_DATA_KEY: "not-hex" })).toThrow(
      "PROFILE_DATA_KEY",
    );
  });
  it("accepts a rotation key ring and refuses malformed keys without echoing them", () => {
    const production = {
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      API_HOST: "0.0.0.0",
      APP_ORIGIN: "https://hr.example.com",
      DATABASE_URL: "postgresql://db.example.com/anvione?sslmode=verify-full",
      OIDC_ISSUER: "https://login.example.com/tenant-id/v2.0",
      OIDC_CLIENT_ID: "client",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_REDIRECT_URI: "https://hr.example.com/api/v1/auth/callback",
      OIDC_REQUIRED_ACR: "mfa",
      RATE_LIMIT_URL: "rediss://cache.example.com:6380",
    };
    expect(
      readConfig({
        ...production,
        PROFILE_DATA_KEYS: `2:${"cd".repeat(32)}, 1:${"ef".repeat(32)}`,
      }).PROFILE_DATA_KEYS,
    ).toEqual([
      { id: 2, hex: "cd".repeat(32) },
      { id: 1, hex: "ef".repeat(32) },
    ]);
    const secret = "9f".repeat(31);
    for (const value of [
      `1:${secret}`,
      `0:${"ab".repeat(32)}`,
      `256:${"ab".repeat(32)}`,
      `1:${"ab".repeat(32)},1:${"cd".repeat(32)}`,
      `x:${"ab".repeat(32)}`,
    ]) {
      let message = "";
      try {
        readConfig({ ...local, PROFILE_DATA_KEYS: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("PROFILE_DATA_KEYS");
      expect(message).not.toContain(secret);
    }
  });
  it("does not include secret configuration values in errors", () => {
    expect(() =>
      readConfig({ ...local, APP_ORIGIN: "private-secret-value" }),
    ).toThrow("Invalid configuration: APP_ORIGIN");
  });
});
