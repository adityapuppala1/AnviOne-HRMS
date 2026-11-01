import { describe, expect, it } from "vitest";
import { buildOrderBy } from "./sort";

const cols = { name: "lower(name)", joinedOn: "joined_on" } as const;

describe("buildOrderBy", () => {
  it("falls back when no sort is given", () => {
    expect(buildOrderBy(cols, undefined, "asc", "name,id", "id")).toBe(
      "name,id",
    );
  });
  it("maps a whitelisted key to its fixed expression", () => {
    expect(buildOrderBy(cols, "joinedOn", "desc", "name,id", "id")).toBe(
      "joined_on DESC NULLS LAST, id",
    );
    expect(buildOrderBy(cols, "name", "asc", "x", "id")).toBe(
      "lower(name) ASC NULLS LAST, id",
    );
  });
  it("never passes unknown or hostile keys through", () => {
    for (const bad of ["name; DROP TABLE x", "constructor", "__proto__"])
      expect(buildOrderBy(cols, bad as never, "asc", "name,id", "id")).toBe(
        "name,id",
      );
  });
});
