# NuNu Calendar

The NuNu campaign clock for Foundry VTT 12. Foundry owns "what day is it"; the vault mirrors it.

## What it does

- **Corner widget** above the player list: weekday, month, day and year, in the CPR sheet font. Click the date to open the calendar. The GM also gets three buttons: back one day, forward one day (both silent), and **+1 week**, which posts "A week passes. It is now Saturday, September 13th, 2045." to chat.
- **Month grid** with the campaign date outlined, previous and next month, a jump back to today. Events show as chips on their days.
- **Events** (GM only): title, start date, optional end date for sessions that run days, repeat never/weekly/monthly/yearly, and who sees it: only the GM (default, grey), everyone (colour), or named players (striped). Click a day to add, click an event to edit or delete.
- **Rent and lifestyle due** is pre-loaded on the 28th, monthly, visible to everyone.
- **API** for other modules: `game.modules.get("nunu-calendar").api` has `getDate`, `setDate`, `advance`, `getEvents`, `longDate`, `open`. Hooks: `nunuCalendar.dateChanged` and `nunuCalendar.weekPassed`.

Disable SmallTime; this takes its corner.

## Install and update

Install by manifest URL:

```
https://raw.githubusercontent.com/Mastermind1232/nunu-calendar/main/module.json
```

New versions are GitHub releases with a `module.zip`; Foundry's Update button picks them up.

## Roadmap

- v1.1: on +1 week, each player picks Rest (heal BODY per day for seven days) or Hustle (d6 on their Role's table at current rank), with the outcome in chat.
- Reading the date from the HQ sheet for monthly checks.

## Tests

```
node --test tests/*.test.mjs
```
