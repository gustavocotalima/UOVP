import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatDateOnly } from "@/lib/calendar";

describe("formatação de datas civis", () => {
  it("preserva o dia UTC informado pela Pluggy", () => {
    const operationDate = "2026-08-13T00:00:00.000Z";

    expect(formatDateOnly(operationDate)).toBe("13/08/2026");
    expect(formatCalendarDate(operationDate, "America/Sao_Paulo")).toBe("12/08/2026");
  });

  it.each([
    ["2026-01-01", "01/01/2026"],
    ["2026-01-01T00:00:00.000Z", "01/01/2026"],
    ["2026-03-01T00:00:00.000Z", "01/03/2026"],
    ["2028-02-29T00:00:00.000Z", "29/02/2028"],
    [new Date("2026-12-31T00:00:00Z"), "31/12/2026"],
  ])("preserva datas civis no limite de mês/ano: %s", (value, expected) => {
    expect(formatDateOnly(value)).toBe(expected);
    for (const timeZone of ["America/Sao_Paulo", "Pacific/Honolulu", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      // A date-only formatter must not inherit even an explicitly supplied
      // display time zone; real timestamps continue through formatCalendarDate.
      expect(formatDateOnly(value, { dateStyle: "short", timeZone })).toBe(expected);
    }
  });

  it("mantém a conversão de fuso para instantes reais de atualização", () => {
    const timestamp = "2026-03-01T00:30:00.000Z";
    expect(formatCalendarDate(timestamp, "America/Sao_Paulo")).toBe("28/02/2026");
    expect(formatCalendarDate(timestamp, "Asia/Tokyo")).toBe("01/03/2026");
  });
});
