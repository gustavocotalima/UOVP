import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatDateOnly } from "@/lib/calendar";

describe("formatação de datas civis", () => {
  it("preserva o dia UTC informado pela Pluggy", () => {
    const operationDate = "2026-08-13T00:00:00.000Z";

    expect(formatDateOnly(operationDate)).toBe("13/08/2026");
    expect(formatCalendarDate(operationDate, "America/Sao_Paulo")).toBe("12/08/2026");
  });
});
