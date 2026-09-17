import {test} from "node:test";
import assert from "node:assert/strict";
import {addDays, weekday, daysInMonth, ordinal, longDate, shortDate, parse, key, normalizeEvent, occursOn, canSee, eventsOn, monthCells, WEEKDAYS} from "../scripts/lib.mjs";

test("date arithmetic crosses months and years", () => {
  assert.deepEqual(addDays({y: 2045, m: 9, d: 28}, 7), {y: 2045, m: 10, d: 5});
  assert.deepEqual(addDays({y: 2045, m: 12, d: 31}, 1), {y: 2046, m: 1, d: 1});
  assert.deepEqual(addDays({y: 2045, m: 3, d: 1}, -1), {y: 2045, m: 2, d: 28});
  assert.equal(daysInMonth(2044, 2), 29); assert.equal(daysInMonth(2045, 2), 28);
});
test("weekday and formatting", () => {
  assert.equal(WEEKDAYS[weekday({y: 2026, m: 9, d: 17})], "Thursday");
  assert.equal(longDate({y: 2045, m: 9, d: 1}), `${WEEKDAYS[weekday({y: 2045, m: 9, d: 1})]}, September 1st, 2045`);
  assert.equal(shortDate({y: 2045, m: 9, d: 13}).endsWith("13 Sep 2045"), true);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  assert.equal(key({y: 2045, m: 9, d: 5}), "2045-09-05");
});
test("parsing rejects bad dates", () => {
  assert.deepEqual(parse("2045-09-28"), {y: 2045, m: 9, d: 28});
  assert.equal(parse("2045-02-30"), null); assert.equal(parse("28/09/2045"), null); assert.equal(parse(""), null);
});
test("events normalise and validate", () => {
  const e = normalizeEvent({title: " Rent ", start: "2045-09-28", repeat: "monthly", visibility: "all"});
  assert.equal(e.title, "Rent"); assert.equal(e.repeat, "monthly"); assert.equal(e.visibility, "all"); assert.deepEqual(e.users, []);
  assert.throws(() => normalizeEvent({title: "x", start: "soon"}), /start date/);
  assert.throws(() => normalizeEvent({title: "", start: "2045-09-28"}), /title/);
  assert.throws(() => normalizeEvent({title: "x", start: "2045-09-28", end: "2045-09-01"}), /end date/);
  assert.equal(normalizeEvent({title: "x", start: "2045-09-28", visibility: "nonsense"}).visibility, "gm", "unknown visibility falls back to GM only");
  assert.deepEqual(normalizeEvent({title: "x", start: "2045-09-28", visibility: "users", users: ["a", "a", "b"]}).users, ["a", "b"]);
});
test("occurrence rules: single, range, weekly, monthly with clamp, yearly", () => {
  const single = normalizeEvent({title: "s", start: "2045-09-13"});
  assert.equal(occursOn(single, {y: 2045, m: 9, d: 13}), true); assert.equal(occursOn(single, {y: 2045, m: 9, d: 14}), false);
  const range = normalizeEvent({title: "Session 4", start: "2045-09-11", end: "2045-09-12"});
  assert.equal(occursOn(range, {y: 2045, m: 9, d: 12}), true); assert.equal(occursOn(range, {y: 2045, m: 9, d: 13}), false);
  const weekly = normalizeEvent({title: "w", start: "2045-09-13", repeat: "weekly"});
  assert.equal(occursOn(weekly, {y: 2045, m: 9, d: 20}), true); assert.equal(occursOn(weekly, {y: 2045, m: 9, d: 21}), false); assert.equal(occursOn(weekly, {y: 2045, m: 9, d: 6}), false, "not before the start");
  const rent = normalizeEvent({title: "Rent", start: "2045-09-28", repeat: "monthly"});
  assert.equal(occursOn(rent, {y: 2045, m: 10, d: 28}), true); assert.equal(occursOn(rent, {y: 2046, m: 1, d: 28}), true); assert.equal(occursOn(rent, {y: 2045, m: 10, d: 27}), false);
  const m31 = normalizeEvent({title: "end", start: "2045-08-31", repeat: "monthly"});
  assert.equal(occursOn(m31, {y: 2045, m: 9, d: 30}), true, "31st clamps to the last day of shorter months");
  const yearly = normalizeEvent({title: "y", start: "2045-09-13", repeat: "yearly"});
  assert.equal(occursOn(yearly, {y: 2046, m: 9, d: 13}), true); assert.equal(occursOn(yearly, {y: 2046, m: 9, d: 14}), false);
});
test("visibility: GM sees all, players see everyone's and their own", () => {
  const list = [normalizeEvent({title: "gm", start: "2045-09-13"}), normalizeEvent({title: "all", start: "2045-09-13", visibility: "all"}), normalizeEvent({title: "jan", start: "2045-09-13", visibility: "users", users: ["u1"]})];
  const day = {y: 2045, m: 9, d: 13};
  assert.deepEqual(eventsOn(list, day, {isGM: true, userId: "x"}).map((e) => e.title), ["gm", "all", "jan"]);
  assert.deepEqual(eventsOn(list, day, {isGM: false, userId: "u1"}).map((e) => e.title), ["all", "jan"]);
  assert.deepEqual(eventsOn(list, day, {isGM: false, userId: "u2"}).map((e) => e.title), ["all"]);
  assert.equal(canSee(list[0], {isGM: false, userId: "u1"}), false);
});
test("month grid pads to whole weeks starting Sunday", () => {
  const cells = monthCells(2045, 9);
  assert.equal(cells.length % 7, 0);
  assert.equal(cells.findIndex((c) => c), weekday({y: 2045, m: 9, d: 1}));
  assert.equal(cells.filter(Boolean).length, 30);
});
