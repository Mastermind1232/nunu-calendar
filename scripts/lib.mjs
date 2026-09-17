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
/** What an event does to the people it applies to when its day arrives. */
export const EFFECTS = ["none", "pay", "ask", "credit", "items"];
export const EFFECT_LABELS = {none: "Nothing", pay: "They pay a set amount", ask: "They choose how much to pay", credit: "They receive eddies", items: "They receive items"};
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
  const effect = EFFECTS.includes(raw.effect) ? raw.effect : "none";
  const amount = Math.max(0, Math.floor(Number(raw.amount) || 0));
  const items = effect === "items" ? (raw.items ?? []).filter((i) => i && i.uuid).map((i) => ({uuid: String(i.uuid), name: String(i.name ?? "Item").slice(0, 120), qty: Math.max(1, Math.floor(Number(i.qty) || 1))})) : [];
  if (effect !== "none" && visibility === "gm") throw new Error("A GM-only event cannot charge, pay or hand out anything. Set who it applies to.");
  if (effect === "items" && !items.length) throw new Error("Drop at least one item onto the event.");
  const amounts = {};
  if (["pay", "credit"].includes(effect) && visibility === "users") for (const u of users) { const v = Math.floor(Number(raw.amounts?.[u])); if (Number.isFinite(v) && v > 0) amounts[u] = v; }
  if ((effect === "pay" || effect === "credit") && amount <= 0 && !Object.keys(amounts).length) throw new Error("Enter the amount of eddies.");
  return {id: String(raw.id || ""), title: title.slice(0, 120), start, end, repeat, visibility, users, notes: String(raw.notes ?? "").slice(0, 2000),
    effect, amount, amounts, reason: String(raw.reason ?? "").trim().slice(0, 200), items};
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

/* ---------------- Due records: what lands on whom when a day arrives ---------------- */
/** Every day after `from` up to and including `to`. Empty when going backward. */
export function daysBetween(from, to) {
  const out = [];
  for (let d = addDays(from, 1); compare(d, to) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}
/** The users an event applies to, from the player users given as [{id}]. */
export const affectedUsers = (ev, users) => ev.effect === "none" ? [] : users.filter((u) => ev.visibility === "all" || (ev.visibility === "users" && ev.users.includes(String(u.id))));
export function dueOn(events, date, users) {
  const records = [];
  for (const ev of events) {
    if (ev.effect === "none" || !occursOn(ev, date)) continue;
    for (const u of affectedUsers(ev, users)) {
      records.push({id: `${ev.id}:${key(date)}:${u.id}`, userId: String(u.id), kind: ev.effect, eventId: ev.id, title: ev.title, date: key(date),
        amount: ev.amounts?.[String(u.id)] ?? ev.amount, reason: ev.reason || ev.title, items: ev.items});
    }
  }
  return records;
}
export const downtimeRecords = (date, users) => users.map((u) => ({id: `downtime:${key(date)}:${u.id}`, userId: String(u.id), kind: "downtime", date: key(date), title: "A week passes"}));
/** Adds records to a queue without duplicating ids. */
export const mergeQueue = (queue, records) => { const seen = new Set(queue.map((r) => r.id)); return [...queue, ...records.filter((r) => !seen.has(r.id))]; };

/* ---------------- Hustles (Cyberpunk RED core, downtime) ---------------- */
/** Payout bands by Role rank 1-4, 5-7, 8-10. `bands` indexes PAY for d6 results 1-6. Flavor text is a placeholder until the book's wording is loaded. */
export const PAY = [[0, 100, 300], [100, 200, 500], [200, 300, 600], [300, 500, 800]];
export const HUSTLES = {
  rockerboy: {name: "Rockerboy", bands: [2, 0, 3, 3, 3, 2], text: ["played a small local gig", "found no gigs or jobs to be had this week", "played a big gig for a rich Corporate or Local Personality", "got some royalties in for their most recent Data Pool download", "were the opening act for a Big-Name group", "made a personal appearance that netted a large fee"]},
  solo: {name: "Solo", bands: [1, 2, 2, 1, 0, 1], text: ["took a budget protection contract", "took a premium protection contract", "took a high-risk contract", "hired out as muscle", "laid low all week", "took an enforcement contract"]},
  netrunner: {name: "Netrunner", bands: [1, 2, 0, 2, 2, 2], text: ["cracked a small system and sold the data", "cracked a major Corporate system and sold the data", "got sidetracked and didn't hack anything this week", "found a valuable data cache in an abandoned system and sold it", "brought down a major system with ransomware and got paid off to uninstall it", "sabotaged or otherwise disabled a major system for a faceless client"]},
  tech: {name: "Tech", bands: [0, 1, 2, 1, 1, 1], text: ["found no commissions", "restored some salvage", "took a security contract", "serviced someone's cybertech", "serviced weapons", "took a sabotage commission"]},
  medtech: {name: "Medtech", bands: [1, 2, 1, 0, 2, 1], text: ["patched up someone after a firefight", "sold cyberware from a \"failed\" medical case", "helped Trauma Team on some backup work when they were overloaded", "did some minor \"free clinic\" work for locals; you can't eat goodwill though", "did a major medical procedure for a very well-heeled client", "designed and delivered medicines or street drugs to a client"]},
  media: {name: "Media", bands: [3, 2, 2, 2, 0, 3], text: ["wrote an exposé that covered a major topic and made a big sale", "wrote a popular \"puff piece\" that got them some notice and some cash", "did some boring ad writing to pay the bills", "exposed a big story that got them a few enemies and some cash", "found no good stories or leads this week", "wrote an exposé that blew the lid off a major topic"]},
  lawman: {name: "Lawman", bands: [1, 2, 0, 1, 2, 2], text: ["made routine arrests", "collected a citizen's reward", "took a salary deduction", "drew a routine paycheck", "earned a smuggling-bust bonus", "earned a gang-seizure bonus"]},
  exec: {name: "Exec", bands: [3, 0, 2, 3, 3, 2], text: ["earned a project bonus", "had a bonus withheld", "drew a routine paycheck", "leveraged the office", "was rewarded for a major project", "reallocated a rival's funding"]},
  fixer: {name: "Fixer", bands: [2, 2, 2, 0, 2, 3], text: ["got a Media some information for a good bribe", "got a Rocker a good gig for their 12% fee", "helped a client locate a desirable item they needed and got a cut", "had a deal go south and are keeping their head down till it blows over", "got a Solo or Netrunner a profitable \"job\" and took their agency fee", "brought in a rare, illegal, or very hard to get item for a client"]},
  nomad: {name: "Nomad", bands: [1, 1, 1, 2, 1, 0], text: ["ran cargo", "ran convoy security", "made a small smuggling run", "made a major smuggling run", "delivered passengers", "found no transport work"]},
};
export const ROLE_BY_ABILITY = {operator: "fixer", medicine: "medtech", "charismatic impact": "rockerboy", backup: "lawman", credibility: "media", "combat awareness": "solo", maker: "tech", interface: "netrunner", moto: "nomad", teamwork: "exec"};
export function hustleResult(table, rank, die) {
  const t = HUSTLES[table];
  if (!t || !Number.isInteger(rank) || rank < 1 || rank > 10 || !Number.isInteger(die) || die < 1 || die > 6) throw new Error("A Hustle needs a supported Role, a rank from 1 to 10 and a d6.");
  return {die, amount: PAY[t.bands[die - 1]][rank >= 8 ? 2 : rank >= 5 ? 1 : 0], text: t.text[die - 1], role: t.name};
}
