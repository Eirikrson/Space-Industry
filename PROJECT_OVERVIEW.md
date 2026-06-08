# Space Industry Project Overview

## Entry Points

### `index.html`
- Provides the canvas, dropdown overlay, and bootstrap script.
- Contains no game balance values or embedded game logic.

### `Start-Game.bat`
- Starts the local web server and opens `http://127.0.0.1:8765/index.html`.
- Should be used instead of opening `index.html` directly because browsers may block local JSON requests.

### `styles.css`
- Defines the small amount of HTML-level styling used by the game.
- Most interface elements are drawn directly on the canvas.

## Data Files

### `data/config.json`
- Stores global settings such as world size, grid size, galaxy values, and save format constants.
- Use this file for values that affect the game as a whole.

### `data/assets.json`
- Maps image and sound identifiers to files.
- Defines animation frame counts, animation speeds, and relative sound volumes.
- Building display names match their machine PNG names in Title Case without spaces.
- Internal sprite variants such as turret tops and active thrusters use separate identifiers.

### `data/buildings.json`
- Defines build inventory entries, tabs, costs, research tiers, statistics, recipes, and tooltip descriptions.
- Uses one canonical Title Case name for every building.
- Contains the central assembler recipes used by production and the interface.
- Is the main location for building and research balance changes.

### `data/resources.json`
- Defines starting resources, storage options, resource groups, asteroid contents, and the starter ship.
- Uses internal camel-case resource keys and English display labels.

### `data/celestial.json`
- Defines planet and star types, colors, names, and resource properties.
- Is used by procedural galaxy generation.

### `data/enemies.json`
- Defines enemy fleet selection rules.
- Enemy ship layouts remain in `js/game/05-small-ships-combat.js` because they use code helpers.

### `data/texts.json`
- Stores shared visible menu, savegame, button, and tutorial text.
- New reusable interface text should be added here.

## JavaScript Loading

### `js/bootstrap.js`
- Loads all JSON data before loading the game scripts.
- Displays a loading error when the game is not served through the local server.

### `js/app.js`
- Lists game scripts in their required load order.
- Must be updated when a game script is added, removed, or reordered.

### `js/local-server.js`
- Serves HTML, CSS, JavaScript, JSON, PNG, and MP3 files locally.

## Game Scripts

### `js/game/00-runtime.js`
- Initializes the canvas, loaded data, global state, shared classes, and runtime helpers.
- Defines the main ship state and shared endgame state.

### `js/game/01-world.js`
- Defines asteroids, planets, stars, the black hole, asteroid belts, and galaxy generation.
- Keeps celestial bodies stationary during normal play.
- Manages world chunks, collisions, gravity, and solar efficiency.
- Applies black-hole gravity while planets and stars do not pull the ship.

### `js/game/02-resources-research.js`
- Handles storage, asteroid contents, research, recipes, drills, and resource collection.
- Prevents mined resources from disappearing when storage cannot accept them.

### `js/game/03-flight.js`
- Handles flight target detection, approach assistance, coordinate conversion, and local asteroids.
- Maintains the spacebar relative-velocity autopilot.

### `js/game/04-ship-building.js`
- Handles module placement, rotation, validation, blueprints, ship import, and ship export.
- Migrates legacy module names from old savegames and ship codes to canonical names.

### `js/game/05-small-ships-combat.js`
- Handles drones, hangars, enemy ships, fleets, turrets, projectiles, shields, and combat damage.
- Uses interval-based decisions and target caching for expensive combat checks.

### `js/game/06-build-ui-controls.js`
- Handles keyboard, mouse, scrolling, resizing, build controls, and dropdown interactions.
- Pauses the simulation when the browser tab or window becomes inactive.

### `js/game/07-drawing.js`
- Draws the world, ship modules, map, interface, tooltips, previews, and resource panels.
- Uses caches and off-screen checks to avoid unnecessary drawing work.

### `js/game/08-simulation.js`
- Updates production, energy, crew needs, hazards, collisions, and active sounds.
- Limits expensive world checks to active chunks.
- Handles gas collection, solar wind collection, and Dyson sphere effects.

### `js/game/09-landing.js`
- Owns the complete orbit, landing, launch, and landed-planet mining system.
- Snaps an orbiting ship to the visible orbit line and preserves tangent velocity on exit.
- Moves landing and launching ships along quarter-turn paths.

### `js/game/10-tutorial.js`
- Defines tutorial steps, triggers, progress checks, and the tutorial overlay.

### `js/game/11-save-menu-loop.js`
- Handles savegames, autosaves, import, export, menus, dialogs, and the main game loop.
- Migrates old save data and restores canonical module names.
- Creates and displays savegame previews.

## Bot

### `bot/performance-bot.js`
- Runs automated gameplay and interface scenarios.
- Measures frame timing and selected update and drawing functions.
- Writes only the latest report files in the `bot` directory.

### `bot/Run-Performance-Bot.bat`
- Starts the performance bot on Windows.

## Assets

### `Graphics`
- Contains item icons, machine sprites, and the game logo.
- Machine PNG names use the canonical building name without spaces.
- Every path referenced by `data/assets.json` must exist with matching capitalization.

### `Sounds`
- Contains MP3 files used by the sound identifiers in `data/assets.json`.

## Maintenance Rules

- Keep source code, comments, documentation, and visible text in English.
- Keep one canonical Title Case display name for each building.
- Preserve old names only inside explicit savegame migration maps.
- Keep internal resource keys stable because savegames depend on them.
- Add reusable visible text to `data/texts.json`.
- Put balance values in the appropriate JSON data file when practical.
- Add new scripts to `js/app.js` in load order.
- Verify every asset path and its exact capitalization.
- Limit persistent world simulation to active chunks whenever possible.
- Update this overview when file ownership or loading order changes.
