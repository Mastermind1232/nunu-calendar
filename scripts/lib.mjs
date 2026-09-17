/* Pure date and event logic. No Foundry here, so it runs under node --test. Dates are {y, m, d} with m 1..12. */
export const ID = "nunu-calendar";
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DEFAULT_DATE = {y: 2045, m: 9, d: 13};

const utc = ({y, m, d}) => Date.UTC(y, m - 1, d);
const fromUtc = (t) => { const x = new Date(t); return {y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate()}; };
export const isDate = (v) => Boolean(v) && [v.y, v.m, v.d].every(Number.isInteger) && v.m >= 1 && v.m <= 12 && v.d >= 1 && v.d <= daysInMonth(v.y, v.m);
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const addDays = (date, n) => fromUtc(utc(date) + n * 86400000);
export const weekday = (date) => new Date(utc(date)).getUTCDay();
export const compare = (a, b) => utc(a) - utc(b);
export const same = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
export const key = ({y, m, d}) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export function parse(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text ?? "").trim());
  if (!m) return null;
  const v = {y: Number(m[1]), m: Number(m[2]), d: Number(m[3])};
  return isDate(v) ? v : null;
}
export function ordinal(n) {
  const r = n % 100;
  const suffix = (r >= 11 && r <= 13) ? "th" : ({1: "st", 2: "nd", 3: "rd"}[n % 10] ?? "th");
  return `${n}${suffix}`;
}
/** "Saturday, September 13th, 2045" */
export const longDate = (date) => `${WEEKDAYS[weekday(date)]}, ${MONTHS[date.m - 1]} ${ordinal(date.d)}, ${date.y}`;
/** "Sat 13 Sep 2045" */
export const shortDate = (date) => `${WEEKDAYS[weekday(date)].slice(0, 3)} ${date.d} ${MONTHS[date.m - 1].slice(0, 3)} ${date.y}`;

/* Events: {id, title, start:"YYYY-MM-DD", end:"YYYY-MM-DD"|"", repeat:"none"|"weekly"|"monthly"|"yearly", visibility:"gm"|"all"|"users", users:[], notes:""} */
export const REPEATS = ["none", "weekly", "monthly", "yearly"];
export function normalizeEvent(raw = {}) {
  const start = parse(raw.start) ? raw.start.trim() : null;
  if (!start) throw new Error("An event needs a start date, written YYYY-MM-DD.");
  const title = String(raw.title ?? "").trim();
  if (!title) throw new Error("An event needs a title.");
  const end = parse(raw.end) ? raw.end.trim() : "";
  if (end && compare(parse(end), parse(start)) < 0) throw new Error("The end date is before the start date.");
  const repeat = REPEATS.includes(raw.repeat) ? raw.repeat : "none";
  const visibility = ["gm", "all", "users"].includes(raw.visibility) ? raw.visibility : "gm";
  const users = visibility === "users" ? [...new Set((raw.users ?? []).map(String).filter(Boolean))] : [];
  return {id: String(raw.id || ""), title: title.slice(0, 120), start, end, repeat, visibility, users, notes: String(raw.notes ?? "").slice(0, 2000)};
}
/** Does the event land on this day? Repeats are single-day; ranges do not repeat. */
export function occursOn(ev, date) {
  const s = parse(ev.start); if (!s) return false;
  if (ev.repeat === "none" || !ev.repeat) {
    const e = ev.end ? parse(ev.end) : s;
    return compare(date, s) >= 0 && compare(date, e) <= 0;
  }
  if (compare(date, s) < 0) return false;
  if (ev.repeat === "weekly") return weekday(date) === weekday(s);
  if (ev.repeat === "monthly") return date.d === Math.min(s.d, daysInMonth(date.y, date.m));
  if (ev.repeat === "yearly") return date.m === s.m && date.d === Math.min(s.d, daysInMonth(date.y, date.m));
  return false;
}
export function canSee(ev, {isGM, userId}) {
  if (isGM || ev.visibility === "all") return true;
  return ev.visibility === "users" && ev.users.includes(String(userId));
}
export const eventsOn = (events, date, viewer) => events.filter((e) => canSee(e, viewer) && occursOn(e, date));
/** Cells for a month grid, Sunday first, padded with blanks. */
export function monthCells(y, m) {
  const first = weekday({y, m, d: 1}), n = daysInMonth(y, m), cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= n; d++) cells.push({y, m, d});
  while (cells.length % 7) cells.push(null);
  return cells;
}
export const SEED_EVENTS = [
  {id: "rent", title: "Rent and lifestyle due", start: "2045-09-28", end: "", repeat: "monthly", visibility: "all", users: [], notes: "Housing and food for the month, from the Economic Tables."},
];
