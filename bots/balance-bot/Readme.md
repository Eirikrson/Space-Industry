# Balance Bot

The Balance Bot plays Space Industry through normal mouse and keyboard input while reading game state for balancing decisions.

## Files

The Balance Bot directory contains only:

- `balance-bot.js`
- `balance-bot-configuration.json`
- `Run-Balance-Bot.bat`
- `Readme.md`
- `archive/`

## Configuration

Edit `balance-bot-configuration.json`:

- `mode`: currently `survival`; `creative` is reserved for later.
- `skill`: playing quality from `1` to `100`.
- `visibleWindow`: whether the game browser is visible.
- `viewport`: initial visible window size and the fixed size used for invisible runs. A visible game resizes with its tab after startup.
- `decisionIntervalMs`: base time between decisions.
- `saveIntervalMs`: how often `save.json` is overwritten.
- `softlockMinutes`: time without progress before a softlock is reported.

Changing `visibleWindow` requires restarting the bot.

## Using The Visible Game Window

You may open the map, research window, pause menu, assembler window, turret window, build mode, and normal dialogs while the bot is playing. The bot pauses its controls and decisions until you close the window yourself. Windows opened by the bot for its own actions are still operated and closed by the bot.

If you enter build mode or edit a small ship, the bot waits until you close that editor. This prevents the bot from overwriting your changes.

While the Balance Bot is active, manual flight keys (`W`, `A`, `S`, `D`, `Q`, `E`, and Space) are ignored by the game. The bot can still use them through its own protected input channel. Map, research, menus, and other non-flight controls remain available.

The bot first builds an ore-based Laboratory, researches the Drill with ore, and mounts the ore-built Drill at the front. It then keeps one selected asteroid until it is empty or no longer exists.

During long flights the bot keeps accelerating while enough stopping distance remains, without an artificial upper target speed. It then brakes in one continuous phase instead of alternating between throttle and brake. The ship keeps its nose pointed toward the target and uses reverse thrust to slow down. It checks the route for planets, stars, and non-target asteroids and keeps a stable detour waypoint when the route is blocked. An asteroid approach only finishes after the Drill has actually acquired that asteroid.

The goal list keeps the complete production purpose visible. Travel and gathering steps are followed by processing, crafting, building, or research steps instead of replacing them. Below 30 fuel or 30 percent of fuel capacity, whichever is higher, restoring fuel production becomes the primary goal.

## Running

Start `Run-Balance-Bot.bat`. Stop it by closing its terminal or pressing Ctrl+C.

Every start creates:

```text
archive/
  2026-06-12T13-30-45-123+02-00/
    save.json
    report.md
    metrics.json
    status.json
```

The newest unfinished run is used as the save source. The new run still receives its own timestamped directory. Several bots can run simultaneously because every start writes to a separate directory.

Archive names use the computer's local time and include its UTC offset. For example, Swiss summer time is shown as `+02-00`.

## Browser Storage

The browser uses a temporary private profile that is discarded when the bot stops. Browser storage is cleared when the bot starts and stops, and the game's browser autosave is disabled. The authoritative bot save is always `save.json` in the run directory.

## Output

- `save.json`: current game save, overwritten at the configured interval
- `report.md`: readable balance report
- `metrics.json`: measurements and chronological events
- `status.json`: current decision and final result

There is no `control.json`. Pause and stop are handled through the terminal.
