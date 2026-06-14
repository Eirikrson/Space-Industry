# Balance Bot

Start `Run-Balance-Bot.bat`. The terminal first asks for the mode:

- `S` starts the Survival Bot. It then asks for a world number from `000` to `999`. Press Enter to create a new world.
- `C` starts the Creative Bot immediately.
- `M` starts the headless Meta Bot. It searches action chains directly against the game rules and creates a meta report.

## Files

- `balance-bot.js`: small shared starter and mode selection
- `survival-bot.js`: visible browser bot with human controls
- `creative-bot.js`: headless rule simulation without browser, canvas, graphics, sound, camera, or UI
- `meta-bot.js`: deterministic look-ahead strategy search and evolutionary meta analysis
- `balance-bot-configuration.json`: settings for both bots
- `Run-Balance-Bot.bat`: common start file
- `world/`: read-only Survival world templates

## Reports

- `report/survival/`: Survival saves, status, metrics, and reports
- `report/creative/`: Creative simulation results and rankings
- `report/meta/`: Meta search results, action histories, metrics, and balancing reports

Each Meta run contains `meta-report.md`, `meta-analysis.json`,
`best-strategy.json`, `metrics.json`, and `simulations.json`. The simulations
file preserves every tested action sequence and its resource and energy
development.

The complete `report/` directory is ignored by Git.

## Configuration

- `skill`: Survival playing quality from `1` to `100`
- `visibleWindow`: whether the Survival browser is visible
- `decisionIntervalMs`: Survival decision interval
- `softlockMinutes`: Survival timeout without progress
- `creativeStrategies`: number of Creative strategies; values below 100 are raised to 100
- `creativeMaxHours`: maximum simulated game time for each strategy
- `metaStrategies`: number of strategy genomes tested per generation
- `metaGenerations`: number of learning generations
- `metaSearchDepth`: number of future actions considered at each decision
- `metaBeamWidth`: number of promising action chains retained at each depth
- `metaMaxDecisions`: maximum decisions in one simulated game
- `metaMaxHours`: maximum simulated game time in one Meta run
- `viewport`: Survival browser size

## Creative Simulation Scope

The default 120 strategies are 20 deterministic variations of each of six
play styles: energy, mining, research, balanced, maximum expansion, and
minimum expansion. They are simulations, not 120 browser windows.

Creative mode simulates production recipes, asteroid mining trips, research,
first-build timings, building costs, power, fuel, crew supplies, storage
pressure, defensive ammunition, repairs, mining drones, planet resource
income, and the black-hole requirements. It researches the complete
technology tree and builds at least one building of every unlocked type.
Gun, cannon, railgun, missile, and laser turrets are all built and operated.
Their individual ammunition or energy use and the resulting ship repairs are
included in the simulated resource demand.

The simulation keeps a strategic fuel reserve, produces fuel incrementally
when water is scarce, and expands storage before the next mining load would
overflow it. In the playable game, new Electrolysers and Fuel Processors start
with safe minimum targets, fuel production protects a critical water reserve,
and hangar drones cannot empty the mother ship's emergency fuel.

Detailed drone flight paths, combat positioning, manual ship layout, and
navigation mistakes are not simulated. Their resource and time costs are
represented in the event simulation.
