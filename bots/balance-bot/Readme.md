# Balance Bot

Start `Run-Balance-Bot.bat`. The terminal first asks for the mode:

- `S` starts the Survival Bot. It then asks for a world number from `000` to `999`. Press Enter to create a new world.
- `C` starts the Creative Bot immediately.

## Files

- `balance-bot.js`: small shared starter and mode selection
- `survival-bot.js`: visible browser bot with human controls
- `creative-bot.js`: headless rule simulation without browser, canvas, graphics, sound, camera, or UI
- `balance-bot-configuration.json`: settings for both bots
- `Run-Balance-Bot.bat`: common start file
- `world/`: read-only Survival world templates

## Reports

- `report/survival/`: Survival saves, status, metrics, and reports
- `report/creative/`: Creative simulation results and rankings

The complete `report/` directory is ignored by Git.

## Configuration

- `skill`: Survival playing quality from `1` to `100`
- `visibleWindow`: whether the Survival browser is visible
- `decisionIntervalMs`: Survival decision interval
- `softlockMinutes`: Survival timeout without progress
- `creativeStrategies`: number of Creative strategies; values below 100 are raised to 100
- `creativeMaxHours`: maximum simulated game time for each strategy
- `viewport`: Survival browser size
