const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const BOT_DIR = __dirname;
const REPORT_PATH = path.join(BOT_DIR, "performance-report-latest.md");
const DATA_PATH = path.join(BOT_DIR, "performance-data-latest.json");
const ERROR_LOG_PATH = path.join(BOT_DIR, "performance-bot-error-latest.log");
const REAL_SAVE_PATH = path.join(BOT_DIR, "performance-test-save.json");
const SERVER_URL = "http://127.0.0.1:8765/index.html";
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const NODE_PATH = process.execPath;
const PERFORMANCE_WORLD_SEED = 4101;
const SCENARIO_RUNS = 3;
const SCENARIO_DURATION_MS = 2200;
const managedServers = new Set();
const PROFILE_FUNCTIONS = [
  "drawGalaxyBackground",
  "drawParallaxStarfield",
  "drawDysonSpheres",
  "drawModules",
  "drawTurretRangeAt",
  "drawTurretModuleSprite",
  "drawImageSprite",
  "drawEnemyShips",
  "drawSmallShips",
  "drawCombatBullets",
  "drawUI",
  "drawResourceUI",
  "drawMotherShipResourceUI",
  "drawMapOverlay",
  "drawTooltip",
  "drawPlanetResourceTooltip",
  "updateSpaceHazards",
  "updateResources",
  "updateTurretGuns",
  "updatePlayerTurrets",
  "updateEnemyShips",
  "updateSmallShips",
  "updateGameSounds",
  "updateDynamicBeltAsteroids"
];
const PROFILE_METHODS = [
  ["GalaxyStar", "draw"],
  ["GalaxyStar", "update"],
  ["GalaxyPlanet", "draw"],
  ["GalaxyPlanet", "update"],
  ["AsteroidBelt", "draw"],
  ["AsteroidBelt", "update"],
  ["Asteroid", "draw"],
  ["Asteroid", "update"],
  ["Ship", "update"]
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isServerReady() {
  try {
    const response = await fetch(SERVER_URL);
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function ensureServer() {
  if (await isServerReady()) return null;
  const child = spawn(NODE_PATH, [path.join(ROOT, "js", "local-server.js"), "8765"], {
    cwd: ROOT,
    detached: false,
    stdio: "ignore",
    windowsHide: true
  });
  for (let i = 0; i < 30; i++) {
    await delay(100);
    if (await isServerReady()) {
      managedServers.add(child);
      child.once("exit", () => managedServers.delete(child));
      return child;
    }
  }
  child.kill();
  throw new Error("The local game server could not be started.");
}

async function prepareWorld(page, seed) {
  await ensureServer();
  await page.goto(SERVER_URL);
  await page.waitForFunction(() => typeof resetGameToNew === "function");
  await page.evaluate(worldSeed => {
    resetGameToNew("Performance Bot", worldSeed);
    appState = "playing";
    tutorialActive = false;
    tutorialOverlay = null;
    uiDialog = null;
    nextEnemySpawnAt = performance.now() + 3600000;
  }, seed);
}

async function prepareSavedWorld(page, exportedSave) {
  await ensureServer();
  await page.goto(SERVER_URL);
  await page.waitForFunction(() => typeof loadSavePayload === "function");
  await page.evaluate(container => {
    const payload = decryptSaveExport(container);
    if (!payload || typeof payload !== "object" || !payload.ship || !Array.isArray(payload.placedModules)) {
      throw new Error("performance-test-save.json is not a valid exported savegame.");
    }
    loadSavePayload(payload);
    appState = "playing";
    tutorialActive = false;
    tutorialOverlay = null;
    uiDialog = null;
    nextEnemySpawnAt = performance.now() + 3600000;
  }, exportedSave);
}

async function installProfiler(page) {
  await page.evaluate(({ names, methods }) => {
    window.__performanceBot = {
      functions: {},
      frames: [],
      loopTimes: [],
      longTasks: [],
      canvas: {},
      running: true
    };

    function record(name, elapsed) {
      const sample = window.__performanceBot.functions[name] ||
        (window.__performanceBot.functions[name] = { calls: 0, total: 0, max: 0 });
      sample.calls++;
      sample.total += elapsed;
      sample.max = Math.max(sample.max, elapsed);
    }

    for (const name of names) {
      try {
        eval(`${name}=((original)=>function(...args){
          const started=performance.now();
          try{return original.apply(this,args);}
          finally{record("${name}",performance.now()-started);}
        })(${name})`);
      } catch (error) {
        // A missing optional function should not stop the complete test.
      }
    }

    for (const [className, methodName] of methods) {
      try {
        const prototype = eval(`${className}.prototype`);
        const original = prototype[methodName];
        prototype[methodName] = function(...args) {
          const started = performance.now();
          try {
            return original.apply(this, args);
          } finally {
            record(`${className}.${methodName}`, performance.now() - started);
          }
        };
      } catch (error) {
        // Optional world classes can differ between game versions.
      }
    }

    try {
      const originalLoop = loop;
      loop = function(...args) {
        const started = performance.now();
        try {
          return originalLoop.apply(this, args);
        } finally {
          window.__performanceBot.loopTimes.push(performance.now() - started);
        }
      };
    } catch (error) {
      // Frame intervals still provide a fallback if the loop cannot be wrapped.
    }

    for (const methodName of ["drawImage", "fillText", "fillRect", "strokeRect", "arc", "ellipse"]) {
      const original = CanvasRenderingContext2D.prototype[methodName];
      if (typeof original !== "function") continue;
      CanvasRenderingContext2D.prototype[methodName] = function(...args) {
        const started = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          const elapsed = performance.now() - started;
          const sample = window.__performanceBot.canvas[methodName] ||
            (window.__performanceBot.canvas[methodName] = { calls: 0, total: 0, max: 0 });
          sample.calls++;
          sample.total += elapsed;
          sample.max = Math.max(sample.max, elapsed);
        }
      };
    }

    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            window.__performanceBot.longTasks.push(entry.duration);
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch (error) {
        // Long-task entries are not available in every browser build.
      }
    }

    let previous = performance.now();
    function measureFrame(now) {
      if (!window.__performanceBot.running) return;
      window.__performanceBot.frames.push(now - previous);
      previous = now;
      requestAnimationFrame(measureFrame);
    }
    requestAnimationFrame(measureFrame);
  }, { names: PROFILE_FUNCTIONS, methods: PROFILE_METHODS });
}

async function configureScenario(page, scenario) {
  await page.evaluate(config => {
    if (config.notifications) {
      for (let i = 0; i < config.notifications; i++) flash(`Bot message ${i + 1}`);
    }

    if (config.enemies) {
      for (let remaining = config.enemies; remaining > 0; remaining -= 50) {
        spawnEnemyShipsByType(1, Math.min(50, remaining));
      }
    }

    if (config.nearbyEnemies) {
      for (let remaining = config.nearbyEnemies; remaining > 0; remaining -= 50) {
        spawnEnemyShipsByType(1, Math.min(50, remaining));
      }
      enemyShips.slice(-config.nearbyEnemies).forEach((enemy, index) => {
        const angle = index / Math.max(1, config.nearbyEnemies) * Math.PI * 2;
        const distance = CONFIG.GRID_SIZE * (8 + index % 3);
        enemy.x = ship.x + Math.cos(angle) * distance;
        enemy.y = ship.y + Math.sin(angle) * distance;
        enemy.vx = 0;
        enemy.vy = 0;
      });
    }

    if (config.drones) {
      for (let i = 0; i < config.drones; i++) {
        smallShips.push({
          id: nextSmallShipId++,
          hangarId: -1000 - i,
          hangarType: "Small Hangar",
          name: `Bot Drone ${i + 1}`,
          capacityTiles: 2,
          modules: [
            { id: nextModuleId++, x: 0, y: 0, type: "Computer", w: 1, h: 1, rot: 0, hp: 1 },
            { id: nextModuleId++, x: 1, y: 0, type: "Solar Panel", w: 1, h: 1, rot: 0, hp: 1 }
          ],
          modeMining: false,
          modeBattle: false,
          modeGas: false,
          modeSolarWind: false,
          status: "orphaned",
          builtAt: 0,
          x: ship.x + 200000 + (i % 20) * 10000,
          y: ship.y + 200000 + Math.floor(i / 20) * 10000,
          vx: 0,
          vy: 0,
          angle: 0,
          cargo: {},
          cargoLimits: {},
          liquids: {},
          liquidLimits: {},
          fuel: 100,
          energy: 100,
          mineTimer: 0
        });
      }
    }

    if (config.asteroids) {
      asteroids.length = 0;
      const keepRadius = getShipCollisionRadius() + CONFIG.GRID_SIZE * 65;
      for (let i = 0; i < config.asteroids; i++) {
        const angle = (i / config.asteroids) * Math.PI * 2 + (i % 7) * 0.013;
        const distance = CONFIG.GRID_SIZE * 8 +
          (i % 45) / 45 * Math.max(CONFIG.GRID_SIZE * 4, keepRadius - CONFIG.GRID_SIZE * 12);
        const asteroid = new Asteroid(
          ship.x + Math.cos(angle) * distance,
          ship.y + Math.sin(angle) * distance,
          i % 10 === 0 ? "ice" : "rock"
        );
        asteroid._performanceBot = true;
        asteroids.push(asteroid);
      }
    }

    if (config.turrets) {
      const maxX = placedModules.reduce((value, module) => Math.max(value, module.x + (module.w || 1)), 0);
      for (let i = 0; i < config.turrets; i++) {
        placedModules.push({
          id: nextModuleId++,
          x: maxX + (i % 3) * 2,
          y: Math.floor(i / 3) * 2,
          type: "Gun Turret",
          w: 2,
          h: 2,
          rot: i % 4,
          hp: 1
        });
      }
      res.energy = Math.max(res.energy || 0, 100000);
      res.ammo = Math.max(res.ammo || 0, 100000);
    }

    if (config.extraModules) {
      const anchor = placedModules.reduce((best, module) =>
        !best || module.x + (module.w || 1) > best.x + (best.w || 1) ? module : best
      , null);
      const startX = anchor.x + (anchor.w || 1);
      const startY = anchor.y;
      for (let i = 0; i < config.extraModules; i++) {
        placedModules.push({
          id: nextModuleId++,
          x: startX + i,
          y: startY,
          type: "Warehouse MK1",
          w: 1,
          h: 1,
          rot: 0,
          hp: 1
        });
      }
    }

    if (config.endWorld) {
      setEndWorldSeed();
      resetGeneratedWorld();
    }
    if (config.landing) {
      const target = config.endWorld
        ? planets.find(planet => planet instanceof EndTwinPlanet)
        : planets[0];
      if (target) {
        const radius = getDesiredOrbitRadius(target);
        ship.x = target.x + radius;
        ship.y = target.y;
        ship.vx = 0;
        ship.vy = MAX_SHIP_SPEED * 0.7;
        camera.x = ship.x;
        camera.y = ship.y;
        landingTarget = target;
        landingModeActive = true;
        landingPhase = "none";
      }
    }
    if (Number.isFinite(config.zoom)) camera.scale = config.zoom;
    if (config.buildMode) {
      buildMode = true;
      buildCamera.x = ship.x;
      buildCamera.y = ship.y;
    }
    if (config.disableUi) {
      drawUI = () => {};
      drawResourceUI = () => {};
      drawDysonBuildButton = () => {};
      drawDysonPanel = () => {};
      drawOrbitIndicator = () => {};
      drawTooltip = () => {};
      drawPlanetResourceTooltip = () => {};
    }

    keys.w = true;
  }, scenario);
}

async function collectScenarioRun(page, scenario) {
  if (scenario.exportedSave) {
    await prepareSavedWorld(page, scenario.exportedSave);
  } else {
    await prepareWorld(page, PERFORMANCE_WORLD_SEED);
  }
  await installProfiler(page);
  await configureScenario(page, scenario);
  await page.waitForTimeout(SCENARIO_DURATION_MS);
  await page.evaluate(() => {
    keys.w = false;
    window.__performanceBot.running = false;
  });

  return page.evaluate(name => {
    const rawFrames = window.__performanceBot.frames.slice();
    const frameWarmup = rawFrames.length > 60 ? 30 : Math.floor(rawFrames.length / 4);
    const frames = rawFrames.slice(frameWarmup).sort((a, b) => a - b);
    const averageFrameMs = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    const percentile = ratio => frames[Math.min(frames.length - 1, Math.floor(frames.length * ratio))] || 0;
    const makeSamples = source => Object.entries(source)
      .map(([functionName, value]) => ({
        name: functionName,
        calls: value.calls,
        totalMs: value.total,
        averageMs: value.total / Math.max(1, value.calls),
        maxMs: value.max
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
    const functions = makeSamples(window.__performanceBot.functions);
    const canvas = makeSamples(window.__performanceBot.canvas);
    const rawLoopTimes = window.__performanceBot.loopTimes.slice();
    const loopWarmup = rawLoopTimes.length > 20 ? 10 : Math.floor(rawLoopTimes.length / 4);
    const loopTimes = rawLoopTimes.slice(loopWarmup).sort((a, b) => a - b);
    const longTasks = window.__performanceBot.longTasks.slice().sort((a, b) => a - b);
    const canvasCalls = canvas.reduce((sum, item) => sum + item.calls, 0);
    const visibleModules = placedModules.filter(module => {
      const world = moduleWorldCenter(module);
      const point = worldToScreen(world.x, world.y);
      return point.x >= 0 && point.x <= VIEW.w && point.y >= 0 && point.y <= VIEW.h;
    }).length;

    return {
      name,
      rawFrameSamples: rawFrames.length,
      averageFrameMs,
      fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
      p95FrameMs: percentile(0.95),
      maxFrameMs: frames[frames.length - 1] || 0,
      frameSamples: frames.length,
      canvasCallsPerFrame: canvasCalls / Math.max(1, frames.length),
      functions,
      canvas,
      loop: {
        averageMs: loopTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, loopTimes.length),
        p95Ms: loopTimes[Math.min(loopTimes.length - 1, Math.floor(loopTimes.length * 0.95))] || 0,
        maxMs: loopTimes[loopTimes.length - 1] || 0
      },
      longTasks: {
        count: longTasks.length,
        totalMs: longTasks.reduce((sum, value) => sum + value, 0),
        maxMs: longTasks[longTasks.length - 1] || 0
      },
      counts: {
        modules: placedModules.length,
        visibleModules,
        turrets: placedModules.filter(module => isTurretType(module.type)).length,
        planets: planets.length,
        asteroids: asteroids.length,
        enemies: enemyShips.length,
        drones: smallShips.length,
        messages: flashMessages.length,
        systems: solarSystems.length,
        cameraScale: camera.scale,
        activeSystems: solarSystems.filter(system =>
          isSystemNearActiveFocus(system, [{ x: ship.x, y: ship.y }])
        ).length
      }
    };
  }, scenario.name);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregateSamples(runs, property) {
  const names = new Set(runs.flatMap(run => run[property].map(item => item.name)));
  return [...names].map(name => {
    const samples = runs.map(run => run[property].find(item => item.name === name)).filter(Boolean);
    return {
      name,
      calls: Math.round(median(samples.map(item => item.calls))),
      totalMs: median(samples.map(item => item.totalMs)),
      averageMs: median(samples.map(item => item.averageMs)),
      maxMs: median(samples.map(item => item.maxMs))
    };
  }).sort((a, b) => b.totalMs - a.totalMs);
}

function aggregateScenarioRuns(scenario, runs) {
  const countKeys = Object.keys(runs[0].counts);
  return {
    name: scenario.name,
    runCount: runs.length,
    averageFrameMs: median(runs.map(run => run.averageFrameMs)),
    fps: median(runs.map(run => run.fps)),
    p95FrameMs: median(runs.map(run => run.p95FrameMs)),
    maxFrameMs: median(runs.map(run => run.maxFrameMs)),
    frameSamples: Math.round(median(runs.map(run => run.frameSamples))),
    rawFrameSamples: Math.round(median(runs.map(run => run.rawFrameSamples))),
    canvasCallsPerFrame: median(runs.map(run => run.canvasCallsPerFrame)),
    functions: aggregateSamples(runs, "functions"),
    canvas: aggregateSamples(runs, "canvas"),
    loop: {
      averageMs: median(runs.map(run => run.loop.averageMs)),
      p95Ms: median(runs.map(run => run.loop.p95Ms)),
      maxMs: median(runs.map(run => run.loop.maxMs))
    },
    longTasks: {
      count: Math.round(median(runs.map(run => run.longTasks.count))),
      totalMs: median(runs.map(run => run.longTasks.totalMs)),
      maxMs: median(runs.map(run => run.longTasks.maxMs))
    },
    counts: Object.fromEntries(countKeys.map(key => {
      const value = median(runs.map(run => run.counts[key]));
      return [key, key === "cameraScale" ? value : Math.round(value)];
    })),
    measurements: runs
  };
}

async function collectScenario(page, scenario) {
  const runs = [];
  const runCount = scenario.runs || SCENARIO_RUNS;
  for (let run = 1; run <= runCount; run++) {
    console.log(`  Run ${run}/${runCount}`);
    runs.push(await collectScenarioRun(page, scenario));
  }
  return aggregateScenarioRuns(scenario, runs);
}

async function testSavePreviewHover(page) {
  await prepareWorld(page, 987654);
  await page.evaluate(() => {
    localStorage.clear();
    resetGameToNew("Preview Bot Test", 987654);
    appState = "playing";
    saveInitialWorldToSlot(1);
  });
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  return page.evaluate(async () => {
    const save = readSaveSlot(1);
    const previewStored = typeof save?.preview === "string" && save.preview.startsWith("data:image/");
    appState = "menu";
    selectedMenuSaveSlot = null;
    uiDialog = null;
    rebuildSaveSlotRects();
    const rect = saveSlotRects.find(candidate => candidate.slot === 1);
    mouse.x = rect.x + rect.w / 2;
    mouse.y = rect.y + rect.h / 2;
    const hoveredSlot = getSaveSlotAt(mouse.x, mouse.y)?.slot || null;
    const image = previewStored ? getSavePreviewImage(save) : null;

    if (image && !image.complete && typeof image.decode === "function") {
      try {
        await image.decode();
      } catch (error) {
        // The loading state is reported in the result.
      }
    }

    let previewDrawn = false;
    const originalDrawImage = ctx.drawImage;
    ctx.drawImage = function(source, ...args) {
      if (source === image) previewDrawn = true;
      return originalDrawImage.call(this, source, ...args);
    };
    try {
      drawMainMenu();
    } finally {
      ctx.drawImage = originalDrawImage;
      deleteSaveSlot(1);
    }

    return {
      name: "Save preview hover",
      passed: previewStored && hoveredSlot === 1 && image?.naturalWidth > 0 && previewDrawn,
      previewStored,
      hoveredSlot,
      imageLoaded: (image?.naturalWidth || 0) > 0,
      previewDrawn
    };
  });
}

async function testMovingTargetTurretAccuracy(page) {
  await prepareWorld(page, 246810);
  const setup = await page.evaluate(() => {
    const anchor = placedModules.reduce((best, module) =>
      !best || module.x + (module.w || 1) > best.x + (best.w || 1) ? module : best
    , null);
    const turret = {
      id: nextModuleId++,
      x: anchor.x + (anchor.w || 1),
      y: anchor.y,
      type: "Gun Turret",
      w: 2,
      h: 2,
      rot: 0,
      hp: 1
    };
    placedModules.push(turret);
    res.energy = 100000;
    res.ammo = 100000;

    const enemy = createEnemyShip(1, ship.x + CONFIG.GRID_SIZE * 20, ship.y + CONFIG.GRID_SIZE * 4, -999);
    enemy.vx = -45;
    enemy.vy = 35;
    enemy.resources.fuel = 0;
    enemy.role = "patrol";
    window.__turretAccuracyEnemyId = enemy.id;
    window.__turretAccuracyInitialHealth = enemy.modules.reduce((sum, module) => sum + getModuleHealth(module), 0);
    return { enemyId: enemy.id, initialHealth: window.__turretAccuracyInitialHealth };
  });

  await page.waitForTimeout(6500);
  return page.evaluate(({ enemyId, initialHealth }) => {
    const enemy = getEnemyById(enemyId);
    const finalHealth = enemy
      ? enemy.modules.reduce((sum, module) => sum + getModuleHealth(module), 0)
      : 0;
    return {
      name: "Moving-target turret accuracy",
      passed: finalHealth < initialHealth,
      details: `enemy health ${initialHealth.toFixed(2)} -> ${finalHealth.toFixed(2)}`
    };
  }, setup);
}

async function testEndTwinPlanetResources(page) {
  await prepareWorld(page, 135790);
  return page.evaluate(() => {
    setEndWorldSeed();
    resetGeneratedWorld();
    const planet = planets.find(candidate => candidate instanceof EndTwinPlanet);
    placedModules.push(
      { id: nextModuleId++, x: 20, y: 0, type: "Drill", w: 1, h: 2, rot: 0, hp: 1 },
      { id: nextModuleId++, x: 21, y: 0, type: "Warehouse MK2", w: 2, h: 2, rot: 0, hp: 1 },
      { id: nextModuleId++, x: 23, y: 0, type: "Tank MK2", w: 2, h: 2, rot: 0, hp: 1, tankContent: "helium3", tankCap: 600 }
    );
    shipLanded = true;
    landedPlanet = planet;
    landingTarget = planet;
    landingModeActive = true;
    landingPhase = "landed";
    planetMiningTimer = 1.1;
    resourceRateTimer = 0;
    updateResources(1.1);

    mapVisible = true;
    mapFocusSystem = null;
    const map = getCachedMapLayout();
    const point = worldToMap(map, planet.x, planet.y);
    const hit = getMapBodyAt(point.x, point.y);
    const rates = getPlanetMiningRates(planet);
    const iconLoaded = !!getImageSprite("Helium3");
    const mined = (res.helium3 || 0) > 0 && (res.uranium || 0) > 0 && (res.nickel || 0) > 0;
    const rateVisible = (resourceRates.uranium || 0) > 0 && (resourceRates.nickel || 0) > 0;

    return {
      name: "End-world central planet resources",
      passed: !!planet && hit?.planet === planet && iconLoaded && mined && rateVisible,
      details: `mapHover=${hit?.planet === planet}, icon=${iconLoaded}, helium3=${(res.helium3 || 0).toFixed(2)}, uraniumRate=${(resourceRates.uranium || 0).toFixed(2)}/s, resources=${Object.keys(rates).join(",")}`
    };
  });
}

async function testFlightStatePersistence(page) {
  await prepareWorld(page, 97531);
  return page.evaluate(() => {
    const orbitBody = planets[0];
    orbitTarget = orbitBody;
    orbitModeActive = true;
    orbitPhase = "free";
    orbitDesiredRadius = getDesiredOrbitRadius(orbitBody);
    _orbitAngle = 1.234;
    orbitLockedSpeed = 6.75;
    ship.x = orbitBody.x + Math.cos(_orbitAngle) * orbitDesiredRadius;
    ship.y = orbitBody.y + Math.sin(_orbitAngle) * orbitDesiredRadius;
    const orbitPayload = createSavePayload("Orbit persistence");
    const orbitLoaded = loadSavePayload(orbitPayload);
    const orbitRestored = orbitLoaded &&
      orbitModeActive &&
      orbitPhase === "free" &&
      orbitTarget === planets[0] &&
      Math.abs(_orbitAngle - 1.234) < 0.001 &&
      Math.abs(orbitLockedSpeed - 6.75) < 0.001;

    const landedBody = planets[1];
    orbitModeActive = false;
    orbitTarget = null;
    landingTarget = landedBody;
    landedPlanet = landedBody;
    landingModeActive = true;
    shipLanded = true;
    gravityOverride = true;
    landingPhase = "landed";
    ship.x = landedBody.x;
    ship.y = landedBody.y;
    const landingPayload = createSavePayload("Landing persistence");
    const landingLoaded = loadSavePayload(landingPayload);
    const landingRestored = landingLoaded &&
      landingModeActive &&
      shipLanded &&
      landingPhase === "landed" &&
      landedPlanet === planets[1] &&
      landingTarget === planets[1] &&
      ship.x === planets[1].x &&
      ship.y === planets[1].y;

    return {
      name: "Orbit and landing save persistence",
      passed: orbitRestored && landingRestored,
      details: `orbit=${orbitRestored}, landed=${landingRestored}`
    };
  });
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function createReport(results, generatedAt, checks, realSaveUsed) {
  const lines = [
    "# Space Industry Performance Report",
    "",
    `Generated: ${generatedAt}`,
    "This file always contains only the latest test run.",
    "",
    "## Bot Checks",
    "",
    "| Check | Result | Details |",
    "|---|---|---|"
  ];

  for (const check of checks) {
    const details = check.name === "Save preview hover"
      ? `stored=${check.previewStored}, hoveredSlot=${check.hoveredSlot}, loaded=${check.imageLoaded}, drawn=${check.previewDrawn}`
      : check.details;
    lines.push(`| ${check.name} | ${check.status || (check.passed ? "PASS" : "FAIL")} | ${details} |`);
  }

  lines.push(
    "",
    "## Scenario Summary",
    "",
    realSaveUsed
      ? `Every scenario reloads performance-test-save.json. Standard values are medians from ${SCENARIO_RUNS} runs; zoom sweep entries use one run.`
      : `Each synthetic scenario uses world seed ${PERFORMANCE_WORLD_SEED}. Standard values are medians from ${SCENARIO_RUNS} runs; zoom sweep entries use one run.`,
    "Complete game-loop timings are the primary comparison. Headless-browser FPS can vary because of frame scheduling.",
    "",
    "| Scenario | Zoom | Turrets | Visible modules | Canvas calls/frame | FPS | Loop average | Loop P95 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const result of results) {
    lines.push(
      `| ${result.name} | ${formatNumber(result.counts.cameraScale, 2)} | ${result.counts.turrets} | ` +
      `${result.counts.visibleModules}/${result.counts.modules} | ${formatNumber(result.canvasCallsPerFrame, 0)} | ` +
      `${formatNumber(result.fps, 1)} | ${formatNumber(result.loop.averageMs)} ms | ` +
      `${formatNumber(result.loop.p95Ms)} ms |`
    );
  }

  for (const result of results) {
    lines.push("", `## ${result.name}`, "");
    lines.push(
      `Objects: ${result.counts.modules} modules, ${result.counts.planets} planets, ` +
      `${result.counts.asteroids} asteroids, ${result.counts.enemies} enemies, ` +
      `${result.counts.drones} drones, ${result.counts.activeSystems}/${result.counts.systems} active systems.`
    );
    lines.push(
      `View: zoom ${formatNumber(result.counts.cameraScale, 2)}, ` +
      `${result.counts.visibleModules}/${result.counts.modules} modules visible, ` +
      `${result.counts.turrets} turrets, ${formatNumber(result.canvasCallsPerFrame, 0)} canvas calls per frame.`
    );
    lines.push(
      `Complete game loop: ${formatNumber(result.loop.averageMs, 3)} ms average, ` +
      `${formatNumber(result.loop.p95Ms)} ms P95, ${formatNumber(result.loop.maxMs)} ms maximum.`
    );
    lines.push(`Measured frames: ${result.frameSamples} after warmup, ${result.rawFrameSamples} total.`);
    lines.push(
      `Browser long tasks: ${result.longTasks.count}, total ${formatNumber(result.longTasks.totalMs)} ms, ` +
      `maximum ${formatNumber(result.longTasks.maxMs)} ms.`
    );
    lines.push("", "| Function | Total | Average call | Maximum call | Calls |", "|---|---:|---:|---:|---:|");
    for (const item of result.functions.slice(0, 12)) {
      lines.push(
        `| ${item.name} | ${formatNumber(item.totalMs)} ms | ${formatNumber(item.averageMs, 3)} ms | ` +
        `${formatNumber(item.maxMs)} ms | ${item.calls} |`
      );
    }
    lines.push("", "| Canvas operation | Total | Average call | Maximum call | Calls |", "|---|---:|---:|---:|---:|");
    for (const item of result.canvas.slice(0, 8)) {
      lines.push(
        `| ${item.name} | ${formatNumber(item.totalMs)} ms | ${formatNumber(item.averageMs, 4)} ms | ` +
        `${formatNumber(item.maxMs)} ms | ${item.calls} |`
      );
    }
  }

  const baseline = results[0];
  const worst = [...results].sort((a, b) => b.loop.p95Ms - a.loop.p95Ms)[0];
  lines.push("", "## Automatic Assessment", "");
  lines.push(
    `Baseline loop: ${formatNumber(baseline.loop.averageMs, 3)} ms average, ` +
    `${formatNumber(baseline.loop.p95Ms)} ms P95.`
  );
  lines.push(
    `Highest loop P95: ${worst.name} with ${formatNumber(worst.loop.p95Ms)} ms ` +
    `(${formatNumber(worst.loop.averageMs, 3)} ms average).`
  );
  if (worst.loop.p95Ms > Math.max(4, baseline.loop.p95Ms * 1.5)) {
    lines.push("This scenario causes a significant measured game-loop increase and should be investigated first.");
  } else {
    lines.push("No tested scenario caused a severe measured game-loop increase.");
  }
  lines.push("", "The report is generated with an isolated browser profile and does not modify real savegames.", "");
  return lines.join("\n");
}

async function main() {
  if (fs.existsSync(ERROR_LOG_PATH)) fs.unlinkSync(ERROR_LOG_PATH);
  await ensureServer();
  const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const zoomSweep = [0.04, 0.06, 0.08, 0.12, 0.2, 0.35, 0.6, 1, 2, 3];
  let scenarios = [
    { name: "Baseline flight" },
    ...zoomSweep.map(zoom => ({ name: `Camera zoom ${zoom.toFixed(2)}`, zoom, runs: 1 })),
    { name: "Notification stack", notifications: 8 },
    { name: "5 nearby enemies", nearbyEnemies: 5 },
    { name: "12 nearby asteroids", asteroids: 12 },
    { name: "8 turrets", turrets: 8, zoom: 1 },
    { name: "8 turrets and 4 enemies", turrets: 8, nearbyEnemies: 4, zoom: 1 },
    { name: "End world with 4 enemies", nearbyEnemies: 4, endWorld: true, zoom: 1 },
    { name: "End world central planet landing", endWorld: true, landing: true, zoom: 0.08 },
    { name: "150 additional buildings", extraModules: 150, zoom: 1 },
    { name: "Build mode maximum zoom", buildMode: true, zoom: 3 },
    { name: "Maximum zoom without UI", zoom: 3, disableUi: true }
  ];
  const results = [];
  const checks = [];

  try {
    let realSaveUsed = false;
    if (fs.existsSync(REAL_SAVE_PATH)) {
      const exportedSave = JSON.parse(fs.readFileSync(REAL_SAVE_PATH, "utf8"));
      realSaveUsed = true;
      scenarios = [
        { name: "Savegame baseline", exportedSave },
        ...zoomSweep.map(zoom => ({ name: `Savegame camera zoom ${zoom.toFixed(2)}`, exportedSave, zoom, runs: 1 })),
        { name: "Savegame notification stack", exportedSave, notifications: 8 },
        { name: "Savegame + 5 nearby enemies", exportedSave, nearbyEnemies: 5 },
        { name: "Savegame + 12 nearby asteroids", exportedSave, asteroids: 12 },
        { name: "Savegame + 8 turrets", exportedSave, turrets: 8, zoom: 1 },
        { name: "Savegame + 8 turrets and 4 enemies", exportedSave, turrets: 8, nearbyEnemies: 4, zoom: 1 },
        { name: "Savegame end world + 4 enemies", exportedSave, nearbyEnemies: 4, endWorld: true, zoom: 1 },
        { name: "Savegame end world central planet landing", exportedSave, endWorld: true, landing: true, zoom: 0.08 },
        { name: "Savegame + 150 buildings", exportedSave, extraModules: 150, zoom: 1 },
        { name: "Savegame build mode maximum zoom", exportedSave, buildMode: true, zoom: 3 },
        { name: "Savegame maximum zoom without UI", exportedSave, zoom: 3, disableUi: true }
      ];
      checks.push({
        name: "Optional real savegame",
        passed: true,
        details: `${path.basename(REAL_SAVE_PATH)} is reloaded before every scenario; no generated world is used for performance measurements`
      });
    } else {
      checks.push({
        name: "Optional real savegame",
        status: "SKIP",
        details: `${path.basename(REAL_SAVE_PATH)} was not present; synthetic scenarios were tested`
      });
    }
    console.log("Testing: Save preview hover");
    checks.push(await testSavePreviewHover(page));
    console.log("Testing: Moving-target turret accuracy");
    checks.push(await testMovingTargetTurretAccuracy(page));
    console.log("Testing: End-world central planet resources");
    checks.push(await testEndTwinPlanetResources(page));
    console.log("Testing: Orbit and landing save persistence");
    checks.push(await testFlightStatePersistence(page));
    for (const scenario of scenarios) {
      console.log(`Testing: ${scenario.name}`);
      results.push(await collectScenario(page, scenario));
    }
    const generatedAt = new Date().toISOString();
    checks.push({
      name: "Latest-only report output",
      passed: path.basename(REPORT_PATH).includes("latest") && path.basename(DATA_PATH).includes("latest"),
      details: `${path.basename(REPORT_PATH)} and ${path.basename(DATA_PATH)} are overwritten each run; no archive directory is used`
    });
    const report = createReport(results, generatedAt, checks, realSaveUsed);
    fs.writeFileSync(REPORT_PATH, report, "utf8");
    fs.writeFileSync(DATA_PATH, JSON.stringify({ generatedAt, checks, results }, null, 2), "utf8");
    console.log(`Latest report: ${REPORT_PATH}`);
    console.log(`Latest raw measurements: ${DATA_PATH}`);
  } finally {
    await browser.close();
    for (const server of managedServers) server.kill();
  }
}

main().catch(error => {
  console.error(error);
  try {
    fs.writeFileSync(
      ERROR_LOG_PATH,
      `${new Date().toISOString()}\n${error?.stack || error}\n`,
      "utf8"
    );
    console.error(`Error log written to ${ERROR_LOG_PATH}`);
  } catch (writeError) {
    console.error("The performance error log could not be written.", writeError);
  }
  process.exitCode = 1;
});
