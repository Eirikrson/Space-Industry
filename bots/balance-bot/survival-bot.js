const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline/promises");
let chromium = null;

const BOT_DIR = __dirname;
const ROOT = path.resolve(BOT_DIR, "..", "..");
const CONFIG_PATH = path.join(BOT_DIR, "balance-bot-configuration.json");
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const args = process.argv.slice(2);
const requestedResumeSave = args
  .find(arg => arg.startsWith("--resume-save="))
  ?.slice("--resume-save=".length);
const requestedWorldNumber = args
  .find(arg => arg.startsWith("--world="))
  ?.slice("--world=".length);
const smokeLoopLimit = Math.max(2, Number(
  args.find(arg => arg.startsWith("--smoke-loops="))?.slice("--smoke-loops=".length)
) || 2);

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  config.mode = "survival";
  config.skill = Math.max(1, Math.min(100, Number(config.skill) || 1));
  config.decisionIntervalMs = Math.max(500, Number(config.decisionIntervalMs) || 2500);
  config.saveIntervalMs = 60000;
  config.softlockMinutes = Math.max(1, Number(config.softlockMinutes) || 10);
  config.viewport = {
    width: Math.max(800, Number(config.viewport?.width) || 1280),
    height: Math.max(600, Number(config.viewport?.height) || 720)
  };
  return config;
}

function formatLocalTimestamp(date = new Date(), fileNameSafe = false) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainder = pad(Math.abs(offsetMinutes) % 60);
  const dateTime = [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    fileNameSafe ? "-" : ":",
    pad(date.getMinutes()),
    fileNameSafe ? "-" : ":",
    pad(date.getSeconds()),
    fileNameSafe ? "-" : ".",
    pad(date.getMilliseconds(), 3)
  ].join("");
  const separator = fileNameSafe ? "-" : ":";
  return `${dateTime}${offsetSign}${offsetHours}${separator}${offsetRemainder}`;
}

const config = loadConfig();
const smokeTest = args.includes("--smoke-test");
const visibleWindow = config.visibleWindow && !args.includes("--headless");
const runId = formatLocalTimestamp(new Date(), true);
const reportRoot = path.join(BOT_DIR, "report", "survival");
const worldRoot = path.join(BOT_DIR, "world");
let worldNumber = null;
let worldPath = null;
let createFreshWorld = false;
let runDir = null;
let savePath = null;
let metricsPath = null;
let reportPath = null;
let statusPath = null;

const startedAt = Date.now();
let stopping = false;
let stopReason = "manual-stop";
let server = null;
let browser = null;
let page = null;
let lastSaveAt = 0;
let lastProgressAt = Date.now();
let lastProgressSignature = "";
let lastDecision = "Starting";
let currentGoal = null;
let currentPlan = [];
let actionCount = 0;
let saveCount = 0;
let waitingForPlayerInterface = false;
let cleanupStarted = false;
let browserCloseReported = false;
let terminal = null;
const terminalAnswers = [];
const terminalWaiters = [];

const metrics = {
  runId,
  worldNumber: null,
  mode: config.mode,
  skill: config.skill,
  startedAt: formatLocalTimestamp(new Date(startedAt)),
  resumedSave: false,
  resumedFrom: null,
  initialState: null,
  result: "running",
  resultReason: "",
  actions: {},
  buildings: {},
  research: {},
  resourceMilestones: {},
  shortages: {},
  progress: [],
  events: []
};

function nowIso() {
  return formatLocalTimestamp();
}

function elapsedSeconds() {
  return (Date.now() - startedAt) / 1000;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function askTerminal(question) {
  if (!terminal) {
    terminal = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    terminal.on("line", answer => {
      const waiter = terminalWaiters.shift();
      if (waiter) waiter(answer);
      else terminalAnswers.push(answer);
    });
  }
  process.stdout.write(question);
  if (terminalAnswers.length > 0) return terminalAnswers.shift();
  return new Promise(resolve => terminalWaiters.push(resolve));
}

function closeTerminal() {
  if (!terminal) return;
  terminal.close();
  terminal = null;
  while (terminalWaiters.length > 0) terminalWaiters.shift()("");
  terminalAnswers.length = 0;
}

function formatWorldNumber(value) {
  return String(value).padStart(3, "0");
}

function getWorldPath(number) {
  return path.join(worldRoot, `${number}.json`);
}

function findSmallestFreeWorldNumber() {
  const usedReportNumbers = new Set(
    fs.readdirSync(reportRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name.match(/-(\d{3})$/)?.[1])
      .filter(Boolean)
  );
  for (let value = 0; value <= 999; value++) {
    const number = formatWorldNumber(value);
    if (!fs.existsSync(getWorldPath(number)) && !usedReportNumbers.has(number)) return number;
  }
  throw new Error("All world numbers from 000 to 999 are already in use.");
}

async function selectWorld() {
  fs.mkdirSync(reportRoot, { recursive: true });
  fs.mkdirSync(worldRoot, { recursive: true });

  if (requestedResumeSave) {
    worldNumber = "test";
    worldPath = null;
  } else if (requestedWorldNumber) {
    if (!/^\d{3}$/.test(requestedWorldNumber)) {
      throw new Error("--world must contain exactly three digits.");
    }
    worldNumber = requestedWorldNumber;
    worldPath = getWorldPath(worldNumber);
    if (!fs.existsSync(worldPath)) {
      throw new Error(`World ${worldNumber} does not exist.`);
    }
  } else {
    while (true) {
      const answer = (await askTerminal(
        "Welt laden (000-999) oder Enter fuer eine neue Welt: "
      )).trim();
      if (answer === "") {
        worldNumber = findSmallestFreeWorldNumber();
        worldPath = null;
        createFreshWorld = true;
        break;
      }
      if (!/^\d{3}$/.test(answer)) {
        console.log("Bitte genau drei Ziffern eingeben, zum Beispiel 007.");
        continue;
      }
      const candidate = getWorldPath(answer);
      if (!fs.existsSync(candidate)) {
        console.log(`Die Welt ${answer} existiert noch nicht. Enter erstellt automatisch eine neue Welt.`);
        continue;
      }
      worldNumber = answer;
      worldPath = candidate;
      break;
    }
  }

  const sessionName = `${runId}-${worldNumber}`;
  runDir = path.join(reportRoot, sessionName);
  savePath = path.join(runDir, "save.json");
  metricsPath = path.join(runDir, "metrics.json");
  reportPath = path.join(runDir, "report.md");
  statusPath = path.join(runDir, "status.json");
  fs.mkdirSync(runDir, { recursive: true });
  if (worldPath) {
    fs.copyFileSync(worldPath, savePath);
  } else if (requestedResumeSave) {
    fs.copyFileSync(path.resolve(ROOT, requestedResumeSave), savePath);
  }
  metrics.worldNumber = worldNumber;
}

function writeReport() {
  const lines = [
    "# Space Industry Balance Bot Report",
    "",
    `Run: ${runId}`,
    `World: ${worldNumber}`,
    `Mode: ${config.mode}`,
    `Skill: ${config.skill}`,
    `Started: ${metrics.startedAt}`,
    `Result: ${metrics.result}`,
    metrics.resultReason ? `Reason: ${metrics.resultReason}` : "",
    "",
    "## Starting State",
    "",
    `Template: ${metrics.resumedFrom || "new world"}`,
    `Existing world play time: ${Number(metrics.initialState?.worldPlayTime || 0).toFixed(1)} s`,
    `Existing research: ${(metrics.initialState?.research || []).join(", ") || "none"}`,
    "",
    "### Starting Resources",
    "",
    "| Resource | Amount |",
    "|---|---:|"
  ];
  for (const [resource, amount] of Object.entries(metrics.initialState?.resources || {})) {
    if (!Number.isFinite(amount) || amount === 0) continue;
    lines.push(`| ${resource} | ${Number(amount.toFixed(3))} |`);
  }
  lines.push(
    "",
    "### Starting Buildings",
    "",
    "| Building | Count |",
    "|---|---:|"
  );
  for (const [building, count] of Object.entries(metrics.initialState?.buildings || {})) {
    lines.push(`| ${building} | ${count} |`);
  }
  lines.push(
    "",
    "## Building Timings",
    "",
    "| Building | Materials ready | Completed | Total time | Attempts |",
    "|---|---:|---:|---:|---:|"
  );
  for (const [name, item] of Object.entries(metrics.buildings)) {
    const materialTime = item.materialsAvailableAtStart
      ? "available at start"
      : item.materialReadyAfterSeconds !== undefined
        ? `${item.materialReadyAfterSeconds} s`
        : "-";
    lines.push(
      `| ${name} | ${materialTime} | ` +
      `${item.completedAtSeconds ?? "-"} s | ${item.durationSeconds ?? "-"} s | ${item.attempts} |`
    );
  }
  lines.push(
    "",
    "## Research Timings",
    "",
    "| Research | Materials ready | Completed | Total time | Attempts |",
    "|---|---:|---:|---:|---:|"
  );
  for (const [name, item] of Object.entries(metrics.research)) {
    const materialTime = item.materialsAvailableAtStart
      ? "available at start"
      : item.materialReadyAfterSeconds !== undefined
        ? `${item.materialReadyAfterSeconds} s`
        : "-";
    lines.push(
      `| ${name} | ${materialTime} | ` +
      `${item.completedAtSeconds ?? "-"} s | ${item.durationSeconds ?? "-"} s | ${item.attempts} |`
    );
  }
  lines.push(
    "",
    "## Resource Milestones",
    "",
    "| Resource | Amount | Reached after | Origin | World time |",
    "|---|---:|---:|---|---:|"
  );
  for (const item of Object.values(metrics.resourceMilestones)) {
    lines.push(
      `| ${item.resource} | ${item.amount} | ${item.elapsedSeconds} s | ` +
      `${item.availableAtStart ? "starting inventory" : "earned during run"} | ${item.worldPlayTime.toFixed(1)} s |`
    );
  }
  lines.push(
    "",
    "## Observed Shortages",
    "",
    "| Goal | Resource | Maximum missing | Samples |",
    "|---|---|---:|---:|"
  );
  for (const item of Object.values(metrics.shortages)) {
    lines.push(`| ${item.goal} | ${item.resource} | ${item.maximumMissing} | ${item.samples} |`);
  }
  lines.push("");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
}

function logEvent(type, details = {}) {
  metrics.events.push({
    at: nowIso(),
    elapsedSeconds: Number(elapsedSeconds().toFixed(1)),
    type,
    ...details
  });
  if (metrics.events.length > 2000) metrics.events.shift();
}

function countAction(name) {
  metrics.actions[name] = (metrics.actions[name] || 0) + 1;
  actionCount++;
}

function handleBrowserClosed() {
  if (cleanupStarted || browserCloseReported || stopping) return;
  browserCloseReported = true;
  stopReason = "manual-browser-close";
  stopping = true;
  console.log("\nBrowser wurde geschlossen.");
}

function updateStatus(state = null) {
  writeJson(statusPath, {
    runId,
    worldNumber,
    mode: config.mode,
    skill: config.skill,
    visibleWindow,
    status: metrics.result === "running"
      ? (stopping ? "stopping" : waitingForPlayerInterface ? "waiting-for-player" : "running")
      : "finished",
    result: metrics.result,
    resultReason: metrics.resultReason,
    lastDecision,
    currentGoal,
    plan: currentPlan,
    actionCount,
    saveCount,
    elapsedSeconds: Number(elapsedSeconds().toFixed(1)),
    game: state ? {
      appState: state.appState,
      worldPlayTime: state.worldPlayTime,
      fuel: state.res.fuel,
      energy: state.res.energy,
      energyNet: state.res.energyNet,
      modules: state.modules.length,
      research: state.research.length,
      enemies: state.enemies,
      nearestAsteroidDistance: state.nearestAsteroid?.distance ?? null
    } : null,
    updatedAt: nowIso()
  });
}

function getFreePort() {
  const base = 8800 + Math.floor(Math.random() * 800);
  return base;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isServerReady(url) {
  try {
    return (await fetch(url)).ok;
  } catch (error) {
    return false;
  }
}

async function startServer(port) {
  const url = `http://127.0.0.1:${port}/index.html`;
  server = spawn(process.execPath, [path.join(ROOT, "js", "local-server.js"), String(port)], {
    cwd: ROOT,
    stdio: "ignore",
    windowsHide: true
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await isServerReady(url)) return url;
    if (server.exitCode !== null) break;
    await delay(100);
  }
  throw new Error(`The local game server could not start on port ${port}.`);
}

async function initializeGame(url) {
  ({ chromium } = require("playwright"));
  browser = await chromium.launch({
    headless: !visibleWindow,
    executablePath: EDGE_PATH,
    args: [`--window-size=${config.viewport.width},${config.viewport.height}`]
  });
  const context = await browser.newContext({
    viewport: visibleWindow ? null : config.viewport
  });
  page = await context.newPage();
  browser.on("disconnected", handleBrowserClosed);
  page.on("close", handleBrowserClosed);
  page.on("dialog", dialog => dialog.dismiss().catch(() => {}));
  await page.goto(url);
  await page.waitForFunction(() => typeof resetGameToNew === "function" && typeof createSavePayload === "function");

  await page.evaluate(() => localStorage.clear());
  const resumePath = !createFreshWorld && fs.existsSync(savePath) ? savePath : null;
  if (resumePath) {
    const payload = JSON.parse(fs.readFileSync(resumePath, "utf8"));
    const loaded = await page.evaluate(save => loadSavePayload(save), payload);
    if (!loaded) throw new Error("The Balance Bot savegame could not be loaded.");
    metrics.resumedSave = true;
    metrics.resumedFrom = requestedResumeSave
      ? path.basename(requestedResumeSave)
      : path.basename(worldPath);
    logEvent("save-loaded", {
      worldNumber,
      template: metrics.resumedFrom,
      sessionCopy: resumePath
    });
  } else {
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    await page.evaluate(({ name, seedValue }) => {
      resetGameToNew(name, seedValue);
      resetTutorialForNewWorld();
    }, { name: `Balance Bot ${worldNumber}`, seedValue: seed });
    logEvent("world-created", { seed, worldNumber });
  }

  await page.evaluate(() => {
    localStorage.clear();
    autosaveIfNeeded = () => {};
    window.__balanceBotAsteroidTarget = null;
    window.__balanceBotFlightWaypoint = null;
    window.__balanceBotFlightState = null;
    window.__balanceBotGoals = [];
    window.__balanceBotInputLock = true;
    window.__balanceBotKeyPermission = null;
  });
  await closeTutorial();
  lastSaveAt = Date.now();
}

async function closeTutorial() {
  const skip = await page.evaluate(() => {
    if (!tutorialActive && !tutorialOverlay) return null;
    const layout = getTutorialLayout();
    return layout?.skip ? {
      x: layout.skip.x + layout.skip.w / 2,
      y: layout.skip.y + layout.skip.h / 2
    } : null;
  }).catch(() => null);
  if (skip) {
    await page.mouse.click(skip.x, skip.y);
    countAction("skip-tutorial");
    logEvent("ui-action", { action: "skip-tutorial" });
  }
}

async function prepareBotInterface() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await page.evaluate(() => ({
      appState,
      uiDialog: !!uiDialog,
      seedDialog: !!seedDialogOpen,
      tutorial: !!tutorialOverlay || !!tutorialActive,
      research: !!researchWindowOpen,
      assembler: typeof assemblerWindowModule !== "undefined" && !!assemblerWindowModule,
      smelter: typeof smelterWindowModule !== "undefined" && !!smelterWindowModule,
      electrolyser: typeof electrolyserWindowModule !== "undefined" && !!electrolyserWindowModule,
      fuelProcessor: typeof fuelProcessorWindowModule !== "undefined" && !!fuelProcessorWindowModule,
      farm: typeof farmWindowModule !== "undefined" && !!farmWindowModule,
      turret: typeof turretControlWindowOpen !== "undefined" && !!turretControlWindowOpen,
      map: typeof mapVisible !== "undefined" && !!mapVisible,
      build: typeof buildMode !== "undefined" && !!buildMode,
      smallShipEditor: typeof activeSmallShipEdit !== "undefined" && !!activeSmallShipEdit
    }));

    if (state.tutorial) {
      await closeTutorial();
      continue;
    }
    const playerInterfaceOpen = state.build || state.smallShipEditor || state.uiDialog ||
      state.appState === "paused" || state.seedDialog || state.research ||
      state.assembler || state.smelter || state.electrolyser ||
      state.fuelProcessor || state.farm || state.turret || state.map;
    if (playerInterfaceOpen) {
      waitingForPlayerInterface = true;
      lastDecision = "Paused while the player uses an open window";
      return false;
    }
    waitingForPlayerInterface = false;
    return state.appState === "playing" || state.appState === "blackHoleEnd";
  }
  return false;
}

async function isPlayerInterfaceOpen() {
  return page.evaluate(() =>
    !!uiDialog ||
    !!seedDialogOpen ||
    !!researchWindowOpen ||
    !!assemblerWindowModule ||
    !!smelterWindowModule ||
    !!electrolyserWindowModule ||
    !!fuelProcessorWindowModule ||
    !!farmWindowModule ||
    !!turretControlWindowOpen ||
    !!mapVisible ||
    !!buildMode ||
    !!activeSmallShipEdit ||
    appState === "paused"
  );
}

async function readState() {
  return page.evaluate(() => {
    const resourceCopy = {};
    for (const [key, value] of Object.entries(res)) {
      if (typeof value === "number") resourceCopy[key] = value;
    }
    const rateCopy = {};
    for (const [key, value] of Object.entries(resourceRates)) {
      if (typeof value === "number") rateCopy[key] = value;
    }
    let lockedAsteroid = window.__balanceBotAsteroidTarget;
    const fuelRecoveryActive =
      (res.fuel || 0) < Math.max(45, (res.fuelCap || 100) * 0.75) ||
      (res.water || 0) < 20;
    const asteroidRecoveryValue = asteroid => {
      if (!fuelRecoveryActive) return 0;
      const contents = asteroid.contents || {};
      return (contents.water || 0) * 100 +
        (contents.ironOre || 0) * 4 +
        (contents.copperOre || 0) * 4 +
        (contents.siliconOre || 0) * 2;
    };
    const asteroidDistance = asteroid => Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y);
    const estimatedAsteroidFuel = asteroid =>
      Math.max(6, asteroidDistance(asteroid) / 65 + 6);
    const asteroidReachable = asteroid => !!asteroid &&
      (res.fuel || 0) >= estimatedAsteroidFuel(asteroid);
    const bestAsteroid = asteroids
      .filter(asteroid => asteroid.totalItems > 0)
      .sort((a, b) =>
        Number(asteroidReachable(b)) - Number(asteroidReachable(a)) ||
        (fuelRecoveryActive
          ? Number(asteroidRecoveryValue(b) > 0) - Number(asteroidRecoveryValue(a) > 0)
          : 0) ||
        asteroidDistance(a) - asteroidDistance(b) ||
        asteroidRecoveryValue(b) - asteroidRecoveryValue(a)
      )[0] || null;
    const betterReachableTarget =
      bestAsteroid &&
      bestAsteroid !== lockedAsteroid &&
      asteroidReachable(bestAsteroid) &&
      !asteroidReachable(lockedAsteroid);
    if (!lockedAsteroid ||
        !asteroids.includes(lockedAsteroid) ||
        lockedAsteroid.totalItems <= 0 ||
        betterReachableTarget) {
      lockedAsteroid = bestAsteroid;
      if (lockedAsteroid && !lockedAsteroid._balanceBotTargetId) {
        window.__balanceBotNextTargetId = (window.__balanceBotNextTargetId || 0) + 1;
        lockedAsteroid._balanceBotTargetId = window.__balanceBotNextTargetId;
      }
      window.__balanceBotAsteroidTarget = lockedAsteroid;
    }
    const nearestAsteroid = lockedAsteroid
      ? {
        x: lockedAsteroid.x,
        y: lockedAsteroid.y,
        vx: lockedAsteroid.vx || 0,
        vy: lockedAsteroid.vy || 0,
        size: lockedAsteroid.size || 0,
        distance: Math.hypot(lockedAsteroid.x - ship.x, lockedAsteroid.y - ship.y),
        surfaceGap: Math.max(
          0,
          Math.hypot(lockedAsteroid.x - ship.x, lockedAsteroid.y - ship.y) -
            (lockedAsteroid.size || 0) -
            getShipCollisionRadius()
        ),
        contents: { ...lockedAsteroid.contents },
        totalItems: lockedAsteroid.totalItems,
        fuelRecoveryValue: asteroidRecoveryValue(lockedAsteroid),
        estimatedFuel: estimatedAsteroidFuel(lockedAsteroid),
        reachable: asteroidReachable(lockedAsteroid)
      }
      : null;
    const asteroidMining = placedModules.some(module =>
      module.type === "Drill" &&
      module._drillAsteroid === lockedAsteroid &&
      lockedAsteroid?.totalItems > 0
    );
    const nearestBelt = solarSystems
      .flatMap(system => getSystemBelts(system)
        .filter(Boolean)
        .map(belt => {
          const angle = Math.atan2(ship.y - belt.star.y, ship.x - belt.star.x);
          const radius = (belt.innerR + belt.outerR) / 2;
          const x = belt.star.x + Math.cos(angle) * radius;
          const y = belt.star.y + Math.sin(angle) * radius;
          return {
            x,
            y,
            kind: belt.kind,
            distance: Math.hypot(x - ship.x, y - ship.y)
          };
        }))
      .sort((a, b) => a.distance - b.distance)[0] || null;
    if (nearestBelt) {
      nearestBelt.estimatedFuel = Math.max(
        12,
        12 + Math.sqrt(Math.max(0, nearestBelt.distance)) / 7.5
      );
      nearestBelt.reachable = (res.fuel || 0) >= nearestBelt.estimatedFuel;
    }
    const liveModules = placedModules.map(module => ({
      id: module.id,
      type: module.type,
      x: module.x,
      y: module.y,
      w: module.w || 1,
      h: module.h || 1,
      rot: module.rot || 0,
      hp: getModuleHealth(module),
      assemblerTargets: module.assemblerTargets ? { ...module.assemblerTargets } : null,
      smelterTargets: module.smelterTargets ? { ...module.smelterTargets } : null,
      electrolyserTargets: module.electrolyserTargets ? { ...module.electrolyserTargets } : null,
      fuelProcessorTarget: Number(module.fuelProcessorTarget) || 0,
      farmTarget: Number(module.farmTarget) || 0
    }));
    const availableResearch = RESEARCH_TIERS.flatMap((tier, tierIndex) =>
      tier.items.map(item => ({
        name: item.name,
        cost: { ...(item.cost || {}) },
        tierIndex,
        visible: getComputerLevel() >= getResearchTierRequiredComputerLevel(tierIndex),
        unlocked: unlockedResearch.has(item.name),
        affordable: hasCost(item.cost)
      }))
    );
    return {
      appState,
      endingResult: blackHoleEndingResult || null,
      endingReason: blackHoleEndingReason || "",
      blackHoleCompleted: !!blackHoleCompleted,
      currentWorldIsEnd: !!currentWorldIsEnd,
      worldPlayTime,
      ship: {
        x: ship.x,
        y: ship.y,
        vx: ship.vx,
        vy: ship.vy,
        angle: ship.angle
      },
      res: resourceCopy,
      rates: rateCopy,
      modules: liveModules,
      blueprints: blueprints.length,
      commitPending: !!commitPending,
      research: Array.from(unlockedResearch),
      availableResearch,
      nearestAsteroid,
      asteroidMining,
      nearestBelt,
      enemies: enemyShips.filter(enemy => !enemy._dead).length,
      computerLevel: getComputerLevel(),
      itemStorageUsed: getSolidStorageUsed(),
      itemStorageCap: res.itemCap || 0,
      buildCosts: JSON.parse(JSON.stringify(BUILD_COSTS)),
      assemblerRecipes: JSON.parse(JSON.stringify(BUILDING_STATS.Assembler?.recipes || {})),
      unlockedBuildings: getVisibleBuildTabs().flatMap(tab => tab.items.map(item => item.name)),
      readiness: getBlackHoleReadiness(),
      position: {
        inBelt: !!getBeltAtShip(),
        landed: !!shipLanded,
        orbiting: !!orbitModeActive
      }
    };
  });
}

function hasResources(state, cost) {
  return Object.entries(cost || {}).every(([key, amount]) => (state.res[key] || 0) >= amount);
}

function moduleCount(state, type) {
  return state.modules.filter(module => module.type === type && module.hp > 0).length;
}

function formatGoalName(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, character => character.toUpperCase());
}

function getMissingResources(state, cost) {
  return Object.entries(cost || {})
    .filter(([key, amount]) => (state.res[key] || 0) < amount)
    .map(([key]) => key);
}

function getResourceGoals(resource, finalGoal, state, visited = new Set()) {
  if (visited.has(resource)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(resource);
  const crafted = new Set(["gears", "cables", "circuits", "ammo", "cannonBalls", "railgunRods", "rocketAmmunition"]);
  const smelted = {
    ironPlate: "iron ore",
    copperPlate: "copper ore",
    silicon: "silicon ore"
  };
  if (crafted.has(resource)) {
    const recipe = state.assemblerRecipes?.[resource];
    const goals = [];
    for (const input of getMissingResources(state, recipe?.inputs)) {
      goals.push(...getResourceGoals(input, `craft ${formatGoalName(resource)}`, state, nextVisited));
    }
    goals.push({ action: `Craft ${formatGoalName(resource)}`, reason: `For ${finalGoal}` });
    return goals;
  }
  if (smelted[resource]) {
    if (moduleCount(state, "Smelter") > 0) {
      return [
        { action: `Gather ${formatGoalName(smelted[resource])}`, reason: `Produce ${formatGoalName(resource)}` },
        { action: `Smelt ${formatGoalName(resource)}`, reason: `For ${finalGoal}` }
      ];
    }
    return [{ action: `Find ${formatGoalName(resource)}`, reason: `For ${finalGoal}` }];
  }
  return [{ action: `Gather ${formatGoalName(resource)}`, reason: `For ${finalGoal}` }];
}

function getFuelThreshold(state) {
  return Math.max(45, (state.res.fuelCap || 100) * 0.75);
}

function estimateAsteroidFlightFuel(distance) {
  return Math.max(6, distance / 65 + 6);
}

function estimateBeltFlightFuel(distance) {
  // Long flights mostly coast without consuming fuel. Distance therefore
  // increases the reserve slowly instead of linearly.
  return Math.max(12, 12 + Math.sqrt(Math.max(0, distance)) / 7.5);
}

function chooseMiningTravelTarget(state) {
  if (state.position.inBelt) {
    return state.nearestAsteroid?.reachable ? "asteroid" : null;
  }

  const beltFuel = state.nearestBelt
    ? estimateBeltFlightFuel(state.nearestBelt.distance)
    : Infinity;
  if (state.nearestBelt && state.res.fuel >= beltFuel) return "belt";
  if (state.nearestAsteroid?.reachable) return "asteroid";
  return null;
}

function hasCoreMiningInfrastructure(state) {
  return moduleCount(state, "Laboratory") > 0 &&
    state.research.includes("Drill") &&
    moduleCount(state, "Drill") > 0 &&
    state.research.includes("Smelter") &&
    moduleCount(state, "Smelter") > 0;
}

function getStrategicProductionObjectives(state) {
  const objectives = [];
  const addResearch = name => {
    const item = state.availableResearch.find(candidate => candidate.name === name);
    if (!item?.visible || item.unlocked) return false;
    objectives.push({ kind: "research", name, cost: item.cost || {} });
    return true;
  };
  const addBuilding = name => {
    if (!state.research.includes(name) ||
        moduleCount(state, name) > 0 ||
        !state.unlockedBuildings.includes(name)) {
      return false;
    }
    objectives.push({ kind: "building", name, cost: state.buildCosts[name] || {} });
    return true;
  };

  if (moduleCount(state, "Laboratory") === 0) {
    return [{ kind: "building", name: "Laboratory", cost: state.buildCosts.Laboratory || {} }];
  }
  if (addResearch("Drill")) {
    objectives.push({ kind: "building", name: "Drill", cost: state.buildCosts.Drill || {} });
    return objectives;
  }
  if (addBuilding("Drill")) return objectives;
  if (addResearch("Smelter")) {
    objectives.push({ kind: "building", name: "Smelter", cost: state.buildCosts.Smelter || {} });
    return objectives;
  }
  if (addBuilding("Smelter")) return objectives;

  const recovery = getFuelRecoveryTarget(state);
  if (recovery?.kind === "research" || recovery?.kind === "building") {
    objectives.push(recovery);
    if (recovery.kind === "research" && state.buildCosts[recovery.name]) {
      objectives.push({
        kind: "building",
        name: recovery.name,
        cost: state.buildCosts[recovery.name]
      });
    }
    return objectives;
  }

  const researchName = chooseResearch(state);
  const research = state.availableResearch.find(candidate => candidate.name === researchName);
  if (research) {
    objectives.push({ kind: "research", name: researchName, cost: research.cost || {} });
    if (state.buildCosts[researchName]) {
      objectives.push({
        kind: "building",
        name: researchName,
        cost: state.buildCosts[researchName]
      });
    }
  }
  return objectives;
}

function getPlannedProductionTargets(state) {
  const objectives = getStrategicProductionObjectives(state);
  const requirements = {};
  for (const objective of objectives) {
    for (const [key, amount] of Object.entries(objective.cost || {})) {
      requirements[key] = (requirements[key] || 0) + amount;
    }
  }

  const recipes = state.assemblerRecipes || {};
  const plannedBatches = {};
  const maximumRecipeDepth = Object.keys(recipes).length + 1;
  for (let pass = 0; pass < maximumRecipeDepth; pass++) {
    let changed = false;
    for (const [key, recipe] of Object.entries(recipes)) {
      const required = requirements[key] || 0;
      const missing = Math.max(0, required - (state.res[key] || 0));
      const outputAmount = Math.max(1, recipe?.outputs?.[key] || 1);
      const batches = Math.ceil(missing / outputAmount);
      const additionalBatches = batches - (plannedBatches[key] || 0);
      if (additionalBatches <= 0) continue;
      plannedBatches[key] = batches;
      for (const [input, amount] of Object.entries(recipe?.inputs || {})) {
        requirements[input] = (requirements[input] || 0) + amount * additionalBatches;
      }
      changed = true;
    }
    if (!changed) break;
  }

  return {
    objectives,
    assembler: Object.fromEntries(
      Object.keys(recipes).map(key => [key, Math.ceil(requirements[key] || 0)])
    ),
    smelter: {
      ironPlate: Math.ceil(requirements.ironPlate || 0),
      copperPlate: Math.ceil(requirements.copperPlate || 0),
      silicon: Math.ceil(requirements.silicon || 0)
    }
  };
}

function getFuelRecoveryTarget(state) {
  if (!hasCoreMiningInfrastructure(state)) return null;
  const waterReserveLow = (state.res.water || 0) < 20;
  if ((state.res.fuel || 0) >= getFuelThreshold(state) && !waterReserveLow) {
    return null;
  }
  const priorities = [
    ...((state.res.fuelCap || 0) > 0 ? [] : ["Tank MK1"]),
    "Smelter",
    "Electrolyser",
    "Fuel Processor"
  ];
  for (const name of priorities) {
    const research = state.availableResearch.find(item => item.name === name);
    if (research?.visible && !research.unlocked) {
      return { kind: "research", name, cost: research.cost };
    }
    if (state.research.includes(name) &&
        moduleCount(state, name) === 0 &&
        state.unlockedBuildings.includes(name)) {
      return { kind: "building", name, cost: state.buildCosts[name] };
    }
  }
  return { kind: "production", name: "Fuel", cost: null };
}

function addFuelRecoveryGoals(goals, state) {
  const target = getFuelRecoveryTarget(state);
  if (!target) return false;
  const threshold = Math.ceil(getFuelThreshold(state));
  if (target.kind === "research" || target.kind === "building") {
    const finalGoal = `${target.kind === "research" ? "research" : "build"} ${target.name}`;
    for (const resource of getMissingResources(state, target.cost)) {
      goals.push(...getResourceGoals(resource, finalGoal, state));
    }
    goals.push({
      action: `${target.kind === "research" ? "Research" : "Build"} ${target.name}`,
      reason: `Restore fuel production before fuel drops further`
    });
  } else {
    if ((state.res.water || 0) < 20) {
      goals.push({ action: "Gather Water", reason: "Run the Electrolyser for fuel production" });
    }
    if ((state.res.energyNet || 0) <= 0) {
      goals.push({ action: "Increase power production", reason: "Run the fuel production machines" });
    }
    goals.push({ action: "Produce Hydrogen and Oxygen", reason: "Supply the Fuel Processor" });
    goals.push({ action: "Produce Fuel", reason: `Refill the reserve to at least ${threshold}` });
  }
  return true;
}

function createGoalQueue(state) {
  const goals = [];
  const laboratoryMissing = moduleCount(state, "Laboratory") === 0;
  const hasSmelterResearch = state.research.includes("Smelter");
  const hasSmelter = moduleCount(state, "Smelter") > 0;
  const hasDrillResearch = state.research.includes("Drill");
  const hasDrill = moduleCount(state, "Drill") > 0;
  const recoveringFuel = addFuelRecoveryGoals(goals, state);

  if (state.commitPending || state.blueprints > 0) {
    goals.push({ action: "Finish construction", reason: currentGoal ? formatGoalName(currentGoal.split(":")[1]) : "Complete current build" });
  }

  if (state.readiness.energy &&
      state.readiness.stabilizer &&
      state.readiness.quantum &&
      state.readiness.shields) {
    goals.push({ action: "Enter black hole", reason: "Complete the survival run" });
    return goals;
  }

  if (recoveringFuel) {
    // Fuel recovery remains the primary plan until the reserve is safe again.
  } else if (laboratoryMissing) {
    const finalGoal = "build Laboratory";
    for (const resource of getMissingResources(state, state.buildCosts.Laboratory)) {
      goals.push(...getResourceGoals(resource, finalGoal, state));
    }
    goals.push({ action: "Build Laboratory", reason: "Unlock Drill research" });
  } else if (!hasDrillResearch) {
    const item = state.availableResearch.find(candidate => candidate.name === "Drill");
    for (const resource of getMissingResources(state, item?.cost)) {
      goals.push(...getResourceGoals(resource, "research Drill", state));
    }
    goals.push({ action: "Research Drill", reason: "Enable asteroid mining" });
  } else if (!hasDrill) {
    for (const resource of getMissingResources(state, state.buildCosts.Drill)) {
      goals.push(...getResourceGoals(resource, "build Drill", state));
    }
    goals.push({ action: "Build Drill at ship front", reason: "Begin asteroid mining" });
  } else if (!hasSmelterResearch) {
    const item = state.availableResearch.find(candidate => candidate.name === "Smelter");
    for (const resource of getMissingResources(state, item?.cost)) {
      goals.push(...getResourceGoals(resource, "research Smelter", state));
    }
    goals.push({ action: "Research Smelter", reason: "Process collected asteroid ore" });
    goals.push({ action: "Build Smelter", reason: "Process collected asteroid ore" });
  } else if (!hasSmelter) {
    for (const resource of getMissingResources(state, state.buildCosts.Smelter)) {
      goals.push(...getResourceGoals(resource, "build Smelter", state));
    }
    goals.push({ action: "Build Smelter", reason: "Process collected asteroid ore" });
  } else {
    const research = chooseResearch(state);
    const researchItem = state.availableResearch.find(item => item.name === research);
    if (research && researchItem) {
      const finalGoal = `research ${research}`;
      for (const resource of getMissingResources(state, researchItem.cost)) {
        goals.push(...getResourceGoals(resource, finalGoal, state));
      }
      goals.push({ action: `Research ${research}`, reason: "Unlock the next progression step" });
    }

    const building = chooseBuildingGoal(state);
    if (building && !goals.some(goal => goal.action === `Build ${building}`)) {
      const finalGoal = `build ${building}`;
      for (const resource of getMissingResources(state, state.buildCosts[building])) {
        goals.push(...getResourceGoals(resource, finalGoal, state));
      }
      goals.push({ action: `Build ${building}`, reason: research ? `Support ${research} research` : "Improve ship capability" });
    }
  }

  if (hasDrill && goals.length === 0 && state.nearestAsteroid) {
    goals.push({ action: "Gather asteroid resources", reason: "Prepare future buildings and research" });
  } else if (hasDrill && goals.length === 0 && !state.position.inBelt) {
    goals.push({ action: "Fly to asteroid belt", reason: "Find raw materials" });
  }

  const needsMaterials = goals.some(goal =>
    /^(Gather|Find|Craft|Smelt) /.test(goal.action)
  );
  const miningTravelTarget = chooseMiningTravelTarget(state);
  if (hasDrill &&
      needsMaterials &&
      !goals.some(goal => goal.action === "Approach resource asteroid") &&
      !(state.commitPending || state.blueprints > 0)) {
    if (miningTravelTarget === "belt") {
      goals.unshift({ action: "Fly to asteroid belt", reason: "Reach a dense source of raw materials" });
    } else if (miningTravelTarget === "asteroid" &&
        state.nearestAsteroid.distance > 5 * 40) {
      goals.unshift({ action: "Approach resource asteroid", reason: "Reach the required materials" });
    } else if (!miningTravelTarget &&
        state.nearestBelt &&
        !state.position.inBelt &&
        !state.nearestBelt.reachable) {
      goals.unshift({
        action: "Preserve fuel",
        reason: `Nearest belt needs about ${Math.ceil(state.nearestBelt.estimatedFuel)} Fuel`
      });
    } else if (!state.nearestAsteroid && state.position.inBelt) {
      goals.unshift({ action: "Search for asteroids", reason: "Find the required materials" });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const goal of goals) {
    const key = `${goal.action}:${goal.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(goal);
  }
  return unique.slice(0, 8);
}

async function publishGoalQueue(state) {
  const goals = createGoalQueue(state);
  currentPlan = goals;
  await page.evaluate(queue => {
    window.__balanceBotGoals = queue;
  }, goals);
  return goals;
}

function markIntent(kind, name, state, materialsReady = false) {
  const key = `${kind}:${name}`;
  if (!metrics[kind][name]) {
    const cost = kind === "buildings"
      ? state.buildCosts[name]
      : state.availableResearch.find(item => item.name === name)?.cost;
    const startingResources = metrics.initialState?.resources || {};
    const materialsAvailableAtStart = Object.entries(cost || {}).every(
      ([resource, amount]) => (startingResources[resource] || 0) >= amount
    );
    metrics[kind][name] = {
      firstIntentAtSeconds: Number(elapsedSeconds().toFixed(1)),
      firstIntentWorldTime: state.worldPlayTime,
      cost: { ...(cost || {}) },
      startingResources: Object.fromEntries(
        Object.keys(cost || {}).map(resource => [resource, startingResources[resource] || 0])
      ),
      materialsAvailableAtStart,
      completedAtSeconds: null,
      completedWorldTime: null,
      attempts: 0
    };
    logEvent("goal-started", { kind, name, resources: state.res });
  }
  const measurement = metrics[kind][name];
  if (materialsReady && measurement.materialReadyAtSeconds === undefined) {
    measurement.materialReadyAtSeconds = Number(elapsedSeconds().toFixed(1));
    measurement.materialReadyAfterSeconds = measurement.materialsAvailableAtStart
      ? 0
      : Number((measurement.materialReadyAtSeconds - measurement.firstIntentAtSeconds).toFixed(1));
    logEvent("goal-materials-ready", {
      kind,
      name,
      collectionSeconds: measurement.materialReadyAfterSeconds
    });
  }
  currentGoal = key;
}

function markCompletions(state) {
  for (const [name, measurement] of Object.entries(metrics.buildings)) {
    if (measurement.completedAtSeconds !== null || moduleCount(state, name) <= 0) continue;
    measurement.completedAtSeconds = Number(elapsedSeconds().toFixed(1));
    measurement.completedWorldTime = state.worldPlayTime;
    measurement.durationSeconds = Number((measurement.completedAtSeconds - measurement.firstIntentAtSeconds).toFixed(1));
    logEvent("building-completed", { name, durationSeconds: measurement.durationSeconds });
  }
  for (const [name, measurement] of Object.entries(metrics.research)) {
    if (measurement.completedAtSeconds !== null || !state.research.includes(name)) continue;
    measurement.completedAtSeconds = Number(elapsedSeconds().toFixed(1));
    measurement.completedWorldTime = state.worldPlayTime;
    measurement.durationSeconds = Number((measurement.completedAtSeconds - measurement.firstIntentAtSeconds).toFixed(1));
    logEvent("research-completed", { name, durationSeconds: measurement.durationSeconds });
  }
}

function recordResourceMilestones(state) {
  for (const [key, value] of Object.entries(state.res)) {
    if (!Number.isFinite(value) || value <= 0) continue;
    for (const threshold of [1, 10, 50, 100, 500, 1000]) {
      if (value < threshold) continue;
      const id = `${key}:${threshold}`;
      if (metrics.resourceMilestones[id]) continue;
      metrics.resourceMilestones[id] = {
        resource: key,
        amount: threshold,
        elapsedSeconds: Number(elapsedSeconds().toFixed(1)),
        worldPlayTime: state.worldPlayTime,
        availableAtStart: (metrics.initialState?.resources?.[key] || 0) >= threshold
      };
    }
  }
}

function progressSignature(state) {
  const importantResources = [
    "ironPlate", "copperPlate", "ironOre", "copperOre", "siliconOre", "silicon",
    "nickel", "carbon", "uranium", "gears", "cables", "circuits", "ammo",
    "cannonBalls", "railgunRods", "rocketAmmunition"
  ];
  return JSON.stringify({
    modules: state.modules.map(module => module.type).sort(),
    research: state.research.slice().sort(),
    resources: {
      ...Object.fromEntries(importantResources.map(key => [key, Math.floor(state.res[key] || 0)])),
      // FIX 2: Track fuel and water in coarse steps so active fuel production is
      // recognised as progress and doesn't trigger the softlock timer unnecessarily.
      fuel: Math.floor((state.res.fuel || 0) / 5) * 5,
      water: Math.floor((state.res.water || 0) / 5) * 5
    },
    blackHoleCompleted: state.blackHoleCompleted,
    world: state.currentWorldIsEnd
  });
}

function updateProgress(state) {
  const signature = progressSignature(state);
  if (signature !== lastProgressSignature) {
    lastProgressSignature = signature;
    lastProgressAt = Date.now();
    metrics.progress.push({
      elapsedSeconds: Number(elapsedSeconds().toFixed(1)),
      worldPlayTime: state.worldPlayTime,
      modules: state.modules.length,
      research: state.research.length
    });
    if (metrics.progress.length > 500) metrics.progress.shift();
  }
}

function getReactionDelay() {
  const efficiency = config.skill / 100;
  const base = config.decisionIntervalMs * (1.7 - efficiency * 0.9);
  const variance = base * (0.08 + (1 - efficiency) * 0.35);
  return Math.max(350, Math.round(base + (Math.random() * 2 - 1) * variance));
}

async function clickPoint(point) {
  await page.mouse.move(point.x, point.y, { steps: config.skill >= 80 ? 2 : 5 });
  await delay(Math.max(35, 240 - config.skill * 2));
  await page.mouse.click(point.x, point.y);
}

async function replaceDialogValue(value) {
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(String(value));
}

async function allowBotFlightKey(key) {
  await page.evaluate(allowedKey => {
    window.__balanceBotKeyPermission = {
      type: "keydown",
      key: allowedKey.toLowerCase()
    };
  }, key);
}

async function pressBotFlightKey(key, holdMs) {
  await allowBotFlightKey(key);
  await page.keyboard.down(key);
  await delay(holdMs);
  await page.keyboard.up(key);
}

async function buildBuilding(state, type) {
  const cost = state.buildCosts[type];
  if (!state.unlockedBuildings.includes(type) || !hasResources(state, cost)) return false;
  markIntent("buildings", type, state, true);
  metrics.buildings[type].attempts++;
  lastDecision = `Building ${type}`;
  logEvent("decision", { decision: "build", target: type, cost });

  await page.keyboard.press("b");
  await page.waitForFunction(() => buildMode === true);
  const placement = await page.evaluate(targetType => {
    const layout = getBuildInventoryLayout();
    const tab = layout.tabs.find(candidate => candidate.items.some(item => item.name === targetType));
    if (!tab) return { error: "tab-not-found" };
    const tabRect = layout.tabRects.find(rect => rect.tab.id === tab.id);
    return {
      tab: { x: tabRect.x + tabRect.w / 2, y: tabRect.y + tabRect.h / 2 },
      tabId: tab.id
    };
  }, type);
  if (placement.error) {
    await page.keyboard.press("b");
    return false;
  }

  await clickPoint(placement.tab);
  const itemPoint = await page.evaluate(targetType => {
    const layout = getBuildInventoryLayout();
    const row = layout.rows.find(candidate => candidate.type === "item" && candidate.item.name === targetType);
    return row ? { x: layout.sx + (layout.menuW - 20) / 2, y: row.y + row.h / 2 } : null;
  }, type);
  if (!itemPoint) {
    await page.keyboard.press("b");
    return false;
  }
  await clickPoint(itemPoint);
  if (type === "Drill") {
    const turnsToFront = await page.evaluate(() => (4 - rotation) % 4);
    for (let turn = 0; turn < turnsToFront; turn++) {
      await page.keyboard.press("r");
    }
  }

  const targetPoint = await page.evaluate(targetType => {
    const item = getInventoryItemByName(targetType);
    const [w, h] = item.size;
    const modules = placedModules.concat(blueprints);
    const computer = placedModules.find(module => module.type === "Computer");
    const center = getModuleCenter(computer || placedModules[0]);
    if (targetType === "Drill") {
      const minY = Math.min(...modules.map(module => module.y));
      const candidates = [];
      for (let y = minY - 1; y >= minY - 8; y--) {
        for (let x = Math.floor(center.x) - 12; x <= Math.floor(center.x) + 12; x++) {
          const test = { id: -1, x, y, type: targetType, w, h, rot: 0 };
          if (!canPlaceModule(x, y, w, h, modules) || !isConnected(modules.concat(test))) continue;
          candidates.push({ x, y, centerDistance: Math.abs(x - center.x) });
        }
        if (candidates.length > 0) break;
      }
      candidates.sort((a, b) => a.y - b.y || a.centerDistance - b.centerDistance);
      const candidate = candidates[0];
      if (candidate) {
        const worldX = ship.x + (candidate.x + Math.floor(w / 2)) * CONFIG.GRID_SIZE;
        const worldY = ship.y + (candidate.y + Math.floor(h / 2)) * CONFIG.GRID_SIZE;
        return worldToScreen(worldX, worldY);
      }
    }
    const maxRadius = 30;
    for (let radius = 1; radius <= maxRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (const dy of [-radius, radius]) {
          const anchorX = Math.round(center.x + dx);
          const anchorY = Math.round(center.y + dy);
          const test = { id: -1, x: anchorX, y: anchorY, type: targetType, w, h, rot: 0 };
          if (canPlaceModule(anchorX, anchorY, w, h, modules) && isConnected(modules.concat(test))) {
            const worldX = ship.x + (anchorX + Math.floor(w / 2)) * CONFIG.GRID_SIZE;
            const worldY = ship.y + (anchorY + Math.floor(h / 2)) * CONFIG.GRID_SIZE;
            return worldToScreen(worldX, worldY);
          }
        }
      }
      for (let dy = -radius + 1; dy < radius; dy++) {
        for (const dx of [-radius, radius]) {
          const anchorX = Math.round(center.x + dx);
          const anchorY = Math.round(center.y + dy);
          const test = { id: -1, x: anchorX, y: anchorY, type: targetType, w, h, rot: 0 };
          if (canPlaceModule(anchorX, anchorY, w, h, modules) && isConnected(modules.concat(test))) {
            const worldX = ship.x + (anchorX + Math.floor(w / 2)) * CONFIG.GRID_SIZE;
            const worldY = ship.y + (anchorY + Math.floor(h / 2)) * CONFIG.GRID_SIZE;
            return worldToScreen(worldX, worldY);
          }
        }
      }
    }
    return null;
  }, type);
  if (!targetPoint) {
    await page.keyboard.press("Escape");
    await page.keyboard.press("b");
    logEvent("action-failed", { action: "build", target: type, reason: "no-connected-space" });
    return false;
  }

  await page.mouse.move(targetPoint.x, targetPoint.y);
  await page.mouse.down();
  await delay(140);
  await page.mouse.up();
  await page.keyboard.press("b");
  countAction("build");
  // FIX 4: Track whether the build actually completed rather than silently returning true
  // on timeout. Previously .catch(()=>{}) swallowed the timeout and the bot thought
  // the building was placed when the UI may have been stuck.
  let buildConfirmed = false;
  await page.waitForFunction(targetType =>
    placedModules.some(module => module.type === targetType) || !commitPending
  , type, { timeout: 30000 })
    .then(() => { buildConfirmed = true; })
    .catch(() => {
      logEvent("action-failed", { action: "build", target: type, reason: "confirmation-timeout" });
    });
  return buildConfirmed;
}

async function researchTechnology(state, name) {
  const item = state.availableResearch.find(candidate => candidate.name === name);
  if (!item?.visible || item.unlocked || !item.affordable || moduleCount(state, "Laboratory") < 1) return false;
  markIntent("research", name, state, true);
  metrics.research[name].attempts++;
  lastDecision = `Researching ${name}`;
  logEvent("decision", { decision: "research", target: name, cost: item.cost });

  const labPoint = await page.evaluate(() => {
    const module = placedModules.find(candidate => candidate.type === "Laboratory");
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  });
  if (!labPoint) return false;
  await clickPoint(labPoint);
  // FIX 5: Add timeout and error handling so a missed click or stuck UI doesn't
  // throw an unhandled error that crashes the whole bot process.
  const researchWindowOpened = await page.waitForFunction(
    () => researchWindowOpen === true,
    {},
    { timeout: 8000 }
  ).then(() => true).catch(() => false);
  if (!researchWindowOpened) {
    logEvent("action-failed", { action: "research", target: name, reason: "research-window-did-not-open" });
    await page.keyboard.press("Escape");
    return false;
  }
  const rowPoint = await page.evaluate(targetName => {
    const row = getResearchRows().find(candidate =>
      candidate.type === "item" && candidate.item.name === targetName
    );
    return row ? { x: row.x + row.w / 2, y: row.y + row.h / 2 } : null;
  }, name);
  if (!rowPoint) {
    await page.keyboard.press("Escape");
    return false;
  }
  await clickPoint(rowPoint);
  await page.keyboard.press("Escape");
  countAction("research");
  return true;
}

async function steerTowardTarget(targetKind, maximumMs) {
  const started = Date.now();
  let lastCommand = null;
  while (Date.now() - started < maximumMs && !stopping) {
    if (await isPlayerInterfaceOpen()) {
      waitingForPlayerInterface = true;
      lastDecision = "Paused while the player uses an open window";
      await delay(250);
      continue;
    }
    waitingForPlayerInterface = false;
    const command = await page.evaluate(kind => {
      let target = null;
      if (kind === "blackhole") {
        target = blackHole;
      } else if (kind === "belt") {
        target = solarSystems
          .flatMap(system => getSystemBelts(system)
            .filter(Boolean)
            .map(belt => {
              const angle = Math.atan2(ship.y - belt.star.y, ship.x - belt.star.x);
              const radius = (belt.innerR + belt.outerR) / 2;
              return {
                x: belt.star.x + Math.cos(angle) * radius,
                y: belt.star.y + Math.sin(angle) * radius,
                radius: Math.max(CONFIG.GRID_SIZE * 3, (belt.outerR - belt.innerR) / 3)
              };
            }))
          .sort((a, b) =>
            Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y)
          )[0];
      } else {
        target = window.__balanceBotAsteroidTarget;
        if (!target || !asteroids.includes(target) || target.totalItems <= 0) return null;
      }
      if (!target) return null;
      const finalDx = target.x - ship.x;
      const finalDy = target.y - ship.y;
      const finalDistance = Math.max(0.001, Math.hypot(finalDx, finalDy));
      const shipRadius = getShipCollisionRadius();
      const waypointKey = kind === "asteroid"
        ? `asteroid:${target._balanceBotTargetId || asteroids.indexOf(target)}`
        : `${kind}:${Math.round(target.x)}:${Math.round(target.y)}`;
      let waypoint = window.__balanceBotFlightWaypoint;
      if (waypoint?.key !== waypointKey ||
          Math.hypot(waypoint.x - ship.x, waypoint.y - ship.y) <= CONFIG.GRID_SIZE * 2) {
        waypoint = null;
        window.__balanceBotFlightWaypoint = null;
      }

      const obstacles = kind === "blackhole" ? [] : [
        ...worldStars.map(body => ({ x: body.x, y: body.y, radius: body.radius, type: "star" })),
        ...planets.map(body => ({ x: body.x, y: body.y, radius: body.radius, type: "planet" })),
        ...asteroids
          .filter(body => body !== target && body.totalItems > 0)
          .map(body => ({ x: body.x, y: body.y, radius: body.size, type: "asteroid" }))
      ];

      if (!waypoint && kind !== "blackhole") {
        let blocking = null;
        for (const obstacle of obstacles) {
          const pathLengthSq = finalDx * finalDx + finalDy * finalDy;
          if (pathLengthSq <= 0.01) continue;
          const projection = Math.max(0, Math.min(1,
            ((obstacle.x - ship.x) * finalDx + (obstacle.y - ship.y) * finalDy) / pathLengthSq
          ));
          if (projection <= 0.02 || projection >= 0.98) continue;
          const closestX = ship.x + finalDx * projection;
          const closestY = ship.y + finalDy * projection;
          const clearance = obstacle.radius + shipRadius + CONFIG.GRID_SIZE * 10;
          if (Math.hypot(obstacle.x - closestX, obstacle.y - closestY) >= clearance) continue;
          if (!blocking || projection < blocking.projection) {
            blocking = { ...obstacle, clearance, projection };
          }
        }

        if (blocking) {
          const pathLength = Math.max(1, Math.hypot(finalDx, finalDy));
          const forwardX = finalDx / pathLength;
          const forwardY = finalDy / pathLength;
          const perpendicularX = -finalDy / pathLength;
          const perpendicularY = finalDx / pathLength;
          const candidates = [-1, 1].map(side => ({
            x: blocking.x +
              perpendicularX * blocking.clearance * side +
              forwardX * blocking.clearance * 0.75,
            y: blocking.y +
              perpendicularY * blocking.clearance * side +
              forwardY * blocking.clearance * 0.75,
            side
          }));
          candidates.sort((a, b) =>
            Math.hypot(a.x - ship.x, a.y - ship.y) + Math.hypot(target.x - a.x, target.y - a.y) -
            Math.hypot(b.x - ship.x, b.y - ship.y) - Math.hypot(target.x - b.x, target.y - b.y)
          );
          const selected = candidates[0];
          waypoint = {
            key: waypointKey,
            x: Math.max(CONFIG.GRID_SIZE, Math.min(CONFIG.WORLD_WIDTH - CONFIG.GRID_SIZE, selected.x)),
            y: Math.max(CONFIG.GRID_SIZE, Math.min(CONFIG.WORLD_HEIGHT - CONFIG.GRID_SIZE, selected.y)),
            obstacleType: blocking.type
          };
          window.__balanceBotFlightWaypoint = waypoint;
        }
      }

      const navigationTarget = waypoint || target;
      const dx = navigationTarget.x - ship.x;
      const dy = navigationTarget.y - ship.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const directionX = dx / distance;
      const directionY = dy / distance;
      const targetVx = target.vx || 0;
      const targetVy = target.vy || 0;
      const relativeVx = ship.vx - targetVx;
      const relativeVy = ship.vy - targetVy;
      const relativeSpeed = Math.hypot(relativeVx, relativeVy);
      const closingSpeed = relativeVx * directionX + relativeVy * directionY;
      const gap = Math.max(0, finalDistance - (target.radius || target.size || 0) - shipRadius);
      const velocitySq = ship.vx * ship.vx + ship.vy * ship.vy;
      const emergencyObstacle = velocitySq > 0.04
        ? obstacles
          .map(obstacle => {
            const obstacleDx = obstacle.x - ship.x;
            const obstacleDy = obstacle.y - ship.y;
            const framesAhead = (obstacleDx * ship.vx + obstacleDy * ship.vy) / velocitySq;
            if (framesAhead <= 0 || framesAhead > 240) return null;
            const closestX = ship.x + ship.vx * framesAhead;
            const closestY = ship.y + ship.vy * framesAhead;
            const clearance = obstacle.radius + shipRadius + CONFIG.GRID_SIZE * 6;
            const missDistance = Math.hypot(obstacle.x - closestX, obstacle.y - closestY);
            return missDistance < clearance
              ? { ...obstacle, framesAhead, missDistance, clearance }
              : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.framesAhead - b.framesAhead)[0] || null
        : null;
      let desiredVelocity;
      let speedTolerance = 0.15;
      let flightPhase = null;
      const controlledApproach = kind === "asteroid" || kind === "belt";
      if (controlledApproach) {
        const grid = CONFIG.GRID_SIZE;
        const travelGap = waypoint ? distance : gap;
        const cruiseSpeed = kind === "asteroid"
          ? (waypoint ? 4.0 : 3.0)
          : 4.4;
        const massFactor = getMassAccelerationFactor(placedModules);
        const reverseThrust = placedModules.reduce((best, module) => {
          const stats = BUILDING_STATS[module.type];
          if (!stats?.thrust) return best;
          const localDirection = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
          const isReverse = Math.abs(normalizeAngle(localDirection - Math.PI / 2)) < 0.5;
          return isReverse ? Math.max(best, stats.thrust * 0.12 * massFactor) : best;
        }, 0);
        const brakingDistance = Math.max(0, closingSpeed) ** 2 * 30 / Math.max(0.02, reverseThrust);
        const brakingMargin = Math.max(
          waypoint ? grid * 10 : grid * 16,
          Math.max(0, closingSpeed) * 60 * 1.5
        );
        const stateKey = `${waypointKey}:${waypoint ? "waypoint" : "target"}`;
        let flightState = window.__balanceBotFlightState;
        if (flightState?.key !== stateKey) {
          flightState = {
            key: stateKey,
            phase: relativeSpeed > cruiseSpeed + 0.3 ? "stabilize" : "accelerate"
          };
          window.__balanceBotFlightState = flightState;
        }
        const desiredCourseAngle = Math.atan2(dy, dx);
        const currentVelocityAngle = relativeSpeed > 0.05
          ? Math.atan2(relativeVy, relativeVx)
          : desiredCourseAngle;
        const courseChange = Math.abs(normalizeAngle(desiredCourseAngle - currentVelocityAngle));
        if (emergencyObstacle || (courseChange > 0.32 && relativeSpeed > 0.65)) {
          flightState.phase = "stabilize";
        }
        if (flightState.phase === "stabilize" &&
            relativeSpeed <= 0.28) {
          flightState.phase = travelGap <= brakingDistance + brakingMargin
            ? "brake"
            : "accelerate";
        }
        if (flightState.phase === "accelerate" &&
            relativeSpeed >= cruiseSpeed - 0.12) {
          flightState.phase = "coast";
        }
        if (flightState.phase === "coast" &&
            relativeSpeed < cruiseSpeed * 0.65 &&
            travelGap > brakingDistance + brakingMargin) {
          flightState.phase = "accelerate";
        }
        if ((flightState.phase === "accelerate" || flightState.phase === "coast") &&
            travelGap <= brakingDistance + brakingMargin) {
          flightState.phase = "brake";
        }
        if (flightState.phase === "brake" && relativeSpeed <= 0.18) {
          flightState.phase = "final";
        }
        flightPhase = flightState.phase;
        const finalFarSpeed = kind === "asteroid" ? 0.28 : 0.7;
        const finalNearSpeed = kind === "asteroid" ? 0.12 : 0.32;
        const approachSpeed = flightPhase === "accelerate"
          ? cruiseSpeed
          : flightPhase === "coast"
            ? cruiseSpeed
          : flightPhase === "brake" || flightPhase === "stabilize"
            ? 0
            : travelGap > grid * 2
              ? finalFarSpeed
              : finalNearSpeed;
        speedTolerance = flightPhase === "final" ? 0.05 : 0.12;
        desiredVelocity = {
          x: (waypoint ? 0 : targetVx) + directionX * approachSpeed,
          y: (waypoint ? 0 : targetVy) + directionY * approachSpeed
        };
      } else {
        desiredVelocity = getApproachCommandForState(
          ship.x,
          ship.y,
          ship.vx,
          ship.vy,
          {
            ...target,
            vx: targetVx,
            vy: targetVy,
            type: kind === "blackhole" ? "Black Hole" : "Asteroid Belt"
          }
        );
      }
      const correctionX = desiredVelocity ? desiredVelocity.x - ship.vx : target.x - ship.x;
      const correctionY = desiredVelocity ? desiredVelocity.y - ship.vy : target.y - ship.y;
      const correctionMagnitude = Math.hypot(correctionX, correctionY);
      const correctionAlongPath = correctionX * directionX + correctionY * directionY;
      const correctionAngle = Math.atan2(correctionY, correctionX);
      const thrusterCandidates = [];
      for (const module of placedModules) {
        const stats = BUILDING_STATS[module.type];
        if (!stats?.thrust) continue;
        const localDirection = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
        const key =
          Math.abs(normalizeAngle(localDirection + Math.PI / 2)) < 0.5 ? "w" :
          Math.abs(normalizeAngle(localDirection - Math.PI / 2)) < 0.5 ? "s" :
          Math.abs(normalizeAngle(localDirection - Math.PI)) < 0.5 ? "q" :
          Math.abs(normalizeAngle(localDirection)) < 0.5 ? "e" :
          null;
        if (!key) continue;
        const desiredAngle = normalizeAngle(correctionAngle - localDirection);
        const angleError = normalizeAngle(desiredAngle - ship.angle);
        thrusterCandidates.push({ key, localDirection, angleError, thrust: stats.thrust });
      }
      if (thrusterCandidates.length === 0) return null;
      const miningActive = kind === "asteroid" && placedModules.some(module =>
        module.type === "Drill" &&
        module._drillAsteroid === target &&
        target.totalItems > 0
      );
      const drillAlignment = kind === "asteroid"
        ? placedModules
          .filter(module => module.type === "Drill" && getModuleHealth(module) > 0)
          .map(module => {
            const drillLocalFront =
              (module.rot || 0) * Math.PI / 2 - Math.PI / 2 - SHIP_NOSE_OFFSET;
            const desiredShipAngle = normalizeAngle(
              Math.atan2(target.y - ship.y, target.x - ship.x) - drillLocalFront
            );
            return {
              module,
              angleError: normalizeAngle(desiredShipAngle - ship.angle)
            };
          })
          .sort((a, b) => Math.abs(a.angleError) - Math.abs(b.angleError))[0]
        : null;
      const needsMiningAlignment = miningActive || (
        kind === "asteroid" &&
        gap <= CONFIG.GRID_SIZE * 3 &&
        relativeSpeed <= 0.35
      );
      let selectedThruster;
      if (controlledApproach && flightPhase !== "stabilize") {
        const forwardThruster = thrusterCandidates
          .filter(candidate => candidate.key === "w")
          .map(candidate => {
            const desiredAngle = normalizeAngle(Math.atan2(dy, dx) - candidate.localDirection);
            return {
              ...candidate,
              angleError: normalizeAngle(desiredAngle - ship.angle)
            };
          })
          .sort((a, b) => Math.abs(a.angleError) - Math.abs(b.angleError) || b.thrust - a.thrust)[0];
        if (!forwardThruster) return null;
        const reverseThruster = thrusterCandidates
          .filter(candidate => candidate.key === "s")
          .sort((a, b) => b.thrust - a.thrust)[0];
        selectedThruster = {
          ...forwardThruster,
          key: (
            (flightPhase === "brake" && closingSpeed > 0.05) ||
            (flightPhase === "final" && correctionAlongPath < -0.02)
          ) && reverseThruster ? "s" : "w",
          angleError: needsMiningAlignment && drillAlignment
            ? drillAlignment.angleError
            : forwardThruster.angleError
        };
      } else if (needsMiningAlignment && flightPhase !== "stabilize") {
        selectedThruster = thrusterCandidates
          .filter(candidate => candidate.key === "w")
          .map(candidate => {
            const desiredAngle = normalizeAngle(Math.atan2(dy, dx) - candidate.localDirection);
            return {
              ...candidate,
              angleError: normalizeAngle(desiredAngle - ship.angle)
            };
          })
          .sort((a, b) => Math.abs(a.angleError) - Math.abs(b.angleError) || b.thrust - a.thrust)[0];
      } else {
        selectedThruster = thrusterCandidates
          .sort((a, b) => Math.abs(a.angleError) - Math.abs(b.angleError) || b.thrust - a.thrust)[0];
      }
      if (!selectedThruster) return null;
      return {
        angleError: selectedThruster.angleError,
        thrustKey: selectedThruster.key,
        correctionMagnitude,
        shouldThrust: controlledApproach
          ? flightPhase === "accelerate" ||
            (flightPhase !== "coast" && correctionMagnitude > speedTolerance)
          : correctionMagnitude > speedTolerance,
        flightPhase,
        gap,
        relativeSpeed,
        closingSpeed,
        waypoint: waypoint ? {
          x: waypoint.x,
          y: waypoint.y,
          obstacleType: waypoint.obstacleType,
          distance
        } : null,
        emergencyObstacle: emergencyObstacle ? {
          type: emergencyObstacle.type,
          framesAhead: emergencyObstacle.framesAhead,
          missDistance: emergencyObstacle.missDistance,
          clearance: emergencyObstacle.clearance
        } : null,
        miningActive,
        alignOnly: miningActive && relativeSpeed <= 0.25,
        drillAligned: !drillAlignment || Math.abs(drillAlignment.angleError) <= 0.035,
        close: kind === "asteroid"
          ? miningActive &&
            relativeSpeed <= 0.25 &&
            (!drillAlignment || Math.abs(drillAlignment.angleError) <= 0.035)
          : gap <= CONFIG.GRID_SIZE * (kind === "blackhole" ? 2 : 4),
        ended: appState === "blackHoleEnd"
      };
    }, targetKind);
    lastCommand = command;
    if (!command || command.ended) {
      logEvent("target-lost", { targetKind });
      return !!command;
    }
    if (command.close) {
      if (targetKind !== "asteroid") await pressBotFlightKey(" ", 1200);
      logEvent("target-arrived", {
        targetKind,
        gap: command.gap,
        relativeSpeed: command.relativeSpeed
      });
      return true;
    }
    const rotationTolerance = targetKind === "asteroid"
      ? command.flightPhase === "final" || command.miningActive ? 0.04 : 0.08
      : 0.1;
    if (Math.abs(command.angleError) > rotationTolerance) {
      const key = command.angleError < 0 ? "a" : "d";
      const turnMs = targetKind === "asteroid"
        ? Math.min(80, 18 + Math.abs(command.angleError) * 32)
        : Math.min(260, 70 + Math.abs(command.angleError) * 90);
      await pressBotFlightKey(key, turnMs);
    } else if (!command.alignOnly && command.shouldThrust) {
      const controlledApproach = targetKind === "asteroid" || targetKind === "belt";
      const thrustMs = controlledApproach
        ? command.flightPhase === "accelerate" ? 320 :
          command.flightPhase === "brake" || command.flightPhase === "stabilize" ? 360 :
          220
        : command.gap > 40 * 30 ? 650 : 300;
      await pressBotFlightKey(command.thrustKey || "w", thrustMs);
    }
    await delay(targetKind === "asteroid" || targetKind === "belt"
      ? command.flightPhase === "coast" ? 250 :
        command.flightPhase === "accelerate" ? 100 :
        command.shouldThrust ? 120 :
        260
      : 80);
  }
  logEvent("target-approach-timeout", {
    targetKind,
    maximumMs,
    gap: lastCommand?.gap ?? null,
    relativeSpeed: lastCommand?.relativeSpeed ?? null,
    closingSpeed: lastCommand?.closingSpeed ?? null,
    waypoint: lastCommand?.waypoint ?? null,
    emergencyObstacle: lastCommand?.emergencyObstacle ?? null,
    flightPhase: lastCommand?.flightPhase ?? null,
    angleError: lastCommand?.angleError ?? null,
    shouldThrust: lastCommand?.shouldThrust ?? null,
    thrustKey: lastCommand?.thrustKey ?? null,
    correctionMagnitude: lastCommand?.correctionMagnitude ?? null
  });
  return true;
}

async function approachAsteroid(state) {
  if (!state.nearestAsteroid || state.res.fuel <= 2) return false;
  const estimatedFuel = estimateAsteroidFlightFuel(state.nearestAsteroid.distance);
  const fuelRecoveryActive = !!getFuelRecoveryTarget(state);
  if (state.res.fuel < estimatedFuel) {
    lastDecision = `Waiting for a reachable fuel recovery target`;
    logEvent("flight-not-started", {
      targetKind: "asteroid",
      reason: "estimated-fuel-insufficient",
      fuel: state.res.fuel,
      estimatedFuel: Number(estimatedFuel.toFixed(1)),
      distance: state.nearestAsteroid.distance,
      fuelRecoveryActive,
      targetRecoveryValue: state.nearestAsteroid.fuelRecoveryValue || 0,
      contents: state.nearestAsteroid.contents
    });
    return false;
  }
  lastDecision = "Approaching a resource asteroid";
  logEvent("decision", {
    decision: "approach-asteroid",
    distance: state.nearestAsteroid.distance,
    contents: state.nearestAsteroid.contents,
    estimatedFuel: Number(estimatedFuel.toFixed(1)),
    fuelRecoveryActive
  });
  const reached = await steerTowardTarget("asteroid", Math.max(45000, 75000 - config.skill * 200));
  countAction("approach-asteroid");
  return reached;
}

async function approachResourceBelt(state) {
  if (!state.nearestBelt) return false;
  const estimatedFuel = estimateBeltFlightFuel(state.nearestBelt.distance);
  if (state.res.fuel < estimatedFuel) {
    lastDecision = "Waiting for enough fuel to reach the asteroid belt";
    logEvent("flight-not-started", {
      targetKind: "belt",
      reason: "estimated-fuel-insufficient",
      fuel: state.res.fuel,
      estimatedFuel: Number(estimatedFuel.toFixed(1)),
      distance: state.nearestBelt.distance
    });
    return false;
  }
  lastDecision = "Flying to the nearest asteroid belt";
  logEvent("decision", {
    decision: "approach-resource-belt",
    distance: state.nearestBelt.distance,
    beltKind: state.nearestBelt.kind,
    ship: { x: state.ship.x, y: state.ship.y },
    target: { x: state.nearestBelt.x, y: state.nearestBelt.y },
    estimatedFuel: Number(estimatedFuel.toFixed(1))
  });
  const reached = await steerTowardTarget("belt", Math.max(7000, 16000 - config.skill * 55));
  countAction("approach-resource-belt");
  return reached;
}

async function approachBlackHole() {
  const exists = await page.evaluate(() => !!blackHole);
  if (!exists) return false;
  lastDecision = "Entering the black hole";
  logEvent("decision", { decision: "approach-black-hole" });
  await steerTowardTarget("blackhole", Math.max(20000, 45000 - config.skill * 150));
  countAction("approach-black-hole");
  return true;
}

async function setAssemblerTargets(state) {
  const assembler = state.modules.find(module => module.type === "Assembler");
  if (!assembler) return false;
  const plan = getPlannedProductionTargets(state);
  const desired = { ...plan.assembler };
  if (moduleCount(state, "Gun Turret") > 0) desired.ammo = Math.max(desired.ammo || 0, 100);
  if (moduleCount(state, "Cannon Turret") > 0) desired.cannonBalls = Math.max(desired.cannonBalls || 0, 80);
  if (moduleCount(state, "Railgun Turret") > 0) desired.railgunRods = Math.max(desired.railgunRods || 0, 30);
  if (moduleCount(state, "Missile Turret") > 0) {
    desired.rocketAmmunition = Math.max(desired.rocketAmmunition || 0, 30);
  }
  const target = Object.entries(desired).find(([key, value]) =>
    (assembler.assemblerTargets?.[key] || 0) !== value
  );
  if (!target) return false;

  const [key, value] = target;
  const modulePoint = await page.evaluate(id => {
    const module = placedModules.find(candidate => candidate.id === id);
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  }, assembler.id);
  if (!modulePoint) return false;
  await clickPoint(modulePoint);
  const rowPoint = await page.evaluate(targetKey => {
    const layout = getAssemblerWindowLayout();
    const index = getAssemblerRecipeKeys().indexOf(targetKey);
    return index < 0 ? null : {
      x: layout.x + layout.width / 2,
      y: layout.y + 56 + index * 42 + layout.rowH / 2
    };
  }, key);
  if (!rowPoint) {
    await page.keyboard.press("Escape");
    return false;
  }
  await clickPoint(rowPoint);
  await replaceDialogValue(value);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting ${key} production target to ${value}`;
  logEvent("decision", {
    decision: "assembler-target",
    resource: key,
    target: value,
    plannedFor: plan.objectives.map(objective => `${objective.kind}:${objective.name}`)
  });
  countAction("assembler-target");
  return true;
}

async function setSmelterTargets(state) {
  const smelter = state.modules.find(module => module.type === "Smelter");
  if (!smelter) return false;
  const plan = getPlannedProductionTargets(state);
  const desired = plan.smelter;
  const target = Object.entries(desired).find(([key, value]) =>
    (smelter.smelterTargets?.[key] || 0) !== value
  );
  if (!target) return false;

  const [key, value] = target;
  const modulePoint = await page.evaluate(id => {
    const module = placedModules.find(candidate => candidate.id === id);
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  }, smelter.id);
  if (!modulePoint) return false;
  await clickPoint(modulePoint);
  const rowPoint = await page.evaluate(targetKey => {
    const layout = getSmelterWindowLayout();
    const index = getSmelterRecipeKeys().indexOf(targetKey);
    return index < 0 ? null : {
      x: layout.x + layout.width / 2,
      y: layout.y + 56 + index * 42 + layout.rowH / 2
    };
  }, key);
  if (!rowPoint) {
    await page.keyboard.press("Escape");
    return false;
  }
  await clickPoint(rowPoint);
  await replaceDialogValue(value);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting ${key} smelting target to ${value}`;
  logEvent("decision", {
    decision: "smelter-target",
    resource: key,
    target: value,
    plannedFor: plan.objectives.map(objective => `${objective.kind}:${objective.name}`)
  });
  countAction("smelter-target");
  return true;
}

async function setElectrolyserTargets(state) {
  const electrolyser = state.modules.find(module => module.type === "Electrolyser");
  if (!electrolyser) return false;
  const desired = { hydrogen: 100, oxygen: 50 };
  const target = Object.entries(desired).find(([key, value]) =>
    (electrolyser.electrolyserTargets?.[key] || 0) !== value
  );
  if (!target) return false;

  const [key, value] = target;
  const modulePoint = await page.evaluate(id => {
    const module = placedModules.find(candidate => candidate.id === id);
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  }, electrolyser.id);
  if (!modulePoint) return false;
  await clickPoint(modulePoint);
  const rowPoint = await page.evaluate(targetKey => {
    const layout = getElectrolyserWindowLayout();
    const index = ["hydrogen", "oxygen"].indexOf(targetKey);
    return index < 0 ? null : {
      x: layout.x + layout.width / 2,
      y: layout.y + 56 + index * 42 + layout.rowH / 2
    };
  }, key);
  if (!rowPoint) {
    await page.keyboard.press("Escape");
    return false;
  }
  await clickPoint(rowPoint);
  await replaceDialogValue(value);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting ${key} minimum to ${value}`;
  logEvent("decision", { decision: "electrolyser-target", resource: key, target: value });
  countAction("electrolyser-target");
  return true;
}

async function setFuelProcessorTarget(state) {
  const processor = state.modules.find(module => module.type === "Fuel Processor");
  if (!processor) return false;
  const desired = Math.max(75, Math.floor((state.res.fuelCap || 100) * 0.9));
  if ((processor.fuelProcessorTarget || 0) === desired) return false;

  const modulePoint = await page.evaluate(id => {
    const module = placedModules.find(candidate => candidate.id === id);
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  }, processor.id);
  if (!modulePoint) return false;
  await clickPoint(modulePoint);
  const rowPoint = await page.evaluate(() => {
    const layout = getFuelProcessorWindowLayout();
    return {
      x: layout.x + layout.width / 2,
      y: layout.y + 56 + layout.rowH / 2
    };
  });
  await clickPoint(rowPoint);
  await replaceDialogValue(desired);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting fuel minimum to ${desired}`;
  logEvent("decision", { decision: "fuel-processor-target", resource: "fuel", target: desired });
  countAction("fuel-processor-target");
  return true;
}

async function setFarmTarget(state) {
  const farm = state.modules.find(module => module.type === "Farm Module");
  if (!farm) return false;
  const supportsFarmTargets = await page.evaluate(
    () => typeof getFarmWindowLayout === "function"
  );
  if (!supportsFarmTargets) return false;
  const desired = Math.max(40, Math.min(state.res.foodCap || 200, (state.res.crew || 1) * 30));
  if ((farm.farmTarget || 0) === desired) return false;

  const modulePoint = await page.evaluate(id => {
    const module = placedModules.find(candidate => candidate.id === id);
    if (!module) return null;
    const world = moduleWorldCenter(module);
    return worldToScreen(world.x, world.y);
  }, farm.id);
  if (!modulePoint) return false;
  await clickPoint(modulePoint);
  const rowPoint = await page.evaluate(() => {
    const layout = getFarmWindowLayout();
    return {
      x: layout.x + layout.width / 2,
      y: layout.y + 56 + layout.rowH / 2
    };
  });
  await clickPoint(rowPoint);
  await replaceDialogValue(desired);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting food minimum to ${desired}`;
  logEvent("decision", { decision: "farm-target", resource: "food", target: desired });
  countAction("farm-target");
  return true;
}

async function handleFuelRecovery(state) {
  const target = getFuelRecoveryTarget(state);
  if (!target) return { active: false, acted: false, wait: false };

  if (target.kind === "research") {
    const item = state.availableResearch.find(candidate => candidate.name === target.name);
    markIntent("research", target.name, state, !!item?.affordable);
    lastDecision = `Securing fuel reserve: research ${target.name}`;
    if (item?.affordable && await researchTechnology(state, target.name)) {
      return { active: true, acted: true, wait: false };
    }
    return { active: true, acted: false, wait: false };
  }

  if (target.kind === "building") {
    const affordable = hasResources(state, target.cost);
    markIntent("buildings", target.name, state, affordable);
    lastDecision = `Securing fuel reserve: build ${target.name}`;
    if (affordable && await buildBuilding(state, target.name)) {
      return { active: true, acted: true, wait: false };
    }
    return { active: true, acted: false, wait: false };
  }

  lastDecision = (state.res.water || 0) < 20
    ? "Gathering water for fuel production"
    : `Producing fuel until the reserve reaches ${Math.ceil(getFuelThreshold(state))}`;
  return { active: true, acted: false, wait: false };
}

function chooseResearch(state) {
  const priorities = [
    "Drill", "Smelter", "Electrolyser", "Fuel Processor", "Computer MK2",
    "Tank MK1", "Assembler", "Main Thruster", "Battery MK1", "Reactor", "Turbine",
    "Hangar MK1", "Computer MK3", "Warehouse MK2", "Tank MK2", "Gun Turret",
    "Shield Generator", "Condenser Turbine", "Scooper", "Solar Wind Collector",
    "Battery MK2", "Cannon Turret", "Railgun Turret", "Missile Turret",
    "Laser Turret", "Computer MK4", "Fusion Reactor", "Event Horizon Shield",
    "Gravitational Pull Stabilizer", "Quantum Computer"
  ];
  return priorities.find(name => {
    const item = state.availableResearch.find(candidate => candidate.name === name);
    return item?.visible && !item.unlocked;
  }) || null;
}

function chooseBuilding(state) {
  const counts = type => moduleCount(state, type);
  const unlocked = type => state.unlockedBuildings.includes(type);
  const affordable = type => unlocked(type) && hasResources(state, state.buildCosts[type]);

  if (counts("Laboratory") === 0 && affordable("Laboratory")) return "Laboratory";
  if ((state.res.energyNet || 0) < 0.5 && affordable("Solar Panel")) return "Solar Panel";
  if (state.itemStorageCap > 0 && state.itemStorageUsed / state.itemStorageCap > 0.82 &&
      affordable(state.research.includes("Warehouse MK2") ? "Warehouse MK2" : "Warehouse MK1")) {
    return state.research.includes("Warehouse MK2") ? "Warehouse MK2" : "Warehouse MK1";
  }
  if (counts("Smelter") === 0 && affordable("Smelter")) return "Smelter";
  if (counts("Drill") === 0 && affordable("Drill")) return "Drill";
  if (counts("Assembler") === 0 && affordable("Assembler")) return "Assembler";
  if (counts("Electrolyser") === 0 && affordable("Electrolyser")) return "Electrolyser";
  if (counts("Fuel Processor") === 0 && affordable("Fuel Processor")) return "Fuel Processor";
  if (counts("Main Thruster") === 0 && affordable("Main Thruster")) return "Main Thruster";
  if (counts("Reactor") === 0 && (state.res.uranium || 0) >= 10 && affordable("Reactor")) return "Reactor";
  if (counts("Reactor") > 0 && counts("Turbine") === 0 && affordable("Turbine")) return "Turbine";
  if (counts("Fusion Reactor") === 0 && affordable("Fusion Reactor")) return "Fusion Reactor";
  if (state.enemies > 0 && counts("Gun Turret") === 0 && affordable("Gun Turret") &&
      (state.res.ammo || 0) >= 10) return "Gun Turret";
  if (state.enemies > 0 && counts("Shield Generator") === 0 && affordable("Shield Generator")) return "Shield Generator";
  if (counts("Quantum Computer") === 0 && affordable("Quantum Computer")) return "Quantum Computer";
  if (counts("Gravitational Pull Stabilizer") === 0 && affordable("Gravitational Pull Stabilizer")) {
    return "Gravitational Pull Stabilizer";
  }
  if (unlocked("Event Horizon Shield") &&
      state.readiness.eventShields < state.readiness.requiredShields &&
      affordable("Event Horizon Shield")) return "Event Horizon Shield";
  if ((state.res.energyCap || 0) < 50000) {
    if (affordable("Battery MK2")) return "Battery MK2";
    if (affordable("Battery MK1") && (state.res.energyCap || 0) < 1000) return "Battery MK1";
  }
  return null;
}

function chooseBuildingGoal(state) {
  if (moduleCount(state, "Laboratory") === 0) return "Laboratory";
  if (state.research.includes("Drill") && moduleCount(state, "Drill") === 0) return "Drill";
  if (state.research.includes("Smelter") && moduleCount(state, "Smelter") === 0) return "Smelter";
  return chooseBuilding(state);
}

function recordShortages(state) {
  const candidates = [];
  if (moduleCount(state, "Laboratory") === 0) candidates.push(["Laboratory", state.buildCosts.Laboratory]);
  const nextResearch = state.availableResearch.find(item => item.visible && !item.unlocked);
  if (nextResearch) candidates.push([`Research: ${nextResearch.name}`, nextResearch.cost]);
  for (const [goal, cost] of candidates) {
    for (const [key, amount] of Object.entries(cost || {})) {
      const missing = Math.max(0, amount - (state.res[key] || 0));
      if (missing <= 0) continue;
      const id = `${goal}:${key}`;
      const entry = metrics.shortages[id] || {
        goal,
        resource: key,
        firstSeenAtSeconds: Number(elapsedSeconds().toFixed(1)),
        samples: 0,
        maximumMissing: 0
      };
      entry.samples++;
      entry.maximumMissing = Math.max(entry.maximumMissing, missing);
      entry.latestMissing = missing;
      metrics.shortages[id] = entry;
    }
  }
}

async function decide(state) {
  if (state.commitPending || state.blueprints > 0) {
    lastDecision = "Waiting for crew construction";
    return false;
  }

  if (await setSmelterTargets(state)) return true;
  if (await setElectrolyserTargets(state)) return true;
  if (await setFuelProcessorTarget(state)) return true;
  if (await setFarmTarget(state)) return true;

  if (state.readiness.energy &&
      state.readiness.stabilizer &&
      state.readiness.quantum &&
      state.readiness.shields) {
    return approachBlackHole();
  }

  if (moduleCount(state, "Laboratory") === 0) {
    const affordable = hasResources(state, state.buildCosts.Laboratory);
    markIntent("buildings", "Laboratory", state, affordable);
    if (affordable && await buildBuilding(state, "Laboratory")) return true;
    lastDecision = "Collecting ore to build the Laboratory";
    return false;
  }

  if (!state.research.includes("Drill")) {
    const item = state.availableResearch.find(candidate => candidate.name === "Drill");
    markIntent("research", "Drill", state, !!item?.affordable);
    if (item?.affordable && await researchTechnology(state, "Drill")) return true;
    lastDecision = "Collecting ore to research the Drill";
    return false;
  }

  if (moduleCount(state, "Drill") === 0) {
    const affordable = hasResources(state, state.buildCosts.Drill);
    markIntent("buildings", "Drill", state, affordable);
    if (affordable && await buildBuilding(state, "Drill")) return true;
    lastDecision = "Collecting ore to build the Drill";
    return false;
  }

  let blockedProgressionGoal = null;
  if (!state.research.includes("Smelter")) {
    const item = state.availableResearch.find(candidate => candidate.name === "Smelter");
    markIntent("research", "Smelter", state, !!item?.affordable);
    if (item?.affordable && await researchTechnology(state, "Smelter")) return true;
    lastDecision = "Collecting ore to research the Smelter";
    blockedProgressionGoal = { kind: "research", name: "Smelter" };
  } else if (moduleCount(state, "Smelter") === 0) {
    const affordable = hasResources(state, state.buildCosts.Smelter);
    markIntent("buildings", "Smelter", state, affordable);
    if (affordable && await buildBuilding(state, "Smelter")) return true;
    lastDecision = "Collecting ore to build the Smelter";
    blockedProgressionGoal = { kind: "building", name: "Smelter" };
  }

  // FIX 3: Even when a progression goal is blocked (e.g. waiting for Smelter materials),
  // we must not skip fuel recovery entirely — if fuel runs out we'll be permanently stuck.
  // Allow fuel recovery to run when fuel is critically low (<=2), regardless of blockedProgressionGoal.
  const fuelCritical = (state.res.fuel || 0) <= 2;
  const fuelRecovery = (blockedProgressionGoal && !fuelCritical)
    ? { active: false, acted: false, wait: false }
    : await handleFuelRecovery(state);
  if (fuelRecovery.acted || fuelRecovery.wait) return fuelRecovery.acted;

  if (!blockedProgressionGoal &&
      !fuelRecovery.active &&
      await setAssemblerTargets(state)) {
    return true;
  }

  const research = blockedProgressionGoal || fuelRecovery.active ? null : chooseResearch(state);
  if (research) {
    const item = state.availableResearch.find(candidate => candidate.name === research);
    const canUseLaboratory = moduleCount(state, "Laboratory") > 0;
    markIntent("research", research, state, !!item?.affordable && canUseLaboratory);
    if (item?.affordable && await researchTechnology(state, research)) return true;
    lastDecision = `Collecting materials for research: ${research}`;
  }

  const building = blockedProgressionGoal || fuelRecovery.active ? null : chooseBuildingGoal(state);
  if (building) {
    const affordable = hasResources(state, state.buildCosts[building]);
    markIntent("buildings", building, state, affordable);
    if (affordable && await buildBuilding(state, building)) return true;
    lastDecision = `Collecting materials for building: ${building}`;
  }

  const hasOperationalDrill = moduleCount(state, "Drill") > 0;
  const minimumFlightFuel = blockedProgressionGoal || fuelRecovery.active
    ? 2
    : getFuelThreshold(state);
  const miningTravelTarget = hasOperationalDrill && !state.asteroidMining
    ? chooseMiningTravelTarget(state)
    : null;
  if (miningTravelTarget === "belt") {
    return approachResourceBelt(state);
  }
  if (miningTravelTarget === "asteroid") {
    // FIX 1: Allow flying if we have enough fuel for THIS specific trip (with 30% margin),
    // even if we haven't reached the general tank threshold yet.
    // Previously the bot would sit idle waiting for e.g. 150 fuel when the asteroid only costs 9.
    const tripFuel = estimateAsteroidFlightFuel(state.nearestAsteroid.distance) * 1.3;
    const enoughForThisTrip = state.res.fuel >= tripFuel;
    if (state.res.fuel > minimumFlightFuel || enoughForThisTrip) {
      return approachAsteroid(state);
    }
  }

  if (!fuelRecovery.active) lastDecision = "Observing resource production";
  return false;
}

async function saveGame(reason = "interval") {
  if (!page || page.isClosed()) return;
  const payload = await page.evaluate(number =>
    createSavePayload(`Balance Bot ${number}`)
  , worldNumber);
  writeJson(savePath, payload);
  lastSaveAt = Date.now();
  saveCount++;
  logEvent("save-written", {
    reason,
    worldNumber,
    worldPlayTime: payload.worldPlayTime
  });
}

function finishResult(result, reason) {
  metrics.result = result;
  metrics.resultReason = reason;
  metrics.finishedAt = nowIso();
  metrics.durationSeconds = Number(elapsedSeconds().toFixed(1));
  stopping = true;
  stopReason = reason;
  logEvent("run-finished", { result, reason });
}

function checkTerminalState(state) {
  if (state.appState === "blackHoleEnd") {
    finishResult(state.endingResult === "success" ? "success" : "lost", state.endingReason || state.endingResult);
    return true;
  }
  if (state.blackHoleCompleted) {
    finishResult("success", "black-hole-completed");
    return true;
  }
  if ((state.res.fuel || 0) <= 0 && (state.res.water || 0) <= 0) {
    finishResult("softlock", "fuel-and-water-empty");
    return true;
  }
  const canProduceFuel = moduleCount(state, "Electrolyser") > 0 &&
    moduleCount(state, "Fuel Processor") > 0 &&
    (state.res.water || 0) > 0 &&
    (state.res.energy || 0) > 0;
  if ((state.res.fuel || 0) <= 0 && !canProduceFuel) {
    finishResult("softlock", "fuel-empty-and-no-fuel-production");
    return true;
  }
  if (Date.now() - lastProgressAt >= config.softlockMinutes * 60000) {
    finishResult("softlock", `no-meaningful-progress-for-${config.softlockMinutes}-minutes`);
    return true;
  }
  return false;
}

function removeAbortedRunData() {
  const reportRootAbsolute = path.resolve(reportRoot);
  const sessionAbsolute = path.resolve(runDir);
  const insideDirectory = (candidate, directory) =>
    candidate.startsWith(`${directory}${path.sep}`);

  if (!insideDirectory(sessionAbsolute, reportRootAbsolute)) {
    throw new Error("Refusing to delete a session outside the report directory.");
  }
  if (fs.existsSync(sessionAbsolute)) {
    fs.rmSync(sessionAbsolute, { recursive: true, force: true });
  }
}

async function cleanup() {
  cleanupStarted = true;
  try {
    if (page && !page.isClosed()) await saveGame("shutdown");
  } catch (error) {
    logEvent("save-failed", { reason: "shutdown", error: String(error) });
  }
  metrics.finishedAt = metrics.finishedAt || nowIso();
  metrics.durationSeconds = metrics.durationSeconds || Number(elapsedSeconds().toFixed(1));
  if (metrics.result === "running") {
    metrics.result = stopReason === "smoke-test-complete" ? "smoke-test" : "stopped";
    metrics.resultReason = stopReason;
  }
  writeJson(metricsPath, metrics);
  updateStatus();
  if (page && !page.isClosed()) {
    await page.evaluate(() => {
      window.__balanceBotInputLock = false;
      window.__balanceBotKeyPermission = null;
      localStorage.clear();
    }).catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) server.kill();

  const manuallyStopped = stopReason === "manual-terminal-stop" ||
    stopReason === "manual-browser-close" ||
    stopReason === "manual-stop";
  let createEvaluation = !manuallyStopped || smokeTest;
  if (manuallyStopped && !smokeTest && process.stdin.isTTY) {
    const answer = (await askTerminal(
      "\nReport erstellen und Laufordner behalten? (j/N, N loescht den Laufordner): "
    )).trim().toLowerCase();
    createEvaluation = ["j", "ja", "y", "yes"].includes(answer);
  }
  if (createEvaluation) {
    writeReport();
    console.log(`Auswertung erstellt: ${reportPath}`);
  } else {
    removeAbortedRunData();
    console.log(`Run verworfen. Die Vorlage ${worldNumber} wurde nicht veraendert.`);
    closeTerminal();
    return;
  }
  console.log(`Lauf-Spielstand gespeichert: ${savePath}`);
  if (worldPath) console.log(`Vorlage unveraendert: ${worldPath}`);
  else if (createFreshWorld) console.log("Der Lauf wurde mit einer frisch generierten Welt gestartet.");
  console.log(`Laufdaten: ${runDir}`);
  closeTerminal();
}

async function main() {
  await selectWorld();
  writeJson(metricsPath, metrics);
  logEvent("run-started", {
    runId,
    worldNumber,
    config,
    resumedSave: metrics.resumedSave
  });
  const url = await startServer(getFreePort());
  await initializeGame(url);
  const initialState = await readState();
  metrics.initialState = {
    worldPlayTime: initialState.worldPlayTime,
    resources: { ...initialState.res },
    research: initialState.research.slice().sort(),
    buildings: initialState.modules.reduce((counts, module) => {
      counts[module.type] = (counts[module.type] || 0) + 1;
      return counts;
    }, {})
  };
  logEvent("starting-state-recorded", metrics.initialState);
  await saveGame("initial");

  let loopCount = 0;
  while (!stopping) {
    if (!await prepareBotInterface()) {
      updateStatus();
      await delay(500);
      continue;
    }
    const state = await readState();
    markCompletions(state);
    recordResourceMilestones(state);
    recordShortages(state);
    updateProgress(state);
    await publishGoalQueue(state);
    updateStatus(state);
    writeJson(metricsPath, metrics);

    if (checkTerminalState(state)) break;
    if (Date.now() - lastSaveAt >= config.saveIntervalMs) await saveGame();

    await decide(state);
    loopCount++;
    if (smokeTest && loopCount >= smokeLoopLimit) {
      stopReason = "smoke-test-complete";
      stopping = true;
      break;
    }
    await delay(getReactionDelay());
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopReason = "manual-terminal-stop";
    stopping = true;
  });
}

main()
  .catch(error => {
    if (stopReason === "manual-browser-close") return;
    stopping = true;
    stopReason = "error";
    metrics.result = "error";
    metrics.resultReason = error?.message || String(error);
    metrics.error = error?.stack || String(error);
    if (metricsPath) writeJson(metricsPath, metrics);
    if (statusPath) updateStatus();
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (runDir) await cleanup();
    else closeTerminal();
  });
