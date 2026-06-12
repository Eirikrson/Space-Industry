const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const BOT_DIR = __dirname;
const ROOT = path.resolve(BOT_DIR, "..", "..");
const CONFIG_PATH = path.join(BOT_DIR, "balance-bot-configuration.json");
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const args = process.argv.slice(2);
const requestedResumeSave = args
  .find(arg => arg.startsWith("--resume-save="))
  ?.slice("--resume-save=".length);

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (config.mode !== "survival") {
    throw new Error(`Unsupported Balance Bot mode: ${config.mode}. Only "survival" is implemented.`);
  }
  config.skill = Math.max(1, Math.min(100, Number(config.skill) || 1));
  config.decisionIntervalMs = Math.max(500, Number(config.decisionIntervalMs) || 2500);
  config.saveIntervalMs = Math.max(10000, Number(config.saveIntervalMs) || 60000);
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
const archiveRoot = path.join(BOT_DIR, "archive");
const runDir = path.join(archiveRoot, runId);
const savePath = path.join(runDir, "save.json");
const metricsPath = path.join(runDir, "metrics.json");
const reportPath = path.join(runDir, "report.md");
const statusPath = path.join(runDir, "status.json");

fs.mkdirSync(runDir, { recursive: true });

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

const metrics = {
  runId,
  mode: config.mode,
  skill: config.skill,
  startedAt: formatLocalTimestamp(new Date(startedAt)),
  resumedSave: false,
  resumedFrom: null,
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

function writeReport() {
  const lines = [
    "# Space Industry Balance Bot Report",
    "",
    `Run: ${runId}`,
    `Mode: ${config.mode}`,
    `Skill: ${config.skill}`,
    `Started: ${metrics.startedAt}`,
    `Result: ${metrics.result}`,
    metrics.resultReason ? `Reason: ${metrics.resultReason}` : "",
    "",
    "## Building Timings",
    "",
    "| Building | Materials ready | Completed | Total time | Attempts |",
    "|---|---:|---:|---:|---:|"
  ];
  for (const [name, item] of Object.entries(metrics.buildings)) {
    lines.push(
      `| ${name} | ${item.materialReadyAfterSeconds ?? "-"} s | ` +
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
    lines.push(
      `| ${name} | ${item.materialReadyAfterSeconds ?? "-"} s | ` +
      `${item.completedAtSeconds ?? "-"} s | ${item.durationSeconds ?? "-"} s | ${item.attempts} |`
    );
  }
  lines.push(
    "",
    "## Resource Milestones",
    "",
    "| Resource | Amount | Reached after | World time |",
    "|---|---:|---:|---:|"
  );
  for (const item of Object.values(metrics.resourceMilestones)) {
    lines.push(`| ${item.resource} | ${item.amount} | ${item.elapsedSeconds} s | ${item.worldPlayTime.toFixed(1)} s |`);
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

function updateStatus(state = null) {
  writeJson(statusPath, {
    runId,
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

function findLatestResumeSave() {
  if (!fs.existsSync(archiveRoot)) return null;
  const runs = fs.readdirSync(archiveRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== runId)
    .map(entry => {
      const directory = path.join(archiveRoot, entry.name);
      const candidateSave = path.join(directory, "save.json");
      const candidateStatus = path.join(directory, "status.json");
      if (!fs.existsSync(candidateSave) || !fs.existsSync(candidateStatus)) return null;
      try {
        const status = JSON.parse(fs.readFileSync(candidateStatus, "utf8"));
        const resumable = ["running", "stopping", "stopped", "error"].includes(status.result || status.status);
        return resumable ? { name: entry.name, save: candidateSave } : null;
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.name.localeCompare(a.name));
  return runs[0]?.save || null;
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
  browser = await chromium.launch({
    headless: !visibleWindow,
    executablePath: EDGE_PATH,
    args: [`--window-size=${config.viewport.width},${config.viewport.height}`]
  });
  const context = await browser.newContext({
    viewport: visibleWindow ? null : config.viewport
  });
  page = await context.newPage();
  page.on("dialog", dialog => dialog.dismiss().catch(() => {}));
  await page.goto(url);
  await page.waitForFunction(() => typeof resetGameToNew === "function" && typeof createSavePayload === "function");

  await page.evaluate(() => localStorage.clear());
  const resumePath = requestedResumeSave
    ? path.resolve(ROOT, requestedResumeSave)
    : findLatestResumeSave();
  if (resumePath) {
    const payload = JSON.parse(fs.readFileSync(resumePath, "utf8"));
    const loaded = await page.evaluate(save => loadSavePayload(save), payload);
    if (!loaded) throw new Error("The Balance Bot savegame could not be loaded.");
    metrics.resumedSave = true;
    metrics.resumedFrom = path.basename(path.dirname(resumePath));
    logEvent("save-loaded", { run: metrics.resumedFrom });
  } else {
    const seed = Math.floor(Math.random() * 0xffffffff) >>> 0;
    await page.evaluate(({ name, seedValue }) => {
      resetGameToNew(name, seedValue);
      resetTutorialForNewWorld();
    }, { name: "Balance Bot", seedValue: seed });
    logEvent("world-created", { seed });
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
      assembler: !!assemblerWindowModule,
      turret: !!turretControlWindowOpen,
      map: !!mapVisible,
      build: !!buildMode,
      smallShipEditor: !!activeSmallShipEdit
    }));

    if (state.tutorial) {
      await closeTutorial();
      continue;
    }
    const playerInterfaceOpen = state.build || state.smallShipEditor || state.uiDialog ||
      state.appState === "paused" || state.seedDialog || state.research ||
      state.assembler || state.turret || state.map;
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
    if (!lockedAsteroid || !asteroids.includes(lockedAsteroid) || lockedAsteroid.totalItems <= 0) {
      lockedAsteroid = asteroids
        .filter(asteroid => asteroid.totalItems > 0)
        .sort((a, b) =>
          Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y)
        )[0] || null;
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
        totalItems: lockedAsteroid.totalItems
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
    const liveModules = placedModules.map(module => ({
      id: module.id,
      type: module.type,
      x: module.x,
      y: module.y,
      w: module.w || 1,
      h: module.h || 1,
      rot: module.rot || 0,
      hp: getModuleHealth(module),
      assemblerTargets: module.assemblerTargets ? { ...module.assemblerTargets } : null
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
  return Math.max(30, (state.res.fuelCap || 100) * 0.3);
}

function getFuelRecoveryTarget(state) {
  if ((state.res.fuel || 0) >= getFuelThreshold(state)) return null;
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
    if ((state.res.water || 0) < 10) {
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
  if (hasDrill &&
      needsMaterials &&
      !goals.some(goal => goal.action === "Approach resource asteroid") &&
      !(state.commitPending || state.blueprints > 0)) {
    if (state.nearestAsteroid && state.nearestAsteroid.distance > 5 * 40) {
      goals.unshift({ action: "Approach resource asteroid", reason: "Reach the required materials" });
    } else if (!state.nearestAsteroid && !state.position.inBelt && state.nearestBelt) {
      goals.unshift({ action: "Fly to asteroid belt", reason: "Find the required materials" });
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
    metrics[kind][name] = {
      firstIntentAtSeconds: Number(elapsedSeconds().toFixed(1)),
      firstIntentWorldTime: state.worldPlayTime,
      completedAtSeconds: null,
      completedWorldTime: null,
      attempts: 0
    };
    logEvent("goal-started", { kind, name, resources: state.res });
  }
  const measurement = metrics[kind][name];
  if (materialsReady && measurement.materialReadyAtSeconds === undefined) {
    measurement.materialReadyAtSeconds = Number(elapsedSeconds().toFixed(1));
    measurement.materialReadyAfterSeconds = Number(
      (measurement.materialReadyAtSeconds - measurement.firstIntentAtSeconds).toFixed(1)
    );
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
        worldPlayTime: state.worldPlayTime
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
    resources: Object.fromEntries(importantResources.map(key => [key, Math.floor(state.res[key] || 0)])),
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
  await page.waitForFunction(targetType =>
    placedModules.some(module => module.type === targetType) || !commitPending
  , type, { timeout: 30000 }).catch(() => {});
  return true;
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
  await page.waitForFunction(() => researchWindowOpen === true);
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
          Math.hypot(waypoint.x - ship.x, waypoint.y - ship.y) <= CONFIG.GRID_SIZE * 3) {
        waypoint = null;
        window.__balanceBotFlightWaypoint = null;
      }

      if (!waypoint && kind !== "blackhole") {
        const obstacles = [
          ...worldStars.map(body => ({ x: body.x, y: body.y, radius: body.radius, type: "star" })),
          ...planets.map(body => ({ x: body.x, y: body.y, radius: body.radius, type: "planet" })),
          ...asteroids
            .filter(body => body !== target && body.totalItems > 0)
            .map(body => ({ x: body.x, y: body.y, radius: body.size, type: "asteroid" }))
        ];
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
          const perpendicularX = -finalDy / pathLength;
          const perpendicularY = finalDx / pathLength;
          const candidates = [-1, 1].map(side => ({
            x: blocking.x + perpendicularX * blocking.clearance * side,
            y: blocking.y + perpendicularY * blocking.clearance * side,
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
      let desiredVelocity;
      let speedTolerance = 0.15;
      let flightPhase = null;
      if (kind === "asteroid") {
        const grid = CONFIG.GRID_SIZE;
        const travelGap = waypoint ? distance : gap;
        const massFactor = getMassAccelerationFactor(placedModules);
        const reverseThrust = placedModules.reduce((best, module) => {
          const stats = BUILDING_STATS[module.type];
          if (!stats?.thrust) return best;
          const localDirection = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
          const isReverse = Math.abs(normalizeAngle(localDirection - Math.PI / 2)) < 0.5;
          return isReverse ? Math.max(best, stats.thrust * 0.12 * massFactor) : best;
        }, 0);
        const brakingDistance = Math.max(0, closingSpeed) ** 2 * 30 / Math.max(0.02, reverseThrust);
        const reactionDistance = Math.max(0, closingSpeed) * 60 * 2.2;
        const brakingMargin = Math.max(
          waypoint ? grid * 8 : grid * 12,
          reactionDistance
        );
        const stateKey = `${waypointKey}:${waypoint ? "waypoint" : "target"}`;
        let flightState = window.__balanceBotFlightState;
        if (flightState?.key !== stateKey) {
          flightState = { key: stateKey, phase: "accelerate" };
          window.__balanceBotFlightState = flightState;
        }
        if (flightState.phase === "accelerate" &&
            travelGap <= brakingDistance + brakingMargin) {
          flightState.phase = "brake";
        }
        if (flightState.phase === "brake" && relativeSpeed <= 0.18) {
          flightState.phase = "final";
        }
        flightPhase = flightState.phase;
        const approachSpeed = flightPhase === "accelerate"
          ? Math.max(relativeSpeed + 4, 8)
          : flightPhase === "brake"
            ? 0
            : travelGap > grid * 2
              ? 0.18
              : 0.07;
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
      const needsMiningAlignment = miningActive || (
        kind === "asteroid" &&
        gap <= CONFIG.GRID_SIZE * 3 &&
        relativeSpeed <= 0.35
      );
      let selectedThruster;
      if (kind === "asteroid") {
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
          key: flightPhase === "brake" && reverseThruster ? "s" : "w"
        };
      } else if (needsMiningAlignment) {
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
        shouldThrust: kind === "asteroid" && flightPhase === "accelerate"
          ? true
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
        miningActive,
        alignOnly: miningActive,
        close: kind === "asteroid"
          ? miningActive && relativeSpeed <= 0.25
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
    const rotationTolerance = targetKind === "asteroid" ? 0.045 : 0.1;
    if (Math.abs(command.angleError) > rotationTolerance) {
      const key = command.angleError < 0 ? "a" : "d";
      const turnMs = targetKind === "asteroid"
        ? Math.min(120, 35 + Math.abs(command.angleError) * 45)
        : Math.min(260, 70 + Math.abs(command.angleError) * 90);
      await pressBotFlightKey(key, turnMs);
    } else if (!command.alignOnly && command.shouldThrust) {
      const thrustMs = targetKind === "asteroid"
        ? command.flightPhase === "accelerate" ? 1400 :
          command.flightPhase === "brake" ? 900 :
          120
        : command.gap > 40 * 30 ? 650 : 300;
      await pressBotFlightKey(command.thrustKey || "w", thrustMs);
    }
    await delay(targetKind === "asteroid"
      ? command.flightPhase === "accelerate" ? 80 :
        command.shouldThrust ? 140 :
        300
      : 80);
  }
  logEvent("target-approach-timeout", {
    targetKind,
    maximumMs,
    gap: lastCommand?.gap ?? null,
    relativeSpeed: lastCommand?.relativeSpeed ?? null,
    closingSpeed: lastCommand?.closingSpeed ?? null
  });
  return true;
}

async function approachAsteroid(state) {
  if (!state.nearestAsteroid || state.res.fuel <= 2) return false;
  lastDecision = "Approaching a resource asteroid";
  logEvent("decision", {
    decision: "approach-asteroid",
    distance: state.nearestAsteroid.distance,
    contents: state.nearestAsteroid.contents
  });
  await steerTowardTarget("asteroid", Math.max(45000, 75000 - config.skill * 200));
  countAction("approach-asteroid");
  return true;
}

async function approachResourceBelt(state) {
  if (!state.nearestBelt || state.res.fuel <= 12) return false;
  lastDecision = "Flying to the nearest asteroid belt";
  logEvent("decision", {
    decision: "approach-resource-belt",
    distance: state.nearestBelt.distance,
    beltKind: state.nearestBelt.kind,
    ship: { x: state.ship.x, y: state.ship.y },
    target: { x: state.nearestBelt.x, y: state.nearestBelt.y }
  });
  await steerTowardTarget("belt", Math.max(7000, 16000 - config.skill * 55));
  countAction("approach-resource-belt");
  return true;
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
  const desired = {
    gears: 30,
    cables: 40,
    circuits: 40,
    ammo: moduleCount(state, "Gun Turret") > 0 ? 100 : 20,
    cannonBalls: moduleCount(state, "Cannon Turret") > 0 ? 80 : 0,
    railgunRods: moduleCount(state, "Railgun Turret") > 0 ? 30 : 0,
    rocketAmmunition: moduleCount(state, "Missile Turret") > 0 ? 30 : 0
  };
  const target = Object.entries(desired).find(([key, value]) =>
    value > 0 && (assembler.assemblerTargets?.[key] || 0) !== value
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
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  lastDecision = `Setting ${key} production target to ${value}`;
  logEvent("decision", { decision: "assembler-target", resource: key, target: value });
  countAction("assembler-target");
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

  lastDecision = `Producing fuel until the reserve reaches ${Math.ceil(getFuelThreshold(state))}`;
  return { active: true, acted: false, wait: true };
}

function chooseResearch(state) {
  const priorities = [
    "Drill", "Smelter", "Tank MK1", "Electrolyser", "Assembler", "Fuel Processor",
    "Main Thruster", "Battery MK1", "Computer MK2", "Reactor", "Turbine",
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
  if (counts("Electrolyser") === 0 && state.res.fuel < 60 && affordable("Electrolyser")) return "Electrolyser";
  if (counts("Fuel Processor") === 0 && state.res.fuel < 60 && affordable("Fuel Processor")) return "Fuel Processor";
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

  const fuelRecovery = await handleFuelRecovery(state);
  if (fuelRecovery.acted || fuelRecovery.wait) return fuelRecovery.acted;

  if (!fuelRecovery.active && await setAssemblerTargets(state)) return true;

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

  const research = fuelRecovery.active ? null : chooseResearch(state);
  if (research) {
    const item = state.availableResearch.find(candidate => candidate.name === research);
    const canUseLaboratory = moduleCount(state, "Laboratory") > 0;
    markIntent("research", research, state, !!item?.affordable && canUseLaboratory);
    if (item?.affordable && await researchTechnology(state, research)) return true;
    lastDecision = `Collecting materials for research: ${research}`;
  }

  const building = fuelRecovery.active ? null : chooseBuildingGoal(state);
  if (building) {
    const affordable = hasResources(state, state.buildCosts[building]);
    markIntent("buildings", building, state, affordable);
    if (affordable && await buildBuilding(state, building)) return true;
    lastDecision = `Collecting materials for building: ${building}`;
  }

  const hasOperationalDrill = moduleCount(state, "Drill") > 0;
  const minimumFlightFuel = fuelRecovery.active ? 8 : getFuelThreshold(state);
  if (hasOperationalDrill &&
      state.nearestAsteroid &&
      !state.asteroidMining &&
      state.res.fuel > minimumFlightFuel) {
    return approachAsteroid(state);
  }
  if (hasOperationalDrill && !state.nearestAsteroid && !state.position.inBelt && state.nearestBelt) {
    return approachResourceBelt(state);
  }

  if (!fuelRecovery.active) lastDecision = "Observing resource production";
  return false;
}

async function saveGame(reason = "interval") {
  if (!page || page.isClosed()) return;
  const payload = await page.evaluate(() => createSavePayload(currentSaveName || "Balance Bot"));
  writeJson(savePath, payload);
  lastSaveAt = Date.now();
  saveCount++;
  logEvent("save-written", { reason, worldPlayTime: payload.worldPlayTime });
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

async function cleanup() {
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
  writeReport();
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
}

async function main() {
  writeJson(metricsPath, metrics);
  writeReport();
  logEvent("run-started", {
    runId,
    config,
    resumedSave: metrics.resumedSave
  });
  const url = await startServer(getFreePort());
  await initializeGame(url);

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
    writeReport();

    if (checkTerminalState(state)) break;
    if (Date.now() - lastSaveAt >= config.saveIntervalMs) await saveGame();

    await decide(state);
    loopCount++;
    if (smokeTest && loopCount >= 2) {
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
    stopping = true;
    stopReason = "error";
    metrics.result = "error";
    metrics.resultReason = error?.message || String(error);
    metrics.error = error?.stack || String(error);
    writeJson(metricsPath, metrics);
    updateStatus();
    console.error(error);
    process.exitCode = 1;
  })
  .finally(cleanup);
