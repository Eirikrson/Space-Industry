# Balance Bot

The Balance Bot plays Space Industry through normal mouse and keyboard input while reading game state for balancing decisions.

## Files

The Balance Bot directory contains only:

- `balance-bot.js`
- `balance-bot-configuration.json`
- `Run-Balance-Bot.bat`
- `Readme.md`
- `world/`
- `report/`

## Configuration

Edit `balance-bot-configuration.json`:

- `skill`: playing quality from `1` to `100`.
- `visibleWindow`: whether the game browser is visible.
- `viewport`: initial visible window size and the fixed size used for invisible runs. A visible game resizes with its tab after startup.
- `decisionIntervalMs`: base time between decisions.
- `softlockMinutes`: time without progress before a softlock is reported.

Changing `visibleWindow` requires restarting the bot.

## Using The Visible Game Window

You may open the map, research window, pause menu, assembler window, turret window, build mode, and normal dialogs while the bot is playing. The bot pauses its controls and decisions until you close the window yourself. Windows opened by the bot for its own actions are still operated and closed by the bot.

If you enter build mode or edit a small ship, the bot waits until you close that editor. This prevents the bot from overwriting your changes.

While the Balance Bot is active, manual flight keys (`W`, `A`, `S`, `D`, `Q`, `E`, and Space) are ignored by the game. The bot can still use them through its own protected input channel. Map, research, menus, and other non-flight controls remain available.

The bot first builds an ore-based Laboratory, researches the Drill with ore, and mounts the ore-built Drill at the front. It then keeps one selected asteroid until it is empty or no longer exists.

During asteroid flights the bot uses a limited safe cruising speed, coasts between short thrust phases, brakes early, and performs the final approach very slowly. The ship keeps its nose pointed toward the target and uses reverse thrust to slow down. It checks the route for planets, stars, and non-target asteroids and keeps a stable detour waypoint when the route is blocked. An asteroid approach only finishes after the Drill has actually acquired that asteroid.

The goal list keeps the complete production purpose visible. Travel and gathering steps are followed by processing, crafting, building, or research steps instead of replacing them. Below 30 fuel or 30 percent of fuel capacity, whichever is higher, restoring fuel production becomes the primary goal.

## Running

Start `Run-Balance-Bot.bat`. First enter an existing three-digit template number such as `007`, or press Enter to generate a completely new world without a template. Then enter `s` for Survival or `c` for Creative. Creative is not implemented yet, so choosing it displays a message and asks for the mode again.

World templates are stored in `world/`. `NNN.json` is a reusable example and is not treated as a numbered world:

```text
world/
  NNN.json
  000.json
  001.json
  007.json
```

Run data and evaluations are stored in `report/`:

```text
report/
  2026-06-12T13-30-45-123+02-00-007/
    save.json
    metrics.json
    status.json
    report.md  (only when requested at the end)
```

Files in `world/` are read-only templates for the bots. When a number is selected, that template is copied to the new session directory as `save.json`. The bot loads and overwrites only this session copy every minute and once more when it stops. This allows several bots to start independently from the same world template. If fuel and water both reach zero, the run fails immediately.

Successful, failed, softlocked, destroyed, and errored runs always create `report.md`. Closing the game browser or stopping manually with Ctrl+C writes a message to the terminal and asks whether a balance evaluation should be kept. Enter `j` to keep the session directory and report. Pressing Enter or answering no deletes only the session directory. Files in `world/`, including `NNN.json`, are never changed or deleted by a bot.

The report records all resources, buildings, research, and previous play time present when the template is loaded. Material timings state whether the required items were already available at startup or were earned during the run.

Session names use the computer's local time and include its UTC offset. For example, Swiss summer time is shown as `+02-00`.

## Browser Storage

The browser uses a temporary private profile that is discarded when the bot stops. Browser storage is cleared when the bot starts and stops, and the game's browser autosave is disabled. The bot's writable save is always `save.json` inside its session directory.

## Output

- `world/NNN.json`: template world
- `world/000.json` to `world/999.json`: read-only world templates
- `report/<session>/save.json`: writable session copy, overwritten every minute
- `report.md`: readable balance report, always created for completed or failed runs and optionally kept after a manual stop
- `metrics.json`: measurements and chronological events
- `status.json`: current decision and final result

There is no `control.json`. Pause and stop are handled through the terminal.
