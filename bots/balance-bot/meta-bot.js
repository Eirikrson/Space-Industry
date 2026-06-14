const fs = require("fs");
const path = require("path");

const {
  loadConfig,
  formatLocalTimestamp,
  getCreativeGameData,
  createCreativeState,
  creativeConfigureAutoDispose,
  creativeSolidUsed,
  creativePower,
  creativeAdvance,
  creativeMineBatch,
  creativeBuildDysonSphere,
  creativeBuild,
  creativeResearch,
  creativeSummarize
} = require("./creative-bot");

const BOT_DIR = __dirname;
const args = process.argv.slice(2);

function numberArg(name, fallback) {
  const value = args.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  return value === undefined ? fallback : Number(value);
}

function loadMetaConfig() {
  const raw = loadConfig();
  return {
    strategies: Math.max(4, Math.floor(numberArg("--strategies", raw.metaStrategies || 12))),
    generations: Math.max(1, Math.floor(numberArg("--generations", raw.metaGenerations || 3))),
    depth: Math.max(1, Math.min(5, Math.floor(numberArg("--depth", raw.metaSearchDepth || 3)))),
    beamWidth: Math.max(2, Math.floor(numberArg("--beam", raw.metaBeamWidth || 6))),
    maxDecisions: Math.max(20, Math.floor(numberArg("--decisions", raw.metaMaxDecisions || 180))),
    maxSeconds: Math.max(3600, numberArg("--hours", raw.metaMaxHours || 72) * 3600)
  };
}

function cloneState(state) {
  const plain = JSON.parse(JSON.stringify({
    ...state,
    research: Array.from(state.research)
  }));
  plain.research = new Set(plain.research);
  return plain;
}

function count(state, name) {
  return state.buildings[name] || 0;
}

function computerLevel(state) {
  if (state.research.has("Computer MK4")) return 4;
  if (state.research.has("Computer MK3")) return 3;
  if (state.research.has("Computer MK2")) return 2;
  return 1;
}

function requiredComputerLevel(name) {
  if (name === "Hangar MK1") return 2;
  if (name === "Hangar MK2") return 3;
  if (name === "Hangar MK3") return 4;
  return 1;
}

const BUILD_LIMITS = {
  "Solar Panel": 14,
  "Warehouse MK1": 4,
  "Warehouse MK2": 4,
  "Battery MK1": 3,
  "Battery MK2": 12,
  "Tank MK1": 3,
  "Tank MK2": 3,
  "Drill": 5,
  "Asteroid Collector": 4,
  "Smelter": 3,
  "Assembler": 3,
  "Laboratory": 1,
  "Electrolyser": 2,
  "Fuel Processor": 2,
  "Event Horizon Shield": 4
};

function buildLimit(name) {
  if (BUILD_LIMITS[name] !== undefined) return BUILD_LIMITS[name];
  if (/Turret|Shield Generator|Hangar|Reactor|Turbine|Scooper|Collector/.test(name)) return 2;
  return 1;
}

function endGoalReady(state, data) {
  return count(state, "Quantum Computer") >= 1 &&
    count(state, "Gravitational Pull Stabilizer") >= 1 &&
    count(state, "Event Horizon Shield") >= 4 &&
    (state.resources.energyCap || 0) >= 45000 &&
    creativePower(state, data).net > 0;
}

function enumerateActions(state, data) {
  if (state.completed || state.failed) return [];
  const actions = [];
  const level = computerLevel(state);

  if (count(state, "Laboratory") > 0) {
    data.buildings.RESEARCH_TIERS.forEach((tier, tierIndex) => {
      if (level < tierIndex + 1) return;
      for (const item of tier.items) {
        if (!state.research.has(item.name)) {
          actions.push({ type: "research", name: item.name, tierIndex });
        }
      }
    });
  }

  const unlocked = new Set([
    ...data.buildings.BASE_UNLOCKED_BUILDINGS,
    ...state.research
  ]);
  for (const name of unlocked) {
    if (!data.buildings.BUILD_COSTS[name]) continue;
    if (level < requiredComputerLevel(name)) continue;
    if (count(state, name) >= buildLimit(name)) continue;
    if (
      !state.dysonSphere &&
      ["Event Horizon Shield", "Gravitational Pull Stabilizer", "Quantum Computer"].includes(name)
    ) {
      continue;
    }
    actions.push({ type: "build", name });
  }

  const storageRatio = creativeSolidUsed(state, data) / Math.max(1, state.resources.itemCap || 0);
  const rawReserveLow = [
    ["ironOre", 80],
    ["copperOre", 60],
    ["siliconOre", 35],
    ["nickel", 30],
    ["carbon", 25],
    ["uranium", 12],
    ["water", 30]
  ].some(([key, target]) => (state.resources[key] || 0) < target);
  if (
    count(state, "Drill") > 0 &&
    rawReserveLow &&
    storageRatio < 0.8 &&
    state.consecutiveActionType !== "mine"
  ) {
    actions.push({ type: "mine", name: "Asteroid expedition" });
  }
  const energyCapacity = state.resources.energyCap || 0;
  const needsCharge =
    creativePower(state, data).net > 0 &&
    (state.resources.energy || 0) < Math.min(500, energyCapacity * 0.25);
  if (needsCharge && state.consecutiveActionType !== "wait") {
    actions.push({ type: "wait", name: "Store resources", seconds: 30 });
    actions.push({ type: "wait", name: "Store resources", seconds: 120 });
  }
  if (
    !state.dysonSphere &&
    state.research.has("Computer MK4") &&
    count(state, "Assembler") > 0 &&
    count(state, "Smelter") > 0 &&
    count(state, "Drill") > 0 &&
    count(state, "Electrolyser") > 0 &&
    count(state, "Fuel Processor") > 0
  ) {
    return [{ type: "dyson", name: "Build Dyson sphere" }];
  }
  if (state.dysonSphere) {
    const missingEndgame = actions.filter(action =>
      action.type === "build" &&
      (
        action.name === "Quantum Computer" ||
        action.name === "Gravitational Pull Stabilizer" ||
        action.name === "Event Horizon Shield"
      )
    );
    if (missingEndgame.length > 0) return missingEndgame;
    if ((state.resources.energyCap || 0) < 45000) {
      const batteryActions = actions.filter(action =>
        action.name === "Battery MK2" &&
        (action.type === "research" || action.type === "build")
      );
      if (batteryActions.length > 0) return batteryActions;
    }
  }
  if (endGoalReady(state, data)) actions.push({ type: "finish", name: "Enter black hole" });
  return actions;
}

function applyAction(state, action, data) {
  const start = state.time;
  const previousType = state.consecutiveActionType;
  let success = false;
  if (action.type === "build") success = creativeBuild(state, data, action.name);
  if (action.type === "research") {
    const item = data.buildings.RESEARCH_TIERS[action.tierIndex].items
      .find(candidate => candidate.name === action.name);
    success = !!item && creativeResearch(state, data, item, action.tierIndex);
  }
  if (action.type === "mine") success = creativeMineBatch(state, data);
  if (action.type === "wait") {
    creativeAdvance(state, action.seconds, data, "strategic wait");
    success = true;
  }
  if (action.type === "dyson") {
    success = creativeBuildDysonSphere(state, data);
  }
  if (action.type === "finish") {
    const net = creativePower(state, data).net;
    if (endGoalReady(state, data) && net > 0) {
      const seconds = Math.max(0, 45000 - (state.resources.energy || 0)) / net;
      creativeAdvance(state, seconds, data, "charge for black hole");
      state.resources.energy = Math.max(45000, state.resources.energy || 0);
      state.completed = true;
      state.milestones.endGoal = state.time;
      success = true;
    }
  }
  if (!success || state.time === start && action.type !== "finish") return false;
  state.consecutiveActionCount = previousType === action.type
    ? (state.consecutiveActionCount || 0) + 1
    : 1;
  state.consecutiveActionType = action.type;
  return !state.failed;
}

const KEY_TECH = {
  Drill: 500,
  Smelter: 500,
  Assembler: 1200,
  Electrolyser: 400,
  "Fuel Processor": 400,
  "Computer MK2": 1800,
  "Computer MK3": 3000,
  "Computer MK4": 5000,
  "Battery MK2": 1200,
  "Warehouse MK2": 150,
  "Fusion Reactor": 150,
  "Event Horizon Shield": 8000,
  "Gravitational Pull Stabilizer": 9000,
  "Quantum Computer": 9000
};

const USEFUL_BUILDINGS = new Set([
  "Computer", "RCS Thruster", "Warehouse MK1", "Warehouse MK2",
  "Asteroid Collector", "Solar Panel", "Laboratory", "Life Support",
  "Farm Module", "Quarters", "Tank MK1", "Tank MK2", "Battery MK1",
  "Battery MK2", "Drill", "Smelter", "Assembler", "Electrolyser",
  "Fuel Processor", "Turbine", "Condenser Turbine", "Fusion Reactor",
  "Event Horizon Shield", "Gravitational Pull Stabilizer", "Quantum Computer"
]);

function stateScore(state, data, genome) {
  if (state.completed) return 1e9 - state.time * genome.time;

  let research = 0;
  for (const name of state.research) {
    research += (KEY_TECH[name] || 0) * (genome.techBias[name] || 1);
  }
  const power = creativePower(state, data);
  const production =
    Math.min(2, count(state, "Drill")) * 650 +
    Math.max(0, Math.min(3, count(state, "Drill")) - 2) * 100 +
    Math.min(2, count(state, "Smelter")) * 450 +
    Math.max(0, Math.min(3, count(state, "Smelter")) - 2) * 75 +
    Math.min(1, count(state, "Assembler")) * 700 +
    Math.max(0, Math.min(3, count(state, "Assembler")) - 1) * 100 +
    Math.min(2, count(state, "Asteroid Collector")) * 25 +
    Math.min(1, count(state, "Electrolyser")) * 180 +
    Math.min(1, count(state, "Fuel Processor")) * 180;
  const endgame =
    count(state, "Quantum Computer") * 100000 +
    count(state, "Gravitational Pull Stabilizer") * 100000 +
    Math.min(4, count(state, "Event Horizon Shield")) * 50000 +
    Math.min(1, (state.resources.energyCap || 0) / 45000) * 30000 +
    (state.dysonSphere ? 120000 : 0);
  const inventory = Object.entries(state.resources)
    .filter(([key]) => !key.endsWith("Cap") && key !== "energy")
    .reduce((sum, [, value]) => sum + Math.sqrt(Math.max(0, Number(value) || 0)), 0);
  const shortage = Object.values(state.shortages || {}).reduce((sum, value) => sum + value, 0);
  const overflow = Object.values(state.overflow || {}).reduce((sum, value) => sum + value, 0);
  const storageRatio = creativeSolidUsed(state, data) / Math.max(1, state.resources.itemCap || 0);
  const unusableUnlockPenalty =
    (state.research.has("Drill") && count(state, "Drill") === 0 ? 650 : 0) +
    (state.research.has("Smelter") && count(state, "Smelter") === 0 ? 450 : 0) +
    (state.research.has("Assembler") && count(state, "Assembler") === 0 ? 400 : 0);
  const optionalBuildings = Object.entries(state.buildings)
    .filter(([name]) => !USEFUL_BUILDINGS.has(name))
    .reduce((sum, [, amount]) => sum + amount, 0);
  const excessiveBuildings =
    Math.max(0, count(state, "Drill") - 3) +
    Math.max(0, count(state, "Smelter") - 2) +
    Math.max(0, count(state, "Assembler") - 2) +
    Math.max(0, count(state, "Electrolyser") - 1) +
    Math.max(0, count(state, "Fuel Processor") - 1);
  const optionalResearch = data.buildings.RESEARCH_TIERS
    .flatMap(tier => tier.items)
    .filter(item => state.research.has(item.name) && !KEY_TECH[item.name])
    .length;
  const failurePenalty = state.failed ? 1e7 : 0;
  const unpoweredEndgamePenalty =
    !state.dysonSphere &&
    (
      count(state, "Quantum Computer") +
      count(state, "Gravitational Pull Stabilizer") +
      count(state, "Event Horizon Shield")
    ) > 0
      ? 50000
      : 0;

  return research * genome.research +
    production * genome.production +
    endgame * genome.goal +
    Math.max(-20, power.net) * genome.energy * 12 +
    inventory * genome.resources +
    state.drones * 90 * genome.production -
    state.time * genome.time -
    state.noProgressTime * genome.idle -
    shortage * genome.shortage -
    overflow * genome.overflow -
    unusableUnlockPenalty * genome.production -
    optionalBuildings * 500 * genome.thrift -
    excessiveBuildings * 250 * genome.thrift -
    optionalResearch * 300 * genome.thrift -
    unpoweredEndgamePenalty -
    failurePenalty -
    Math.max(0, storageRatio - 0.85) * 500 * genome.storage;
}

function actionKey(action) {
  return `${action.type}:${action.name}:${action.seconds || 0}`;
}

function searchBestAction(state, data, genome, config) {
  let beam = [{
    state: cloneState(state),
    actions: [],
    score: stateScore(state, data, genome)
  }];
  const considered = [];
  const rejected = [];
  const availableActions = enumerateActions(state, data).map(actionKey);

  for (let depth = 0; depth < config.depth; depth++) {
    const next = [];
    for (const node of beam) {
      const actions = enumerateActions(node.state, data);
      for (const action of actions) {
        const simulated = cloneState(node.state);
        if (!applyAction(simulated, action, data)) {
          if (depth === 0 && rejected.length < 20) {
            rejected.push({
              action: actionKey(action),
              shortages: { ...(simulated.shortages || {}) }
            });
          }
          continue;
        }
        const sequence = [...node.actions, action];
        const score = stateScore(simulated, data, genome);
        next.push({ state: simulated, actions: sequence, score });
      }
    }
    next.sort((a, b) => b.score - a.score ||
      a.state.time - b.state.time ||
      actionKey(a.actions[0]).localeCompare(actionKey(b.actions[0])));
    beam = next.slice(0, config.beamWidth);
    if (beam.length === 0 || beam[0].state.completed) break;
  }

  for (const node of beam.slice(0, 5)) {
    considered.push({
      score: Number(node.score.toFixed(2)),
      sequence: node.actions.map(action => actionKey(action))
    });
  }
  return beam.length > 0
    ? { action: beam[0].actions[0], considered, rejected, availableActions }
    : null;
}

function snapshot(state, data, decision, action, considered, rejected, availableActions) {
  const keys = [
    "ironOre", "copperOre", "siliconOre", "ironPlate", "copperPlate",
    "silicon", "nickel", "carbon", "uranium", "water", "fuel"
  ];
  const resources = Object.fromEntries(keys.map(key => [
    key,
    Number((state.resources[key] || 0).toFixed(2))
  ]));
  const power = creativePower(state, data);
  return {
    decision,
    atSeconds: Number(state.time.toFixed(2)),
    action: actionKey(action),
    resources,
    energy: Number((state.resources.energy || 0).toFixed(2)),
    energyCapacity: state.resources.energyCap || 0,
    energyNet: Number(power.net.toFixed(2)),
    researchCount: state.research.size,
    considered,
    rejected,
    availableActions
  };
}

function runGame(data, genome, config) {
  const state = createCreativeState(data, {
    id: genome.id,
    name: genome.name,
    archetype: "Meta Search",
    energy: genome.energy,
    mining: genome.mining,
    research: genome.research,
    expansion: genome.expansion,
    thrift: genome.thrift
  });
  creativeConfigureAutoDispose(state);
  const decisions = [];

  for (let decision = 1; decision <= config.maxDecisions; decision++) {
    if (state.completed || state.failed || state.time > config.maxSeconds) break;
    const choice = searchBestAction(state, data, genome, config);
    if (!choice?.action) {
      state.failed = true;
      state.failureReason = "no legal action could advance the simulation";
      break;
    }
    if (!applyAction(state, choice.action, data)) {
      state.failed = true;
      state.failureReason = `selected action failed: ${actionKey(choice.action)}`;
      break;
    }
    decisions.push(snapshot(
      state,
      data,
      decision,
      choice.action,
      choice.considered,
      choice.rejected,
      choice.availableActions
    ));
  }

  if (!state.completed && !state.failed) {
    state.failed = true;
    state.failureReason = state.time > config.maxSeconds
      ? "simulation time limit"
      : "decision limit";
  }
  const summary = creativeSummarize(state, data);
  summary.genome = genome;
  summary.decisions = decisions;
  summary.score = stateScore(state, data, genome);
  return summary;
}

const TECH_NAMES = [
  "Drill", "Smelter", "Assembler", "Electrolyser", "Fuel Processor",
  "Computer MK2", "Computer MK3", "Computer MK4", "Battery MK2",
  "Warehouse MK2", "Fusion Reactor", "Event Horizon Shield",
  "Gravitational Pull Stabilizer", "Quantum Computer"
];

function baseGenome(index) {
  const wave = (offset, scale = 0.35) =>
    1 + Math.sin((index + 1) * (offset + 1) * 1.618) * scale;
  return {
    id: index + 1,
    name: `Meta Seed ${String(index + 1).padStart(3, "0")}`,
    energy: wave(1),
    mining: wave(2),
    research: wave(3),
    expansion: wave(4),
    thrift: wave(5),
    production: wave(6),
    resources: wave(7, 0.2),
    goal: wave(8, 0.2),
    time: Math.max(0.3, wave(9, 0.25)),
    idle: wave(10, 0.3),
    shortage: wave(11, 0.3),
    overflow: wave(12, 0.3),
    storage: wave(13, 0.3),
    techBias: Object.fromEntries(TECH_NAMES.map((name, techIndex) => [
      name,
      wave(20 + techIndex, 0.45)
    ]))
  };
}

function breedGenome(a, b, generation, index) {
  const child = { techBias: {} };
  const fields = [
    "energy", "mining", "research", "expansion", "thrift", "production",
    "resources", "goal", "time", "idle", "shortage", "overflow", "storage"
  ];
  for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex++) {
    const field = fields[fieldIndex];
    const mutation = 1 + Math.sin((generation + 1) * 31 + index * 17 + fieldIndex * 7) * 0.12;
    child[field] = Math.max(0.2, ((a[field] + b[field]) / 2) * mutation);
  }
  for (let techIndex = 0; techIndex < TECH_NAMES.length; techIndex++) {
    const name = TECH_NAMES[techIndex];
    const mutation = 1 + Math.cos(generation * 19 + index * 11 + techIndex * 5) * 0.18;
    child.techBias[name] = Math.max(
      0.2,
      ((a.techBias[name] + b.techBias[name]) / 2) * mutation
    );
  }
  child.id = generation * 10000 + index + 1;
  child.name = `Generation ${generation + 1} Child ${String(index + 1).padStart(3, "0")}`;
  return child;
}

function resultFitness(result) {
  if (result.completed) return 1e9 - result.simulatedSeconds - result.totalConsumed * 0.05;
  const criticalResearch = result.research.reduce(
    (sum, name) => sum + (KEY_TECH[name] || 0),
    0
  );
  const endgameBuildings =
    (result.buildings["Quantum Computer"] || 0) * 20000 +
    (result.buildings["Gravitational Pull Stabilizer"] || 0) * 20000 +
    Math.min(4, result.buildings["Event Horizon Shield"] || 0) * 10000;
  return criticalResearch +
    endgameBuildings +
    (result.dysonSphere ? 100000 : 0) +
    Math.min(45000, result.finalEnergyCapacity || 0) +
    result.research.length * 10 -
    result.simulatedSeconds * 0.01;
}

function nextGeneration(results, count, generation) {
  const ranked = results.slice().sort((a, b) => resultFitness(b) - resultFitness(a));
  const eliteCount = Math.max(2, Math.ceil(count * 0.2));
  const elites = ranked.slice(0, eliteCount).map(result => result.genome);
  const next = elites.slice(0, Math.max(1, Math.floor(count * 0.1))).map((genome, index) => ({
    ...genome,
    techBias: { ...genome.techBias },
    id: generation * 10000 + index + 1,
    name: `Generation ${generation + 1} Elite ${String(index + 1).padStart(3, "0")}`
  }));
  while (next.length < count) {
    const index = next.length;
    const a = elites[index % elites.length];
    const b = elites[(index * 3 + generation + 1) % elites.length];
    next.push(breedGenome(a, b, generation, index));
  }
  return next;
}

function percentage(value, total) {
  return total > 0 ? value * 100 / total : 0;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function buildMetaAnalysis(results, data) {
  const successful = results.filter(result => result.completed);
  const ranked = successful.slice().sort((a, b) => a.simulatedSeconds - b.simulatedSeconds);
  const fallbackRanked = results.slice().sort((a, b) => resultFitness(b) - resultFitness(a));
  const source = ranked.length > 0 ? ranked : fallbackRanked;
  const sample = source.slice(0, Math.max(1, Math.ceil(source.length * 0.25)));
  const buildingStats = Object.fromEntries(
    Object.keys(data.buildings.BUILD_COSTS)
      .map(name => [name, { uses: 0, firstTimes: [], counts: [] }])
  );
  const technologyStats = Object.fromEntries(
    data.buildings.RESEARCH_TIERS
      .flatMap(tier => tier.items)
      .map(item => [item.name, { uses: 0, firstTimes: [] }])
  );
  const bottlenecks = {};
  const surplus = {};

  for (const result of sample) {
    const firstBuild = new Map();
    for (const item of result.buildLog) {
      if (!firstBuild.has(item.name)) firstBuild.set(item.name, item.at);
    }
    for (const [name, at] of firstBuild) {
      const stat = buildingStats[name] || { uses: 0, firstTimes: [], counts: [] };
      stat.uses++;
      stat.firstTimes.push(at);
      stat.counts.push(result.buildings[name] || 0);
      buildingStats[name] = stat;
    }
    const firstResearch = new Map();
    for (const item of result.researchLog) {
      if (!firstResearch.has(item.name)) firstResearch.set(item.name, item.at);
    }
    for (const [name, at] of firstResearch) {
      const stat = technologyStats[name] || { uses: 0, firstTimes: [] };
      stat.uses++;
      stat.firstTimes.push(at);
      technologyStats[name] = stat;
    }
    const topShortage = Object.entries(result.shortages || {})
      .sort((a, b) => b[1] - a[1])[0];
    if (topShortage) bottlenecks[topShortage[0]] = (bottlenecks[topShortage[0]] || 0) + 1;
    const scarcity = {};
    for (const decision of result.decisions || []) {
      for (const [key, value] of Object.entries(decision.resources || {})) {
        const threshold = key === "water" ? 20 : key === "fuel" ? 10 : 5;
        if (value < threshold) scarcity[key] = (scarcity[key] || 0) + 1;
      }
      if ((decision.energy || 0) < 5) scarcity.energy = (scarcity.energy || 0) + 1;
    }
    const topScarcity = Object.entries(scarcity).sort((a, b) => b[1] - a[1])[0];
    if (topScarcity) {
      bottlenecks[topScarcity[0]] = (bottlenecks[topScarcity[0]] || 0) + 1;
    }
    for (const [key, amount] of Object.entries(result.surplus || {})) {
      surplus[key] = (surplus[key] || 0) + amount;
    }
  }

  const buildings = Object.entries(buildingStats).map(([name, stat]) => ({
    name,
    usagePercent: percentage(stat.uses, sample.length),
    averageFirstMinute: stat.firstTimes.length ? average(stat.firstTimes) / 60 : null,
    averageCount: average(stat.counts),
    assessment: percentage(stat.uses, sample.length) >= 90
      ? "Possibly too strong or mandatory"
      : percentage(stat.uses, sample.length) <= 10
        ? "Possibly too weak or too expensive"
        : "No clear warning"
  })).sort((a, b) => b.usagePercent - a.usagePercent || a.name.localeCompare(b.name));

  const technologies = Object.entries(technologyStats).map(([name, stat]) => ({
    name,
    usagePercent: percentage(stat.uses, sample.length),
    averageFirstMinute: stat.firstTimes.length ? average(stat.firstTimes) / 60 : null,
    assessment: percentage(stat.uses, sample.length) >= 90
      ? "Possibly mandatory"
      : percentage(stat.uses, sample.length) <= 10
        ? "Possibly weak"
        : "No clear warning"
  })).sort((a, b) => b.usagePercent - a.usagePercent || a.name.localeCompare(b.name));

  return {
    successfulRuns: successful.length,
    eliteSampleSize: sample.length,
    sampleBasis: successful.length > 0 ? "fastest successful strategies" : "best incomplete strategies",
    buildings,
    technologies,
    bottlenecks: Object.entries(bottlenecks)
      .map(([name, games]) => ({ name, games, percent: percentage(games, sample.length) }))
      .sort((a, b) => b.games - a.games),
    surpluses: Object.entries(surplus)
      .map(([name, total]) => ({ name, average: total / Math.max(1, sample.length) }))
      .sort((a, b) => b.average - a.average)
  };
}

function writeReport(filePath, runId, config, allResults, finalResults, analysis, runtimeSeconds) {
  const successful = allResults.filter(result => result.completed)
    .sort((a, b) => a.simulatedSeconds - b.simulatedSeconds);
  const best = successful[0] ||
    allResults.slice().sort((a, b) => resultFitness(b) - resultFitness(a))[0];
  const lines = [
    "# Space Industry Meta Report",
    "",
    `Run: ${runId}`,
    `Simulated strategies: ${allResults.length}`,
    `Learning generations: ${config.generations}`,
    `Successful strategies: ${successful.length}`,
    `Wall-clock runtime: ${runtimeSeconds.toFixed(2)} s`,
    `Best simulated game time: ${best?.completed ? `${(best.simulatedSeconds / 3600).toFixed(2)} h` : "no victory"}`,
    `Dyson sphere used: ${best?.dysonSphere ? "yes" : "no"}`,
    "",
    "## Best Strategy",
    "",
    `Strategy: ${best?.name || "none"}`,
    `Result: ${best?.completed ? "completed" : best?.failureReason || "failed"}`,
    `Simulated time: ${((best?.simulatedSeconds || 0) / 3600).toFixed(2)} h`,
    `Decisions: ${best?.decisions.length || 0}`,
    "",
    "### Action Order",
    ""
  ];
  for (const item of best?.decisions || []) {
    lines.push(`${item.decision}. ${(item.atSeconds / 60).toFixed(1)} min - ${item.action}`);
  }

  lines.push(
    "",
    "### Resource And Energy Development",
    "",
    "| Step | Time | Action | Energy | Net | Storage | Research | Water | Fuel |",
    "|---:|---:|---|---:|---:|---:|---:|---:|---:|"
  );
  for (const item of (best?.decisions || []).filter((_, index) => index < 40 || index % 10 === 0)) {
    lines.push(
      `| ${item.decision} | ${(item.atSeconds / 60).toFixed(1)} min | ${item.action} | ` +
      `${item.energy.toFixed(1)} | ${item.energyNet.toFixed(1)} | ${item.energyCapacity} | ` +
      `${item.researchCount} | ${item.resources.water.toFixed(1)} | ${item.resources.fuel.toFixed(1)} |`
    );
  }

  lines.push(
    "",
    "## Building Meta",
    "",
    `Sample basis: ${analysis.sampleBasis} (${analysis.eliteSampleSize} runs)`,
    "",
    "| Building | Elite usage | Average first build | Average count | Assessment |",
    "|---|---:|---:|---:|---|"
  );
  for (const item of analysis.buildings) {
    lines.push(
      `| ${item.name} | ${item.usagePercent.toFixed(1)}% | ` +
      `${item.averageFirstMinute === null ? "never" : `${item.averageFirstMinute.toFixed(1)} min`} | ` +
      `${item.averageCount.toFixed(2)} | ${item.assessment} |`
    );
  }

  lines.push(
    "",
    "## Technology Meta",
    "",
    "| Technology | Elite usage | Average research time | Assessment |",
    "|---|---:|---:|---|"
  );
  for (const item of analysis.technologies) {
    lines.push(
      `| ${item.name} | ${item.usagePercent.toFixed(1)}% | ` +
      `${item.averageFirstMinute === null ? "never" : `${item.averageFirstMinute.toFixed(1)} min`} | ` +
      `${item.assessment} |`
    );
  }

  lines.push(
    "",
    "## Largest Bottlenecks",
    "",
    "| Resource or goal | Main bottleneck in elite games | Recommendation |",
    "|---|---:|---|"
  );
  for (const item of analysis.bottlenecks.slice(0, 12)) {
    lines.push(
      `| ${item.name} | ${item.percent.toFixed(1)}% | ` +
      `Review production, consumption, storage access, or cost for ${item.name}. |`
    );
  }

  lines.push(
    "",
    "## Largest Surpluses",
    "",
    "| Resource | Average final amount | Recommendation |",
    "|---|---:|---|"
  );
  for (const item of analysis.surpluses.slice(0, 12)) {
    lines.push(`| ${item.name} | ${item.average.toFixed(1)} | Check whether this resource has enough useful sinks. |`);
  }

  lines.push(
    "",
    "## Time Losses",
    "",
    `Best strategy idle time: ${((best?.noProgressSeconds || 0) / 60).toFixed(1)} min`,
    `Best strategy construction time: ${((best?.constructionTime || 0) / 60).toFixed(1)} min`,
    `Best strategy research time: ${((best?.researchTime || 0) / 60).toFixed(1)} min`,
    `Best strategy mining trips: ${best?.miningTrips || 0}`,
    "",
    "## Final Generation",
    "",
    "| Strategy | Result | Simulated time | Decisions | Score |",
    "|---|---|---:|---:|---:|"
  );
  for (const result of finalResults.slice().sort((a, b) => resultFitness(b) - resultFitness(a))) {
    lines.push(
      `| ${result.name} | ${result.completed ? "completed" : result.failureReason} | ` +
      `${(result.simulatedSeconds / 3600).toFixed(2)} h | ${result.decisions.length} | ${result.score.toFixed(0)} |`
    );
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

async function main() {
  const config = loadMetaConfig();
  const data = getCreativeGameData();
  const runId = formatLocalTimestamp(new Date(), true);
  const runDir = path.join(BOT_DIR, "report", "meta", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const startedAt = Date.now();
  let genomes = Array.from({ length: config.strategies }, (_, index) => baseGenome(index));
  const allResults = [];
  let finalResults = [];

  console.log(
    `Meta-Suche: ${config.generations} Generationen mit je ${config.strategies} Strategien, ` +
    `Suchtiefe ${config.depth}.`
  );
  for (let generation = 0; generation < config.generations; generation++) {
    finalResults = [];
    for (const genome of genomes) {
      finalResults.push(runGame(data, genome, config));
    }
    allResults.push(...finalResults);
    const victories = finalResults.filter(result => result.completed);
    const best = victories.sort((a, b) => a.simulatedSeconds - b.simulatedSeconds)[0];
    console.log(
      `Generation ${generation + 1}: ${victories.length}/${finalResults.length} erfolgreich` +
      (best ? `, beste Zeit ${(best.simulatedSeconds / 3600).toFixed(2)} h` : "")
    );
    if (generation + 1 < config.generations) {
      genomes = nextGeneration(finalResults, config.strategies, generation + 1);
    }
  }

  const analysis = buildMetaAnalysis(allResults, data);
  const successful = allResults.filter(result => result.completed)
    .sort((a, b) => a.simulatedSeconds - b.simulatedSeconds);
  const best = successful[0] ||
    allResults.slice().sort((a, b) => resultFitness(b) - resultFitness(a))[0];
  const runtimeSeconds = (Date.now() - startedAt) / 1000;
  const metrics = {
    runId,
    mode: "meta",
    generatedAt: formatLocalTimestamp(),
    runtimeSeconds,
    config,
    totalStrategies: allResults.length,
    successfulStrategies: successful.length,
    bestStrategy: best,
    analysis,
    generations: Array.from({ length: config.generations }, (_, generation) => {
      const values = allResults.slice(
        generation * config.strategies,
        (generation + 1) * config.strategies
      );
      return {
        generation: generation + 1,
        successful: values.filter(result => result.completed).length,
        bestSeconds: values.filter(result => result.completed)
          .sort((a, b) => a.simulatedSeconds - b.simulatedSeconds)[0]?.simulatedSeconds || null
      };
    })
  };
  fs.writeFileSync(path.join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2), "utf8");
  fs.writeFileSync(
    path.join(runDir, "simulations.json"),
    JSON.stringify(allResults, null, 2),
    "utf8"
  );
  fs.writeFileSync(path.join(runDir, "meta-analysis.json"), JSON.stringify(analysis, null, 2), "utf8");
  fs.writeFileSync(path.join(runDir, "best-strategy.json"), JSON.stringify(best, null, 2), "utf8");
  writeReport(
    path.join(runDir, "meta-report.md"),
    runId,
    config,
    allResults,
    finalResults,
    analysis,
    runtimeSeconds
  );
  console.log(`Meta-Report erstellt: ${path.join(runDir, "meta-report.md")}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
