import { describe, expect, it } from "vitest";
import { DEFAULT_DB_NAME, dbNameFrom } from "../../src/db.js";

/**
 * Atlas copies out a string with no database name, and the driver then quietly
 * uses "test" — which is where a deployment's data would end up unnoticed.
 */
describe("dbNameFrom", () => {
  it("uses the name in the connection string when there is one", () => {
    expect(dbNameFrom("mongodb+srv://u:p@cluster0.example.mongodb.net/kits?retryWrites=true")).toBe("kits");
    expect(dbNameFrom("mongodb://localhost:27017/prepkit")).toBe("prepkit");
  });

  it("falls back to the app's own name when the string has none", () => {
    for (const uri of [
      "mongodb+srv://u:p@cluster0.example.mongodb.net/?appName=Cluster0",
      "mongodb+srv://u:p@cluster0.example.mongodb.net",
      "not a uri at all",
    ]) {
      expect(dbNameFrom(uri), uri).toBe(DEFAULT_DB_NAME);
    }
  });
});
