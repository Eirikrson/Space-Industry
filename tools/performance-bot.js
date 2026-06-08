const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const REPORT_PATH = path.join(ROOT, "performance-report-latest.md");
const DATA_PATH = path.join(ROOT, "performance-data-latest.json");
const ERROR_LOG_PATH = path.join(ROOT, "performance-bot-error-latest.log");
const SERVER_URL = "http://127.0.0.1:8765/index.html";
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const NODE_PATH = process.execPath;
const PROFILE_FUNCTIONS = [
  "drawGalaxyBackground",
  "drawParallaxStarfield",
  "drawDysonSpheres",
  "drawModules",
  "drawEnemyShips",
  "drawSmallShips",
  "drawCombatBullets",
  "drawUI",
  "drawResourceUI",
  "drawMapOverlay",
  "drawTooltip",
  "drawPlanetResourceTooltip",
  "updateSpaceHazards",
  "updateResources",
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
    if (await isServerReady()) return child;
  }
  child.kill();
  throw new Error("The local game server could not be started.");
}

async function prepareWorld(page, seed) {
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

    keys.w = true;
  }, scenario);
}

async function collectScenario(page, scenario) {
  await prepareWorld(page, 4100 + scenario.seed);
  await installProfiler(page);
  await configureScenario(page, scenario);
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    keys.w = false;
    window.__performanceBot.running = false;
  });

  return page.evaluate(name => {
    const frames = window.__performanceBot.frames.slice(30).sort((a, b) => a - b);
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
    const loopTimes = window.__performanceBot.loopTimes.slice(10).sort((a, b) => a - b);
    const longTasks = window.__performanceBot.longTasks.slice().sort((a, b) => a - b);

    return {
      name,
      averageFrameMs,
      fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
      p95FrameMs: percentile(0.95),
      maxFrameMs: frames[frames.length - 1] || 0,
      frameSamples: frames.length,
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
        planets: planets.length,
        asteroids: asteroids.length,
        enemies: enemyShips.length,
        drones: smallShips.length,
        messages: flashMessages.length,
        activeSystems: solarSystems.filter(system =>
          isSystemNearActiveFocus(system, [{ x: ship.x, y: ship.y }])
        ).length
      }
    };
  }, scenario.name);
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

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function createReport(results, generatedAt, checks) {
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
    lines.push(`| ${check.name} | ${check.passed ? "PASS" : "FAIL"} | ${details} |`);
  }

  lines.push(
    "",
    "## Scenario Summary",
    "",
    "| Scenario | FPS | Average frame | Loop average | P95 frame | Maximum frame | Long tasks |",
    "|---|---:|---:|---:|---:|---:|---:|"
  );

  for (const result of results) {
    lines.push(
      `| ${result.name} | ${formatNumber(result.fps, 1)} | ${formatNumber(result.averageFrameMs)} ms | ` +
      `${formatNumber(result.loop.averageMs)} ms | ${formatNumber(result.p95FrameMs)} ms | ` +
      `${formatNumber(result.maxFrameMs)} ms | ${result.longTasks.count} |`
    );
  }

  for (const result of results) {
    lines.push("", `## ${result.name}`, "");
    lines.push(
      `Objects: ${result.counts.modules} modules, ${result.counts.planets} planets, ` +
      `${result.counts.asteroids} asteroids, ${result.counts.enemies} enemies, ` +
      `${result.counts.drones} drones, ${result.counts.activeSystems} active systems.`
    );
    lines.push(
      `Complete game loop: ${formatNumber(result.loop.averageMs, 3)} ms average, ` +
      `${formatNumber(result.loop.p95Ms)} ms P95, ${formatNumber(result.loop.maxMs)} ms maximum.`
    );
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
  const worst = [...results].sort((a, b) => a.fps - b.fps)[0];
  lines.push("", "## Automatic Assessment", "");
  lines.push(`Baseline: ${formatNumber(baseline.fps, 1)} FPS.`);
  lines.push(`Slowest scenario: ${worst.name} with ${formatNumber(worst.fps, 1)} FPS.`);
  if (worst.fps < baseline.fps * 0.65) {
    lines.push("This scenario causes a significant performance drop and should be investigated first.");
  } else {
    lines.push("No tested scenario caused a severe relative performance collapse.");
  }
  lines.push("", "The report is generated with an isolated browser profile and does not modify real savegames.", "");
  return lines.join("\n");
}

async function main() {
  if (fs.existsSync(ERROR_LOG_PATH)) fs.unlinkSync(ERROR_LOG_PATH);
  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const scenarios = [
    { name: "Baseline flight", seed: 1 },
    { name: "Notification stack", seed: 2, notifications: 8 },
    { name: "50 enemies", seed: 3, enemies: 50 },
    { name: "100 distant drones", seed: 4, drones: 100 },
    { name: "Combined load", seed: 5, notifications: 8, enemies: 50, drones: 100 }
  ];
  const results = [];
  const checks = [];

  try {
    console.log("Testing: Save preview hover");
    checks.push(await testSavePreviewHover(page));
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
    const report = createReport(results, generatedAt, checks);
    fs.writeFileSync(REPORT_PATH, report, "utf8");
    fs.writeFileSync(DATA_PATH, JSON.stringify({ generatedAt, checks, results }, null, 2), "utf8");
    console.log(`Latest report: ${REPORT_PATH}`);
    console.log(`Latest raw measurements: ${DATA_PATH}`);
  } finally {
    await browser.close();
    if (server) server.kill();
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
