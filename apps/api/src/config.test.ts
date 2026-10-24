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
  it("does not include secret configuration values in errors", () => {
    expect(() =>
      readConfig({ ...local, APP_ORIGIN: "private-secret-value" }),
    ).toThrow("Invalid configuration: APP_ORIGIN");
  });
});
