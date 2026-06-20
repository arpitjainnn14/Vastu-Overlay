import { describe, expect, it } from "vitest";
import { fitContain, formatReportDate } from "./exportLayout";

describe("fitContain", () => {
  it("shrinks a wide image to box width", () => {
    expect(fitContain(2000, 1000, 400, 400)).toEqual({ width: 400, height: 200 });
  });
  it("shrinks a tall image to box height", () => {
    expect(fitContain(1000, 2000, 400, 400)).toEqual({ width: 200, height: 400 });
  });
  it("keeps a square image square", () => {
    expect(fitContain(500, 500, 400, 400)).toEqual({ width: 400, height: 400 });
  });
});

describe("formatReportDate", () => {
  it("formats as day short-month full-year", () => {
    expect(formatReportDate(new Date(2026, 5, 20))).toBe("20 Jun 2026");
  });
});
