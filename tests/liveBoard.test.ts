import { describe, expect, it } from "vitest";
import { sortRows, type BoardRow } from "../src/hud/liveBoard";

const row = (over: Partial<BoardRow>): BoardRow => ({
  id: "x", name: "X", team: "a", kills: 0, deaths: 0, pingMs: 0,
  human: true, alive: true, ...over,
});

describe("scoreboard ordering", () => {
  it("puts the most kills first", () => {
    const sorted = sortRows([
      row({ name: "Low", kills: 1 }),
      row({ name: "High", kills: 9 }),
      row({ name: "Mid", kills: 4 }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("breaks a tie on kills by fewer deaths", () => {
    const sorted = sortRows([
      row({ name: "Sloppy", kills: 5, deaths: 9 }),
      row({ name: "Clean", kills: 5, deaths: 2 }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["Clean", "Sloppy"]);
  });

  it("settles a full tie by name, so the list does not shuffle as it updates", () => {
    // The board redraws while someone is reading it. Rows that swap places on
    // their own make it unreadable.
    const rows = [row({ name: "Zed", id: "z" }), row({ name: "Ada", id: "a" })];
    expect(sortRows(rows).map((r) => r.name)).toEqual(["Ada", "Zed"]);
    expect(sortRows([...rows].reverse()).map((r) => r.name)).toEqual(["Ada", "Zed"]);
  });

  it("leaves the caller's array alone", () => {
    const rows = [row({ name: "B", kills: 1 }), row({ name: "A", kills: 5 })];
    sortRows(rows);
    expect(rows.map((r) => r.name)).toEqual(["B", "A"]);
  });
});
