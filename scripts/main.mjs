import {ID, DEFAULT_DATE, SEED_EVENTS, MONTHS, WEEKDAYS, addDays, longDate, shortDate, parse, key, isDate, same, normalizeEvent, eventsOn, monthCells} from "./lib.mjs";

/* ------------------------------------------------------------------ */
/*  State: two world settings, the date and the event list             */
/* ------------------------------------------------------------------ */
export const getDate = () => { const v = game.settings.get(ID, "date"); return isDate(v) ? v : DEFAULT_DATE; };
export const getEvents = () => (game.settings.get(ID, "events") ?? []).map((e) => { try { return normalizeEvent(e); } catch { return null; } }).filter(Boolean);
async function saveEvents(list) { await game.settings.set(ID, "events", list); }

export async function setDate(date, announce = "") {
  if (!game.user.isGM) throw new Error("Only the GM moves the calendar.");
  if (!isDate(date)) throw new Error("That is not a valid date.");
  await game.settings.set(ID, "date", date);
  if (announce) await ChatMessage.create({content: `<div class="nunu-cal-chat"><i class="fas fa-calendar-days"></i> ${announce}</div>`, speaker: {alias: "Calendar"}});
  Hooks.callAll("nunuCalendar.dateChanged", date);
  return date;
}
/** +1 and -1 are silent. +7 announces and fires nunuCalendar.weekPassed for the downtime prompts. */
export async function advance(days) {
  const next = addDays(getDate(), days);
  await setDate(next, days === 7 ? `A week passes. It is now ${longDate(next)}.` : "");
  if (days === 7) Hooks.callAll("nunuCalendar.weekPassed", next);
  return next;
}

/* ------------------------------------------------------------------ */
/*  The corner widget, sitting just above the player list              */
/* ------------------------------------------------------------------ */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
function renderWidget() {
  if (!game.ready) return;
  const date = getDate(), gm = game.user.isGM;
  let el = document.getElementById("nunu-cal-widget");
  if (!el) {
    el = document.createElement("div"); el.id = "nunu-cal-widget";
    const players = document.getElementById("players");
    const host = players?.parentElement ?? document.getElementById("ui-left") ?? document.body;
    host.insertBefore(el, players ?? null);
  }
  el.innerHTML = `<button type="button" class="date" title="Open the calendar"><i class="fas fa-calendar-days"></i><span>${esc(longDate(date))}</span></button>` +
    (gm ? `<div class="ctrl"><button type="button" data-adv="-1" title="Back one day"><i class="fas fa-chevron-left"></i></button><button type="button" data-adv="1" title="Forward one day"><i class="fas fa-chevron-right"></i></button><button type="button" class="week" data-adv="7" title="A week passes">+1 week</button></div>` : "");
  el.querySelector(".date").addEventListener("click", () => CalendarApp.open());
  el.querySelectorAll("[data-adv]").forEach((b) => b.addEventListener("click", async () => {
    const days = Number(b.dataset.adv);
    try {
      if (days === 7 && !await Dialog.confirm({title: "A week passes", content: `<p>Move the calendar forward seven days, to <b>${esc(longDate(addDays(getDate(), 7)))}</b>?</p><p>This is announced in chat.</p>`})) return;
      await advance(days);
    } catch (e) { ui.notifications.error(e.message); }
  }));
}

/* ------------------------------------------------------------------ */
/*  The month grid                                                     */
/* ------------------------------------------------------------------ */
class CalendarApp extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {id: "nunu-calendar-app", title: "Calendar", template: `modules/${ID}/templates/grid.hbs`,
      width: 780, height: "auto", resizable: true, classes: ["nunu-cal"]});
  }
  constructor() { super(); const d = getDate(); this.view = {y: d.y, m: d.m}; }
  static open() { CalendarApp._app ??= new CalendarApp(); CalendarApp._app.render(true); }
  static refresh() { if (CalendarApp._app?.rendered) CalendarApp._app.render(false); }
  getData() {
    const today = getDate(), viewer = {isGM: game.user.isGM, userId: game.user.id}, events = getEvents();
    const cells = monthCells(this.view.y, this.view.m).map((c) => c && {...c, key: key(c), today: same(c, today),
      events: eventsOn(events, c, viewer).map((e) => ({...e, gm: e.visibility === "gm", named: e.visibility === "users", range: Boolean(e.end)}))});
    return {gm: game.user.isGM, month: MONTHS[this.view.m - 1], year: this.view.y, weekdays: WEEKDAYS.map((w) => w.slice(0, 3)), cells, today: longDate(today)};
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-nav]").on("click", (ev) => {
      let m = this.view.m + Number(ev.currentTarget.dataset.nav), y = this.view.y;
      if (m < 1) { m = 12; y -= 1; } if (m > 12) { m = 1; y += 1; }
      this.view = {y, m}; this.render(false);
    });
    html.find("[data-today]").on("click", () => { const d = getDate(); this.view = {y: d.y, m: d.m}; this.render(false); });
    if (!game.user.isGM) return;
    html.find("[data-add]").on("click", (ev) => eventDialog({start: ev.currentTarget.dataset.add}).catch((e) => ui.notifications.error(e.message)));
    html.find("[data-edit]").on("click", (ev) => { ev.stopPropagation(); const e = getEvents().find((x) => x.id === ev.currentTarget.dataset.edit); if (e) eventDialog(e).catch((err) => ui.notifications.error(err.message)); });
  }
}

/* ------------------------------------------------------------------ */
/*  Add / edit an event (GM only)                                      */
/* ------------------------------------------------------------------ */
async function eventDialog(ev = {}) {
  const users = game.users.filter((u) => !u.isGM);
  const sel = (name, options, value) => `<select name="${name}">${options.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`).join("")}</select>`;
  const content = `<form class="nunu-cal-form">
    <label>Title<input name="title" value="${esc(ev.title)}" maxlength="120"></label>
    <div class="row"><label>Start (YYYY-MM-DD)<input name="start" value="${esc(ev.start)}" placeholder="2045-09-28"></label><label>End, optional<input name="end" value="${esc(ev.end)}" placeholder="for sessions that run days"></label></div>
    <div class="row"><label>Repeats ${sel("repeat", [["none", "Never"], ["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"]], ev.repeat ?? "none")}</label>
    <label>Who sees it ${sel("visibility", [["gm", "Only the GM"], ["all", "Everyone"], ["users", "Named players"]], ev.visibility ?? "gm")}</label></div>
    <div class="users">${users.map((u) => `<label class="check"><input type="checkbox" name="users" value="${u.id}"${(ev.users ?? []).includes(u.id) ? " checked" : ""}> ${esc(u.name)}</label>`).join("") || "<span class='hint'>No player users yet.</span>"}</div>
    <label>Notes<textarea name="notes" rows="3">${esc(ev.notes)}</textarea></label>
  </form>`;
  const read = (html) => normalizeEvent({id: ev.id, title: html.find('[name=title]').val(), start: html.find('[name=start]').val(), end: html.find('[name=end]').val(),
    repeat: html.find('[name=repeat]').val(), visibility: html.find('[name=visibility]').val(), users: html.find('[name=users]:checked').map((i, el) => el.value).get(), notes: html.find('[name=notes]').val()});
  const buttons = {
    save: {icon: '<i class="fas fa-check"></i>', label: "Save", callback: async (html) => {
      const data = read(html); const list = getEvents();
      if (data.id) { const i = list.findIndex((x) => x.id === data.id); if (i >= 0) list[i] = data; else list.push(data); }
      else { data.id = foundry.utils.randomID(); list.push(data); }
      await saveEvents(list);
    }},
    cancel: {icon: '<i class="fas fa-times"></i>', label: "Cancel"},
  };
  if (ev.id) buttons.delete = {icon: '<i class="fas fa-trash"></i>', label: "Delete", callback: async () => {
    if (await Dialog.confirm({title: "Delete event", content: `<p>Delete <b>${esc(ev.title)}</b>?</p>`})) await saveEvents(getEvents().filter((x) => x.id !== ev.id));
  }};
  return new Promise((resolve) => new Dialog({title: ev.id ? "Edit event" : "Add event", content, buttons, default: "save", close: () => resolve(),
    render: (html) => {
      const sync = () => html.find(".users").toggle(html.find('[name=visibility]').val() === "users");
      html.find('[name=visibility]').on("change", sync); sync();
    }}, {width: 520}).render(true));
}

/* ------------------------------------------------------------------ */
/*  Wiring                                                             */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(ID, "date", {scope: "world", config: false, type: Object, default: DEFAULT_DATE, onChange: () => { renderWidget(); CalendarApp.refresh(); }});
  game.settings.register(ID, "events", {scope: "world", config: false, type: Object, default: [], onChange: () => CalendarApp.refresh()});
  game.settings.register(ID, "seeded", {scope: "world", config: false, type: Boolean, default: false});
  loadTemplates([`modules/${ID}/templates/grid.hbs`]);
});
Hooks.once("ready", async () => {
  if (game.user.isGM && !game.settings.get(ID, "seeded")) {
    if (!(game.settings.get(ID, "events") ?? []).length) await saveEvents(SEED_EVENTS);
    await game.settings.set(ID, "seeded", true);
  }
  game.modules.get(ID).api = {getDate, setDate, advance, getEvents, longDate, shortDate, parse, open: CalendarApp.open};
  renderWidget();
});
Hooks.on("renderPlayerList", () => renderWidget());
