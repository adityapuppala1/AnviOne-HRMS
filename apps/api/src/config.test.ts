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
  it("does not include secret configuration values in errors", () => {
    expect(() =>
      readConfig({ ...local, APP_ORIGIN: "private-secret-value" }),
    ).toThrow("Invalid configuration: APP_ORIGIN");
  });
});
