export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export function validTimeZone(value: string | null | undefined) {
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function calendarParts(date: Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
  };
}

export function currentCalendarPeriod(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  const { year, month } = calendarParts(now, timeZone);
  return { year, month };
}

export function greetingForTimeZone(timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  const { hour } = calendarParts(now, timeZone);
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function financialReferenceForTimeZone(
  date: Date,
  startDay: number,
  timeZone = DEFAULT_TIME_ZONE,
) {
  const normalizedStart = Math.max(1, Math.min(28, Math.trunc(startDay)));
  const parts = calendarParts(date, timeZone);
  let year = parts.year;
  let month = parts.month;
  if (parts.day < normalizedStart) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return { year, month };
}

export function formatCalendarDate(
  value: Date | string,
  timeZone = DEFAULT_TIME_ZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" },
) {
  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: validTimeZone(timeZone),
  }).format(typeof value === "string" ? new Date(value) : value);
}
