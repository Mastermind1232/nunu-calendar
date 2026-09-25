import {ID, DEFAULT_DATE, SEED_EVENTS, MONTHS, WEEKDAYS, EFFECT_LABELS, addDays, longDate, shortDate, parse, key, isDate, same, normalizeEvent, eventsOn, monthCells, daysBetween, dueOn, downtimeRecords, LIFESTYLE_COST, mergeQueue, hustleResult, HUSTLES, ROLE_BY_ABILITY} from "./lib.mjs";

const SOCKET = `module.${ID}`;

/* ------------------------------------------------------------------ */
/*  State: two world settings, the date and the event list             */
/* ------------------------------------------------------------------ */
export const getDate = () => { const v = game.settings.get(ID, "date"); return isDate(v) ? v : DEFAULT_DATE; };
export const getEvents = () => (game.settings.get(ID, "events") ?? []).map((e) => { try { return normalizeEvent(e); } catch { return null; } }).filter(Boolean);
async function saveEvents(list) { await game.settings.set(ID, "events", list); }

export async function setDate(date, announce = "") {
  if (!game.user.isGM) throw new Error("Only the GM moves the calendar.");
  if (!isDate(date)) throw new Error("That is not a valid date.");
  const before = getDate();
  await game.settings.set(ID, "date", date);
  const due = daysBetween(before, date).flatMap((d) => dueOn(getEvents(), d, playerUsers()));
  if (due.length) await enqueue(due);
  if (announce) await ChatMessage.create({content: `<div class="nunu-cal-chat"><i class="fas fa-calendar-days"></i> ${announce}</div>`, speaker: {alias: "Calendar"}});
  Hooks.callAll("nunuCalendar.dateChanged", date);
  return date;
}
/** +1 and -1 are silent. +7 announces and fires nunuCalendar.weekPassed for the downtime prompts. */
export async function advance(days) {
  const next = addDays(getDate(), days);
  await setDate(next, days === 7 ? `A week passes. It is now ${longDate(next)}.` : "");
  if (days === 7) { await enqueue(downtimeRecords(next, playerUsers())); Hooks.callAll("nunuCalendar.weekPassed", next); }
  return next;
}

/* ------------------------------------------------------------------ */

/* ---------------- Rent and lifestyle ---------------- */
/** What a character owes this month, read from the housing and lifestyle set on their Agent ID.
    The Agent stores these as flags on the character, falling back to the user for older worlds. */
/** The character the Agent is actually showing for this user: the phone tracks a last-used
    actor, which is where it writes housing, and only falls back to the assigned character. */
function agentActor(user) {
  try {
    const uuid = user?.getFlag?.("VirtualAgent", "lastActorUuid");
    const a = uuid ? fromUuidSync(uuid) : null;
    if (a?.documentName === "Actor") return a;
  } catch (e) { /* a stale uuid is not worth an error */ }
  return user?.character ?? null;
}

function rentBill(actor, user) {
  const flag = (k) => actor?.getFlag?.("VirtualAgent", k) || user?.getFlag?.("VirtualAgent", k) || "";
  const housing = String(flag("housingStatus"));
  const rent = Math.max(0, Math.floor(Number(String(flag("housingRent")).replace(/[^0-9.]/g, "")) || 0));
  const food = String(flag("lifestyle"));
  const foodCost = Math.max(0, Math.floor(Number(LIFESTYLE_COST[food]) || 0));
  return {housing, rent, food, foodCost, total: rent + foodCost, set: !!(housing || food)};
}

/*  The queue: things owed to players, kept until they answer          */
/* ------------------------------------------------------------------ */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export const playerUsers = () => game.users.filter((u) => !u.isGM && u.character).map((u) => ({id: u.id, name: u.name}));
const getQueue = () => game.settings.get(ID, "queue") ?? [];
async function enqueue(records) {
  // Records already settled never come back, so stepping the date over the 28th twice
  // cannot bill the same month again.
  let done = [];
  try { done = game.settings.get(ID, "settled") ?? []; } catch (e) { done = []; }
  const fresh = records.filter((r) => !done.includes(r.id));
  if (fresh.length) await game.settings.set(ID, "queue", mergeQueue(getQueue(), fresh));
}
async function markSettled(id) {
  let done = [];
  try { done = game.settings.get(ID, "settled") ?? []; } catch (e) { done = []; }
  if (done.includes(id)) return;
  await game.settings.set(ID, "settled", [...done, id].slice(-400));
}
async function dequeue(id) {
  await markSettled(id); await game.settings.set(ID, "queue", getQueue().filter((r) => r.id !== id)); }
const activeGM = () => game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0];
const whisper = (content, userIds) => ChatMessage.create({content, whisper: userIds, speaker: {alias: "Calendar"}});

function moneyUpdate(actor, delta, reason) {
  const w = actor.system.wealth;
  if (!Number.isSafeInteger(w?.value) || !Array.isArray(w.transactions)) throw new Error(`${actor.name} has no Eurobucks ledger.`);
  const value = w.value + delta;
  if (value < 0) throw new Error(`${actor.name} has ${w.value}eb, not enough for ${-delta}eb.`);
  return {"system.wealth.value": value, "system.wealth.transactions": [...w.transactions.map((r) => [...r]), [`${delta >= 0 ? "Increased" : "Decreased"} wealth by ${Math.abs(delta)} to ${value}.`, reason]]};
}
function actorRoles(actor) {
  return actor.items.filter((i) => i.type === "role").map((i) => {
    const byName = String(i.name).trim().toLowerCase(), key = HUSTLES[byName] ? byName : ROLE_BY_ABILITY[String(i.system?.mainRoleAbility ?? "").trim().toLowerCase()];
    return key ? {id: i.id, key, name: i.name, rank: Number(i.system?.rank) || 0} : null;
  }).filter((r) => r && r.rank >= 1);
}

/** Runs on the GM's client when a player answers a popup. Applies the result to their character, then clears the record. */
async function resolve(msg, user) {
  const rec = getQueue().find((r) => r.id === msg.id && r.userId === user.id);
  if (!rec) return;
  const actor = user.character;
  if (!actor) throw new Error(`${user.name} has no assigned character.`);
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  const receipt = (text) => whisper(`<div class="nunu-cal-chat"><i class="fas fa-calendar-days"></i> ${text}</div>`, [...gmIds, user.id]);
  if (rec.kind === "pay" || rec.kind === "ask") {
    const amount = rec.kind === "ask" ? Math.max(0, Math.floor(Number(msg.amount) || 0)) : rec.amount;
    if (msg.choice !== "pay" || amount <= 0) { await receipt(`<b>${esc(actor.name)}</b> did not pay for ${esc(rec.title)}.`); }
    else { await actor.update(moneyUpdate(actor, -amount, `${rec.reason} (${rec.date})`)); await receipt(`<b>${esc(actor.name)}</b> paid ${amount}eb: ${esc(rec.reason)}.`); }
  } else if (rec.kind === "rent") {
    // Recomputed here rather than trusted from the client, so the bill is always the sheet's.
    const billed = agentActor(user) ?? actor;
    const bill = rentBill(billed, user);
    const wallet = Math.max(0, Math.floor(Number(billed.system?.wealth?.value) || 0));
    const owed = bill.total;
    if (!bill.set || owed <= 0) { await receipt(`<b>${esc(billed.name)}</b> has no housing or lifestyle on file, so nothing was charged.`); }
    else if (msg.choice !== "pay") { await receipt(`<b>${esc(actor.name)}</b> <span style="color:#e06666">did not pay rent this month.</span>`); }
    else {
      const paid = Math.min(owed, wallet);
      if (paid > 0) await billed.update(moneyUpdate(billed, -paid, `Rent and lifestyle (${rec.date})`));
      await receipt(paid >= owed
        ? `<b>${esc(billed.name)}</b> paid <b>${paid.toLocaleString()}eb</b> for rent and lifestyle.`
        : `<b>${esc(billed.name)}</b> paid <b>${paid.toLocaleString()}eb</b> of <b>${owed.toLocaleString()}eb</b>. <span style="color:#e06666">${(owed - paid).toLocaleString()}eb short.</span>`);
    }
  } else if (rec.kind === "credit") {
    await actor.update(moneyUpdate(actor, rec.amount, `${rec.reason} (${rec.date})`));
    await receipt(`<b>${esc(actor.name)}</b> received ${rec.amount}eb: ${esc(rec.reason)}.`);
  } else if (rec.kind === "items") {
    const docs = [];
    for (const it of rec.items) {
      const src = await fromUuid(it.uuid).catch(() => null);
      if (!src) throw new Error(`Item not found: ${it.name}. Fix the event's items.`);
      const data = src.toObject(); delete data._id; if (data.system && "amount" in data.system) data.system.amount = it.qty;
      docs.push(data);
    }
    await actor.createEmbeddedDocuments("Item", docs);
    await receipt(`<b>${esc(actor.name)}</b> received ${rec.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${esc(i.name)}`).join(", ")}: ${esc(rec.reason)}.`);
  } else if (rec.kind === "downtime") {
    const hqApi = game.modules.get("nunu-headquarters")?.api;
    if (msg.choice === "rest") {
      const bonus = Number(hqApi?.healingBonus?.() ?? 0) || 0;
      const body = actor.system.stats.body.value, hp = actor.system.derivedStats.hp;
      const healed = Math.max(0, Math.min((body + bonus) * 7, hp.max - hp.value));
      if (healed) await actor.update({"system.derivedStats.hp.value": hp.value + healed});
      await ChatMessage.create({content: `<div class="nunu-cal-chat"><b>${esc(actor.name)}</b> chose to rest for the week.${healed ? ` Recovered ${healed} HP${bonus ? ` (BODY +${bonus} from the HQ)` : ""}.` : ""}</div>`, speaker: {alias: "Calendar"}});
    } else {
      const role = actorRoles(actor).find((r) => r.id === msg.roleId) ?? actorRoles(actor)[0];
      if (!role) throw new Error(`${actor.name} has no Role with a rank to hustle with.`);
      const mode = hqApi?.hustleMode?.() ?? "single";
      const results = [];
      for (let i = 0; i < (mode === "single" ? 1 : 2); i++) {
        const roll = await new Roll("1d6").evaluate();
        await roll.toMessage({speaker: ChatMessage.getSpeaker({actor}), flavor: `Hustle: ${role.name} rank ${role.rank}${mode === "single" ? "" : ` (roll ${i + 1}, HQ Morale Boost)`}`});
        results.push(hustleResult(role.key, Math.min(10, role.rank), Number(roll.total)));
      }
      const kept = mode === "both" ? results : [results.reduce((a, b) => (b.amount > a.amount ? b : a))];
      const amount = kept.reduce((n, r) => n + r.amount, 0);
      if (amount) await actor.update(moneyUpdate(actor, amount, `Hustle, ${role.name}: ${kept.map((r) => r.text).join("; ")}`));
      const story = kept.map((r) => esc(r.text)).join(", and ");
      await ChatMessage.create({content: `<div class="nunu-cal-chat"><b>${esc(actor.name)}</b> chose to hustle this week. They ${story}${amount ? ` and earned <b>${amount}eb</b>` : " and earned nothing"}.</div>`, speaker: {alias: "Calendar"}});
    }
  }
  await dequeue(rec.id);
}

/* Player side: show one pending popup at a time, only while a GM is online to apply it. */
const shown = new Set();
function showPending() {
  if (!game.ready || game.user.isGM) return;
  const rec = getQueue().find((r) => r.userId === game.user.id && !shown.has(r.id));
  if (!rec) return;
  if (!activeGM()) { ui.notifications.info("The calendar has something for you. It will appear when the GM is online."); return; }
  shown.add(rec.id);
  const send = (extra) => { game.socket.emit(SOCKET, {type: "resolve", id: rec.id, userId: game.user.id, ...extra}); };
  const wrap = (body) => `<div class="nunu-cal-prompt"><p class="when">${esc(rec.date)}</p>${body}</div>`;
  let content, buttons;
  if (rec.kind === "pay") {
    content = wrap(`<h3>${esc(rec.title)}</h3><p>Pay <b>${rec.amount}eb</b>? ${esc(rec.reason)}</p>`);
    buttons = {pay: {label: `Pay ${rec.amount}eb`, callback: () => send({choice: "pay"})}, skip: {label: "Don't pay", callback: () => send({choice: "skip"})}};
  } else if (rec.kind === "ask") {
    content = wrap(`<h3>${esc(rec.title)}</h3><p>${esc(rec.reason)}</p><label>How much do you pay?<input name="amount" type="number" min="0" step="1" value="${rec.amount || 0}"></label>`);
    buttons = {pay: {label: "Pay", callback: (html) => send({choice: "pay", amount: Number(html.find('[name=amount]').val())})}, skip: {label: "Don't pay", callback: () => send({choice: "skip"})}};
  } else if (rec.kind === "credit") {
    content = wrap(`<h3>${esc(rec.title)}</h3><p>You receive <b>${rec.amount}eb</b>. ${esc(rec.reason)}</p>`);
    buttons = {pay: {label: "Collect", callback: () => send({choice: "collect"})}};
  } else if (rec.kind === "items") {
    content = wrap(`<h3>${esc(rec.title)}</h3><p>${esc(rec.reason)}</p><ul>${rec.items.map((i) => `<li>${i.qty > 1 ? `${i.qty}× ` : ""}${esc(i.name)}</li>`).join("")}</ul>`);
    buttons = {pay: {label: "Collect", callback: () => send({choice: "collect"})}};
  } else if (rec.kind === "rent") {
    const actor = agentActor(game.user);
    const bill = rentBill(actor, game.user);
    const wallet = Math.max(0, Math.floor(Number(actor?.system?.wealth?.value) || 0));
    const line = (label, detail, amount) =>
      `<tr><td class="what">${label}<small>${esc(detail || "Nothing on file")}</small></td><td class="amt">${amount === null ? "&mdash;" : `${amount.toLocaleString()}eb`}</td></tr>`;
    const table = `<table class="bill">${line("Housing", bill.housing, bill.set ? bill.rent : null)}${line("Lifestyle", bill.food, bill.set ? bill.foodCost : null)}<tr class="total"><td class="what">Due</td><td class="amt">${bill.set ? `${bill.total.toLocaleString()}eb` : "&mdash;"}</td></tr></table>`;

    if (!bill.set || bill.total <= 0) {
      content = wrap(`<h3>${esc(rec.title)}</h3>${table}<p class="wallet">Ask your GM to set where you live and what you eat.</p>`);
      buttons = {skip: {label: "Close", callback: () => send({choice: "skip"})}};
    } else {
      const short = wallet < bill.total;
      content = wrap(`<h3>${esc(rec.title)}</h3>${table}<p class="wallet${short ? " short" : ""}">You have ${wallet.toLocaleString()}eb.${short ? ` You are ${(bill.total - wallet).toLocaleString()}eb short.` : ""}</p>`);
      buttons = {
        pay: {label: short ? `Pay what I have` : `Pay ${bill.total.toLocaleString()}eb`, callback: () => send({choice: "pay"})},
        skip: {label: "Don't pay", callback: () => send({choice: "skip"})},
      };
    }
  } else if (rec.kind === "downtime") {
    const roles = game.user.character ? actorRoles(game.user.character) : [];
    const pick = roles.length > 1 ? `<label>Hustle as<select name="role">${roles.map((r) => `<option value="${r.id}">${esc(r.name)} · rank ${r.rank}</option>`).join("")}</select></label>` : "";
    content = wrap(`<h3>A week passes</h3><p><b>Rest up:</b> recover HP equal to your BODY for each of the seven days.</p><p><b>Hustle:</b> roll on your Role's Hustle table and earn what the week brings.</p>${pick}`);
    buttons = {rest: {icon: '<i class="fas fa-bed"></i>', label: "Rest up", callback: () => send({choice: "rest"})},
      hustle: {icon: '<i class="fas fa-coins"></i>', label: "Hustle", callback: (html) => send({choice: "hustle", roleId: html.find('[name=role]').val() ?? roles[0]?.id})}};
  } else { shown.delete(rec.id); return; }
  new Dialog({title: rec.kind === "downtime" ? "Downtime" : "The Calendar", content, buttons, close: () => { shown.delete(rec.id); }}, {classes: ["dialog", "nunu-cal-dialog"], width: 440}).render(true);
}

/* ------------------------------------------------------------------ */
/*  The corner widget, sitting just above the player list              */
/* ------------------------------------------------------------------ */
/* The Agent phone: a floating button beside the calendar that opens Virtual Agent, with its unread count. Only when that module is on. */
function unreadTexts() {
  // The Agent publishes its own total, filtered to threads that still exist. Summing the
  // raw flag here instead would count messages for contacts somebody has deleted, which
  // the phone hides and nothing can clear, leaving a badge that never goes away.
  if (typeof globalThis.VirtualAgentUnreadTotal === "function") {
    try { return globalThis.VirtualAgentUnreadTotal(); } catch (e) { /* fall through */ }
  }
  const u = game.user.getFlag("VirtualAgent", "unreads") ?? {};
  return Object.values(u).reduce((a, n) => a + (Number(n) > 0 ? Number(n) : 0), 0);
}
function renderPhone() {
  const row = document.getElementById("nunu-cal-row");
  if (!row) return;
  let btn = document.getElementById("nunu-phone-btn");
  const on = game.modules.get("VirtualAgent")?.active && globalThis.AgentDeviceApp?.ui;
  if (!on) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement("button"); btn.type = "button"; btn.id = "nunu-phone-btn"; btn.title = "Open your Agent";
    btn.addEventListener("click", () => globalThis.AgentDeviceApp.ui.render(true));
    row.appendChild(btn);
  }
  const n = unreadTexts();
  btn.innerHTML = `<i class="fas fa-mobile-alt"></i>${n ? `<span class="badge">${n > 9 ? "9+" : n}</span>` : ""}`;
  btn.classList.toggle("ringing", n > 0);
}
function renderWidget() {
  if (!game.ready) return;
  const date = getDate(), gm = game.user.isGM;
  let el = document.getElementById("nunu-cal-widget");
  if (!el) {
    const row = document.createElement("div"); row.id = "nunu-cal-row";
    el = document.createElement("div"); el.id = "nunu-cal-widget";
    row.appendChild(el);
    const players = document.getElementById("players");
    const host = players?.parentElement ?? document.getElementById("ui-left") ?? document.body;
    host.insertBefore(row, players ?? null);
  }
  renderPhone();
  el.innerHTML = `<button type="button" class="date" title="Open the calendar"><i class="fas fa-calendar-days"></i><span>${esc(longDate(date))}</span></button>` +
    (gm ? `<div class="ctrl"><button type="button" data-adv="1" title="Forward one day"><i class="fas fa-chevron-right"></i></button><button type="button" class="week" data-adv="7" title="A week passes">+1 week</button></div>` : "");
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
    <div class="users">${users.map((u) => `<label class="check"><input type="checkbox" name="users" value="${u.id}"${(ev.users ?? []).includes(u.id) ? " checked" : ""}> ${esc(u.name)}<input class="per" type="number" min="0" step="1" name="amount-${u.id}" value="${ev.amounts?.[u.id] ?? ""}" placeholder="eb" title="Amount for this player; blank uses the shared amount"></label>`).join("") || "<span class='hint'>No player users yet.</span>"}</div>
    <fieldset class="effect"><legend>When the day comes</legend>
      <label>What happens ${sel("effect", Object.entries(EFFECT_LABELS), ev.effect ?? "none")}</label>
      <div class="row eddies"><label>Eddies<input name="amount" type="number" min="0" step="1" value="${ev.amount ?? 0}"></label><label>Ledger reason<input name="reason" value="${esc(ev.reason)}" placeholder="Rent, September 2045"></label></div>
      <div class="items"><p class="hint">Drag items here from the Items tab or a compendium.</p><ul class="item-list">${(ev.items ?? []).map((i) => `<li data-uuid="${esc(i.uuid)}"><span>${esc(i.name)}</span> × <input type="number" min="1" step="1" value="${i.qty}" class="qty"> <a class="remove" title="Remove"><i class="fas fa-times"></i></a></li>`).join("")}</ul></div>
    </fieldset>
    <label>Notes<textarea name="notes" rows="3">${esc(ev.notes)}</textarea></label>
  </form>`;
  const read = (html) => normalizeEvent({id: ev.id, title: html.find('[name=title]').val(), start: html.find('[name=start]').val(), end: html.find('[name=end]').val(),
    repeat: html.find('[name=repeat]').val(), visibility: html.find('[name=visibility]').val(), users: html.find('[name=users]:checked').map((i, el) => el.value).get(), notes: html.find('[name=notes]').val(),
    effect: html.find('[name=effect]').val(), amount: html.find('[name=amount]').val(), reason: html.find('[name=reason]').val(),
    amounts: Object.fromEntries(html.find('.users .per').map((i, el) => [[el.name.replace("amount-", ""), el.value]]).get()),
    items: html.find('.item-list li').map((i, li) => ({uuid: li.dataset.uuid, name: li.querySelector("span").textContent, qty: li.querySelector(".qty").value})).get()});
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
      const sync = () => {
        html.find(".users").toggle(html.find('[name=visibility]').val() === "users");
        const effect = html.find('[name=effect]').val();
        html.find(".eddies").toggle(["pay", "ask", "credit"].includes(effect)); html.find(".items").toggle(effect === "items");
        html.find(".users .per").toggle(["pay", "credit"].includes(effect));
        html.find(".effect").toggleClass("blocked", effect !== "none" && html.find('[name=visibility]').val() === "gm");
      };
      html.find('[name=visibility], [name=effect]').on("change", sync); sync();
      html.find(".items").on("click", ".remove", (e) => e.currentTarget.closest("li").remove());
      const zone = html.find(".items")[0];
      zone.addEventListener("dragover", (e) => e.preventDefault());
      zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        const data = TextEditor.getDragEventData(e);
        if (data?.type !== "Item" || !data.uuid) return ui.notifications.warn("Drop an item.");
        const item = await fromUuid(data.uuid).catch(() => null);
        if (!item) return ui.notifications.warn("That item could not be read.");
        html.find(".item-list").append(`<li data-uuid="${esc(item.uuid)}"><span>${esc(item.name)}</span> × <input type="number" min="1" step="1" value="1" class="qty"> <a class="remove" title="Remove"><i class="fas fa-times"></i></a></li>`);
      });
    }}, {width: 560}).render(true));
}

/* ------------------------------------------------------------------ */
/*  Wiring                                                             */
/* ------------------------------------------------------------------ */
Hooks.once("init", () => {
  game.settings.register(ID, "date", {scope: "world", config: false, type: Object, default: DEFAULT_DATE, onChange: () => { renderWidget(); CalendarApp.refresh(); }});
  game.settings.register(ID, "events", {scope: "world", config: false, type: Object, default: [], onChange: () => CalendarApp.refresh()});
  game.settings.register(ID, "seeded", {scope: "world", config: false, type: Boolean, default: false});
  game.settings.register(ID, "rentSeeded", {scope: "world", config: false, type: Boolean, default: false});
  game.settings.register(ID, "settled", {scope: "world", config: false, type: Array, default: []});
  game.settings.register(ID, "queue", {scope: "world", config: false, type: Object, default: [], onChange: () => showPending()});
  loadTemplates([`modules/${ID}/templates/grid.hbs`]);
});
Hooks.once("ready", async () => {
  if (game.user.isGM && !game.settings.get(ID, "seeded")) {
    if (!(game.settings.get(ID, "events") ?? []).length) await saveEvents(SEED_EVENTS);
    await game.settings.set(ID, "seeded", true);
  }
  // Seed events only land in a world that has never been seeded. Rent arrived in 1.2.0,
  // after this world was already running, so without this backfill the 28th passes with
  // nothing on the calendar to bill and rent day can never fire. Added once; a GM who
  // deletes it keeps it deleted.
  if (game.user.isGM && !game.settings.get(ID, "rentSeeded")) {
    const events = game.settings.get(ID, "events") ?? [];
    const seed = SEED_EVENTS.find((e) => e.effect === "rent");
    if (seed && !events.some((e) => e.effect === "rent")) await saveEvents([...events, seed]);
    await game.settings.set(ID, "rentSeeded", true);
  }
  game.modules.get(ID).api = {getDate, setDate, advance, getEvents, getQueue, longDate, shortDate, parse, open: CalendarApp.open};
  game.socket.on(SOCKET, async (msg) => {
    if (msg?.type === "reply") { if (msg.userId === game.user.id) { ui.notifications.warn(msg.text, {permanent: true}); shown.delete(msg.id); } return; }
    if (msg?.type !== "resolve" || activeGM()?.id !== game.user.id) return;
    const user = game.users.get(msg.userId);
    if (!user) return;
    try { await resolve(msg, user); }
    catch (e) { ui.notifications.error(`${user.name}: ${e.message}`); game.socket.emit(SOCKET, {type: "reply", userId: user.id, id: msg.id, text: e.message}); }
  });
  renderWidget();
  showPending();
});
Hooks.on("userConnected", () => showPending());

/* Map pins on for everyone: Foundry stores "Display Notes" per client. Turn it on once per browser so nobody has to find the toggle. */
Hooks.once("ready", async () => {
  try {
    const key = foundry.canvas?.layers?.NotesLayer?.TOGGLE_SETTING ?? globalThis.NotesLayer?.TOGGLE_SETTING ?? "notesDisplayToggle";
    if (game.settings.settings.has(`core.${key}`) && !game.settings.get("core", key)) {
      await game.settings.set("core", key, true);
      if (canvas?.ready) canvas.notes?.draw?.();
    }
  } catch (e) { console.warn(`${ID} | could not turn on Display Notes`, e); }
});
Hooks.on("renderPlayerList", () => renderWidget());
Hooks.on("updateUser", (user, changes) => { if (user.id === game.user.id && changes.flags?.VirtualAgent) renderPhone(); });
Hooks.on("createChatMessage", (m) => { if (m.flags?.VirtualAgent?.isAgentMessage) setTimeout(renderPhone, 300); });
