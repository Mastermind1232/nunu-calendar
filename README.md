# NuNu Calendar

The NuNu campaign clock for Foundry VTT 12. Foundry owns "what day is it"; the vault mirrors it.

## What it does

- **Corner widget** above the player list: weekday, month, day and year, in the CPR sheet font. Click the date to open the calendar. The GM also gets three buttons: back one day, forward one day (both silent), and **+1 week**, which posts "A week passes. It is now Saturday, September 13th, 2045." to chat.
- **Month grid** with the campaign date outlined, previous and next month, a jump back to today. Events show as chips on their days.
- **Events** (GM only): title, start date, optional end date for sessions that run days, repeat never/weekly/monthly/yearly, and who sees it: only the GM (default, grey), everyone (colour), or named players (striped). Click a day to add, click an event to edit or delete.
- **Rent and lifestyle due** is pre-loaded on the 28th, monthly, visible to everyone.
- **Consequences.** An event can make something happen to the people it applies to when its day arrives: they pay a set amount (green Pay, red Don't pay; named players can each owe a different amount), they choose how much to pay (Jan and the mole), they receive eddies (Crane's stipend), or they receive items dropped onto the event. Popups wait until the player is online and a GM is there to apply them. Everything writes to the character sheet with a ledger line, and a receipt is whispered to the player and the GM.
- **Downtime.** After +1 week every player picks Rest up (heal BODY per day for seven days) or Hustle (d6 on their Role's table at their rank, eddies to the sheet). The outcome is posted in chat. If NuNu Headquarters is active, its Medbay and Morale healing bonus is added to rest, and its Morale Boost Hustle mode (roll twice keep the better, or keep both) is applied. **Salvage** is the third choice, from the *Salvaging Night City* DLC. The player either names a category of goods or takes whatever they can find, then makes a Basic Tech Check through CPR's own skill roll, so the system's roll dialog, their Luck, wound state, armor penalties, role mods and Active Effects all count and they get the usual roll card. The Check is read off the Salvage Worth table and the eddie value of the haul is posted to chat, to be spent on real items with the GM: everything salvaged is Destroyed until repaired, and unspent worth is lost. A Critical Failure rolls the Perils of Salvaging table instead, along with its 6d6 or its rounds of exposure, but nothing is applied to the sheet, because the damage is reduced by armor and peril 1 carries a Critical Injury. Roll that from the character sheet's own Roll Critical Injury control.
- **Map pins always on.** Turns Foundry's per-client "Display Notes" setting on for every user at login, so journal pins show on every scene without anyone finding the toggle.
- **API** for other modules: `game.modules.get("nunu-calendar").api` has `getDate`, `setDate`, `advance`, `getEvents`, `longDate`, `open`. Hooks: `nunuCalendar.dateChanged` and `nunuCalendar.weekPassed`.

Disable SmallTime; this takes its corner.

## Install and update

Install by manifest URL:

```
https://raw.githubusercontent.com/Mastermind1232/nunu-calendar/main/module.json
```

New versions are GitHub releases with a `module.zip`; Foundry's Update button picks them up.

## Roadmap

- Reading the date from the HQ sheet for monthly checks.

## Tests

```
node --test tests/*.test.mjs
```
