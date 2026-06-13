# Space Industry Bots

Every bot has its own directory under `bots/`.

A bot directory owns its:

- Entry scripts and launchers
- Bot-specific configuration and test inputs
- Generated reports, measurements, and logs
- Documentation needed to run or maintain the bot

Keep shared game code outside `bots/`. Add a new sibling directory for each new bot instead of extending another bot's directory.

## Available Bots

### Performance Bot

Directory: `bots/performance-bot`

Windows launcher: `bots/performance-bot/Run-Performance-Bot.bat`

The Performance Bot runs automated gameplay and interface scenarios, checks selected behavior, and records performance measurements.

### Balance Bot

Directory: `bots/balance-bot`

Windows launcher: `bots/balance-bot/Run-Balance-Bot.bat`

The Balance Bot plays through normal mouse and keyboard input, records progression and resource bottlenecks, and stores each run in a timestamped archive directory. Its current `survival` mode stops on victory, destruction, fuel softlock, or prolonged lack of progress.
