import "server-only";

const DAY = 86_400_000;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
});

export function calendar(now = new Date()) {
  const parts = formatter.formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  // These UTC dates are arithmetic containers for local calendar dates,
  // not conversions of the visitor's timezone or the current UTC instant.
  const date = new Date(`${today}T00:00:00.000Z`);
  const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY;
  const days = Array.from({ length: 7 }, (_, index) =>
    new Date(monday + index * DAY).toISOString().slice(0, 10));
  // Bogotá has a fixed UTC−05 offset and no daylight-saving transitions.
  const nextMidnight = new Date(date.getTime() + DAY + 5 * 60 * 60 * 1000).toISOString();
  return { timeZone: "America/Bogota" as const, today, weekStart: days[0], weekEnd: days[6], days, nextMidnight };
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
