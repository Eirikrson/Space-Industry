const fs = require("fs");
const path = require("path");

const BOT_DIR = __dirname;
const ROOT = path.resolve(BOT_DIR, "..", "..");
const CONFIG_PATH = path.join(BOT_DIR, "balance-bot-configuration.json");

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  config.creativeStrategies = Math.max(100, Math.floor(Number(config.creativeStrategies) || 120));
  config.creativeMaxHours = Math.max(1, Number(config.creativeMaxHours) || 72);
  return config;
}

function formatLocalTimestamp(date = new Date(), fileNameSafe = false) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60));
  const minutes = pad(Math.abs(offsetMinutes) % 60);
  const separator = fileNameSafe ? "-" : ":";
  const value = [
    date.getFullYear(), "-", pad(date.getMonth() + 1), "-", pad(date.getDate()), "T",
    pad(date.getHours()), separator, pad(date.getMinutes()), separator,
    pad(date.getSeconds()), fileNameSafe ? "-" : ".", pad(date.getMilliseconds(), 3)
  ].join("");
  return `${value}${sign}${hours}${separator}${minutes}`;
}

const config = loadConfig();
const runId = formatLocalTimestamp(new Date(), true);
const reportRoot = path.join(BOT_DIR, "report", "creative");
const startedAt = Date.now();
let worldNumber = null;
let runDir = null;
let savePath = null;
let metricsPath = null;
let reportPath = null;
let statusPath = null;

const metrics = {
  runId,
  worldNumber: null,
  mode: "creative",
  skill: null,
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

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function getCreativeGameData() {
  return {
    buildings: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "buildings.json"), "utf8")),
    resources: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "resources.json"), "utf8"))
  };
}

function createCreativeStrategies(count) {
  const archetypes = [
    { name: "Energy First", energy: 1.8, mining: 0.9, research: 1.0, expansion: 1.1, thrift: 0.8 },
    { name: "Mining First", energy: 0.9, mining: 1.9, research: 1.0, expansion: 1.2, thrift: 0.8 },
    { name: "Research First", energy: 1.0, mining: 1.0, research: 1.9, expansion: 0.9, thrift: 0.8 },
    { name: "Balanced", energy: 1.2, mining: 1.2, research: 1.2, expansion: 1.0, thrift: 1.0 },
    { name: "Maximum Expansion", energy: 1.3, mining: 1.5, research: 1.0, expansion: 2.0, thrift: 0.5 },
    { name: "Minimum Expansion", energy: 1.0, mining: 1.0, research: 1.2, expansion: 0.45, thrift: 2.0 }
  ];
  const strategies = [];
  for (let index = 0; index < count; index++) {
    const base = archetypes[index % archetypes.length];
    const random = createSeededRandom(0x51ace000 + index * 7919);
    const vary = value => Math.max(0.25, value * (0.78 + random() * 0.44));
    strategies.push({
      id: index + 1,
      name: `${base.name} ${String(index + 1).padStart(3, "0")}`,
      archetype: base.name,
      energy: vary(base.energy),
      mining: vary(base.mining),
      research: vary(base.research),
      expansion: vary(base.expansion),
      thrift: vary(base.thrift),
      seed: 0x51ace000 + index * 7919
    });
  }
  return strategies;
}

function createCreativeState(data, strategy) {
  const resources = JSON.parse(JSON.stringify(data.resources.INITIAL_RESOURCES));
  const buildings = { Computer: 1 };
  for (const module of data.resources.STARTER_SHIP_MODULES) {
    buildings[module.type] = (buildings[module.type] || 0) + 1;
  }
  resources.energyCap = 0;
  resources.itemCap = 0;
  resources.crewCap = 0;
  resources.waterCap = 0;
  resources.fuelCap = 0;
  for (const module of data.resources.STARTER_SHIP_MODULES) {
    const stats = data.buildings.BUILDING_STATS[module.type] || {};
    resources.energyCap += stats.energyCap || 0;
    resources.itemCap += stats.itemCap || 0;
    resources.crewCap += stats.crewCap || 0;
    if (module.tankContent && module.tankCap) {
      resources[`${module.tankContent}Cap`] =
        (resources[`${module.tankContent}Cap`] || 0) + module.tankCap;
    }
  }
  resources.itemCap += data.buildings.BUILDING_STATS.Computer.itemCap || 0;
  resources.energy = Math.min(resources.energyCap, resources.energy);

  return {
    strategy,
    time: 0,
    resources,
    buildings,
    research: new Set(data.buildings.BASE_UNLOCKED_BUILDINGS),
    produced: {},
    consumed: {},
    overflow: {},
    shortages: {},
    idlePeriods: [],
    milestones: {},
    buildLog: [],
    researchLog: [],
    events: [],
    miningTrips: 0,
    researchTime: 0,
    constructionTime: 0,
    defenseAmmoDebt: {
      ammo: 0,
      cannonBalls: 0,
      railgunRods: 0,
      rocketAmmunition: 0
    },
    defenseEnergyDebt: 0,
    repairDebt: 0,
    drones: 0,
    maintenanceActive: false,
    storageExpansionActive: false,
    autoDisposeLimits: {},
    disposed: {},
    lifeSupportOutageSeconds: 0,
    noProgressTime: 0,
    failed: false,
    failureReason: "",
    completed: false
  };
}

function creativeRecord(map, key, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return;
  map[key] = (map[key] || 0) + amount;
}

function creativeSolidUsed(state, data) {
  return data.resources.SOLID_RESOURCES.reduce(
    (sum, key) => sum + Math.max(0, state.resources[key] || 0),
    0
  );
}

function creativeStoreSolid(state, data, key, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const limit = state.autoDisposeLimits[key];
  const allowedByLimit = Number.isFinite(limit)
    ? Math.max(0, limit - (state.resources[key] || 0))
    : amount;
  const storageFree = Math.max(
    0,
    (state.resources.itemCap || 0) - creativeSolidUsed(state, data)
  );
  const accepted = Math.max(0, Math.min(amount, allowedByLimit, storageFree));
  if (accepted > 0) {
    state.resources[key] = (state.resources[key] || 0) + accepted;
    creativeRecord(state.produced, key, accepted);
  }
  creativeRecord(state.disposed, key, amount - accepted);
  return accepted;
}

function creativeConfigureAutoDispose(state) {
  state.autoDisposeLimits = {
    ironOre: 250,
    copperOre: 180,
    siliconOre: 140,
    nickel: 180,
    carbon: 140,
    uranium: 80,
    deuterium: 80,
    tritium: 40
  };
}

function creativePower(state, data) {
  const stats = data.buildings.BUILDING_STATS;
  const count = name => state.buildings[name] || 0;
  const generation =
    count("Solar Panel") * (stats["Solar Panel"]?.energyProdBase || 0) +
    count("Turbine") * (stats.Turbine?.energyProd || 0) +
    count("Condenser Turbine") * (stats["Condenser Turbine"]?.energyProd || 0);
  const baseUse =
    count("Life Support") * (stats["Life Support"]?.energyUse || 0) +
    count("Farm Module") * (stats["Farm Module"]?.energyUse || 0) +
    count("Asteroid Collector") * (stats["Asteroid Collector"]?.energyUse || 0);
  return { generation, baseUse, net: generation - baseUse };
}

function creativeAdvance(state, seconds, data, reason, activeEnergyUse = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const start = state.time;
  const power = creativePower(state, data);
  const net = power.net - activeEnergyUse;
  const energyDelta = net * seconds;
  if (energyDelta >= 0) {
    const accepted = Math.min(
      energyDelta,
      Math.max(0, (state.resources.energyCap || 0) - (state.resources.energy || 0))
    );
    state.resources.energy += accepted;
    creativeRecord(state.overflow, "energy", energyDelta - accepted);
  } else {
    const needed = -energyDelta;
    if ((state.resources.energy || 0) < needed) {
      const missing = needed - (state.resources.energy || 0);
      const recoveryRate = Math.max(0.1, power.net);
      const wait = power.net > 0 ? missing / recoveryRate : seconds;
      state.noProgressTime += wait;
      state.idlePeriods.push({ start, seconds: wait, reason: "insufficient energy" });
      state.resources.energy = 0;
    } else {
      state.resources.energy -= needed;
    }
    creativeRecord(state.consumed, "energy", needed);
  }

  const crewFood = (state.resources.crew || 0) * 0.025 * seconds;
  const lifeSupportWater =
    (state.buildings["Life Support"] || 0) *
    (data.buildings.BUILDING_STATS["Life Support"]?.waterUse || 0) *
    seconds;
  const foodUsed = Math.min(state.resources.food || 0, crewFood);
  const waterUsed = Math.min(state.resources.water || 0, lifeSupportWater);
  state.resources.food = Math.max(0, (state.resources.food || 0) - foodUsed);
  state.resources.water = Math.max(0, (state.resources.water || 0) - waterUsed);
  creativeRecord(state.consumed, "food", foodUsed);
  creativeRecord(state.consumed, "water", waterUsed);
  if (lifeSupportWater > waterUsed && lifeSupportWater > 0) {
    const supportedFraction = waterUsed / lifeSupportWater;
    const outage = seconds * (1 - supportedFraction);
    state.lifeSupportOutageSeconds += outage;
    state.noProgressTime += outage;
    state.idlePeriods.push({ start, seconds: outage, reason: "life support without water" });
    creativeRecord(state.shortages, "water", lifeSupportWater - waterUsed);
    if (state.lifeSupportOutageSeconds >= 120) {
      state.failed = true;
      state.failureReason = "life support failed from water shortage";
    }
  } else if (waterUsed > 0) {
    state.lifeSupportOutageSeconds = Math.max(0, state.lifeSupportOutageSeconds - seconds * 0.5);
  }

  const collectors = state.buildings["Asteroid Collector"] || 0;
  if (collectors > 0) {
    const cycles = seconds * collectors / 15;
    const pool = data.resources.COLLECTOR_SOLID_POOL;
    for (const key of new Set(pool)) {
      const share = pool.filter(item => item === key).length / pool.length;
      const amount = cycles * share;
      creativeStoreSolid(state, data, key, amount);
    }
  }

  const farmCount = state.buildings["Farm Module"] || 0;
  if (farmCount > 0 && state.resources.water > 0) {
    const stats = data.buildings.BUILDING_STATS["Farm Module"];
    const foodTarget = Math.max(40, (state.resources.crew || 1) * 30);
    const potential = Math.min(
      farmCount * stats.foodProd * seconds,
      state.resources.water / Math.max(0.001, stats.waterUse),
      Math.max(0, foodTarget - (state.resources.food || 0))
    );
    const produced = creativeStoreSolid(state, data, "food", potential);
    const waterUse = produced * stats.waterUse / Math.max(0.001, stats.foodProd);
    state.resources.water -= waterUse;
    creativeRecord(state.consumed, "water", waterUse);
  }

  const defenseLoads = [
    ["Gun Turret", "ammo", 45, 1],
    ["Cannon Turret", "cannonBalls", 75, 1],
    ["Railgun Turret", "railgunRods", 120, 0.2],
    ["Missile Turret", "rocketAmmunition", 150, 1]
  ];
  let defenseCount = 0;
  for (const [turret, ammunition, encounterSeconds, amount] of defenseLoads) {
    const count = state.buildings[turret] || 0;
    if (count <= 0) continue;
    defenseCount += count;
    state.defenseAmmoDebt[ammunition] += seconds * count * amount / encounterSeconds;
  }
  const laserCount = state.buildings["Laser Turret"] || 0;
  if (laserCount > 0) {
    const laser = data.buildings.BUILDING_STATS["Laser Turret"];
    defenseCount += laserCount;
    state.defenseEnergyDebt +=
      seconds * laserCount * laser.energyUse * laser.beamDuration / 90;
  }
  if (defenseCount > 0) {
    state.repairDebt += seconds * defenseCount / 1200;
  }

  if (state.drones > 0) {
    const droneYield = seconds * state.drones * 0.08;
    const droneResources = {
      ironOre: droneYield * 0.42,
      copperOre: droneYield * 0.25,
      nickel: droneYield * 0.18,
      carbon: droneYield * 0.15
    };
    for (const [key, amount] of Object.entries(droneResources)) {
      creativeStoreSolid(state, data, key, amount);
    }
  }

  state.time += seconds;
  if (creativeSolidUsed(state, data) > (state.resources.itemCap || 0)) {
    creativeRecord(
      state.overflow,
      "solidStoragePressureSeconds",
      seconds
    );
  }
  state.events.push({ at: state.time, type: "advance", reason, seconds });
  if (state.events.length > 600) state.events.shift();
}

function creativeConsumeCost(state, cost) {
  for (const [key, amount] of Object.entries(cost || {})) {
    state.resources[key] = Math.max(0, (state.resources[key] || 0) - amount);
    creativeRecord(state.consumed, key, amount);
  }
}

function creativeMineBatch(state, data, allowFuelRecovery = true) {
  const drills = Math.max(1, state.buildings.Drill || 0);
  const yieldScale =
    (0.8 + state.strategy.mining * 0.35 + Math.log2(drills + 1) * 0.3) *
    Math.sqrt(drills);
  const storageFree = Math.max(0, (state.resources.itemCap || 0) - creativeSolidUsed(state, data));
  if (storageFree <= 0) {
    if (state.storageExpansionActive) return false;
    const warehouse = state.research.has("Warehouse MK2")
      ? "Warehouse MK2"
      : "Warehouse MK1";
    state.storageExpansionActive = true;
    try {
      if (!creativeBuild(state, data, warehouse)) return false;
    } finally {
      state.storageExpansionActive = false;
    }
  }
  const travelSeconds = Math.max(14, 65 / state.strategy.mining / Math.sqrt(drills));
  const calculatedFuelUse = Math.max(
    0.75,
    travelSeconds * 0.035 / Math.max(0.7, state.strategy.thrift)
  );
  const hasFuelChain =
    state.buildings.Electrolyser > 0 &&
    state.buildings["Fuel Processor"] > 0;
  const fuelUse = hasFuelChain
    ? calculatedFuelUse
    : Math.min(1.5, calculatedFuelUse);
  const fuelReserve = allowFuelRecovery &&
    state.buildings.Electrolyser > 0 &&
    state.buildings["Fuel Processor"] > 0
    ? 45
    : 0;
  if ((state.resources.fuel || 0) < fuelUse + fuelReserve) {
    if (
      !allowFuelRecovery ||
      !creativeProduceFuel(
        state,
        data,
        fuelUse + fuelReserve - (state.resources.fuel || 0)
      )
    ) {
      creativeRecord(state.shortages, "fuel", fuelUse - (state.resources.fuel || 0));
      return false;
    }
  }
  state.resources.fuel = Math.max(0, (state.resources.fuel || 0) - fuelUse);
  creativeRecord(state.consumed, "fuel", fuelUse);
  creativeAdvance(state, travelSeconds + 3.5 / drills, data, "asteroid mining", drills * 3);
  for (const def of data.resources.ASTEROID_RESOURCE_TABLE) {
    const average = (def.min + def.max) / 2;
    const amount = average * yieldScale;
    if (data.resources.SOLID_RESOURCES.includes(def.key)) {
      creativeStoreSolid(state, data, def.key, amount);
    } else {
      state.resources[def.key] = (state.resources[def.key] || 0) + amount;
      creativeRecord(state.produced, def.key, amount);
    }
  }
  state.miningTrips++;
  return true;
}

function creativeProduceFuel(state, data, amount) {
  if (amount <= 0) return true;
  if (!(state.buildings.Electrolyser > 0 && state.buildings["Fuel Processor"] > 0)) {
    return false;
  }
  const fuelStats = data.buildings.BUILDING_STATS["Fuel Processor"];
  const electro = data.buildings.BUILDING_STATS.Electrolyser;
  const waterPerFuel = (
    Math.max(
      fuelStats.hydrogenUse / fuelStats.fuelProd / electro.hydrogenProd,
      fuelStats.oxygenUse / fuelStats.fuelProd / electro.oxygenProd
    ) * electro.waterUse
  );
  let remaining = amount;
  let guard = 0;
  while (remaining > 0.001 && guard++ < 500) {
    const availableFuel = Math.min(
      remaining,
      (state.resources.water || 0) / Math.max(0.001, waterPerFuel)
    );
    if (availableFuel <= 0.001) {
      if (!(state.buildings.Drill > 0) || !creativeMineBatch(state, data, false)) {
        return false;
      }
      continue;
    }
    const seconds = availableFuel / fuelStats.fuelProd;
    const hydrogen = seconds * fuelStats.hydrogenUse;
    const oxygen = seconds * fuelStats.oxygenUse;
    const electroSeconds = Math.max(
      hydrogen / electro.hydrogenProd,
      oxygen / electro.oxygenProd
    );
    const water = electroSeconds * electro.waterUse;
    state.resources.water -= water;
    state.resources.fuel = (state.resources.fuel || 0) + availableFuel;
    creativeRecord(state.consumed, "water", water);
    creativeRecord(state.produced, "hydrogen", hydrogen);
    creativeRecord(state.produced, "oxygen", oxygen);
    creativeRecord(state.consumed, "hydrogen", hydrogen);
    creativeRecord(state.consumed, "oxygen", oxygen);
    creativeRecord(state.produced, "fuel", availableFuel);
    creativeAdvance(
      state,
      electroSeconds + seconds,
      data,
      "fuel production",
      electro.energyUse + fuelStats.energyUse
    );
    remaining -= availableFuel;
  }
  if (remaining > 0.001) return false;
  return true;
}

function creativeEnsureResource(state, data, key, amount, depth = 0) {
  if ((state.resources[key] || 0) >= amount) return true;
  if (depth > 12 || state.failed) return false;
  const missing = amount - (state.resources[key] || 0);
  const rawResources = new Set([
    "ironOre", "copperOre", "siliconOre", "nickel", "carbon",
    "uranium", "water", "deuterium", "tritium"
  ]);
  if (rawResources.has(key)) {
    if (!(state.buildings.Drill > 0)) {
      creativeRecord(state.shortages, key, missing);
      return false;
    }
    let guard = 0;
    while ((state.resources[key] || 0) < amount && guard++ < 500) {
      if (!creativeMineBatch(state, data)) return false;
    }
    return (state.resources[key] || 0) >= amount;
  }
  if (key === "fuel") return creativeProduceFuel(state, data, missing);

  const smelterInputs = {
    ironPlate: "ironOre",
    copperPlate: "copperOre",
    silicon: "siliconOre"
  };
  if (smelterInputs[key]) {
    if (!(state.buildings.Smelter > 0)) return false;
    const input = smelterInputs[key];
    if (!creativeEnsureResource(state, data, input, missing, depth + 1)) return false;
    state.resources[input] -= missing;
    creativeRecord(state.consumed, input, missing);
    const produced = creativeStoreSolid(state, data, key, missing);
    creativeAdvance(
      state,
      missing / Math.max(1, state.buildings.Smelter || 1),
      data,
      `smelt ${key}`,
      data.buildings.BUILDING_STATS.Smelter.energyUse
    );
    return produced + 0.000001 >= missing;
  }

  const recipe = data.buildings.BUILDING_STATS.Assembler?.recipes?.[key];
  if (recipe) {
    if (!(state.buildings.Assembler > 0)) return false;
    const output = Math.max(1, recipe.outputs?.[key] || 1);
    const batches = Math.ceil(missing / output);
    for (const [input, perBatch] of Object.entries(recipe.inputs || {})) {
      if (!creativeEnsureResource(state, data, input, perBatch * batches, depth + 1)) return false;
    }
    for (const [input, perBatch] of Object.entries(recipe.inputs || {})) {
      const used = perBatch * batches;
      state.resources[input] -= used;
      creativeRecord(state.consumed, input, used);
    }
    const made = output * batches;
    const produced = creativeStoreSolid(state, data, key, made);
    creativeAdvance(
      state,
      batches / Math.max(1, state.buildings.Assembler || 1),
      data,
      `assemble ${key}`,
      data.buildings.BUILDING_STATS.Assembler.energyUse
    );
    return produced + 0.000001 >= missing;
  }
  creativeRecord(state.shortages, key, missing);
  return false;
}

function creativeEnsureCost(state, data, cost) {
  for (const [key, amount] of Object.entries(cost || {})) {
    if (!creativeEnsureResource(state, data, key, amount)) return false;
  }
  return true;
}

function creativeRecalculateCaps(state, data) {
  const stats = data.buildings.BUILDING_STATS;
  state.resources.energyCap = 0;
  state.resources.itemCap = 0;
  state.resources.crewCap = 0;
  for (const [name, count] of Object.entries(state.buildings)) {
    state.resources.energyCap += (stats[name]?.energyCap || 0) * count;
    state.resources.itemCap += (stats[name]?.itemCap || 0) * count;
    state.resources.crewCap += (stats[name]?.crewCap || 0) * count;
  }
}

function creativeBuild(state, data, name, count = 1) {
  const cost = data.buildings.BUILD_COSTS[name];
  if (!cost) return false;
  for (let index = 0; index < count; index++) {
    if (!creativeMaintainOperations(state, data)) return false;
    if (
      !state.storageExpansionActive &&
      name !== "Warehouse MK1" &&
      name !== "Warehouse MK2" &&
      creativeSolidUsed(state, data) > (state.resources.itemCap || 0) * 0.75
    ) {
      const warehouse = state.research.has("Warehouse MK2")
        ? "Warehouse MK2"
        : "Warehouse MK1";
      state.storageExpansionActive = true;
      try {
        if (!creativeBuild(state, data, warehouse)) return false;
      } finally {
        state.storageExpansionActive = false;
      }
    }
    const gatheringStarted = state.time;
    if (!creativeEnsureCost(state, data, cost)) return false;
    const gatheringSeconds = state.time - gatheringStarted;
    creativeConsumeCost(state, cost);
    const duration = Math.max(1.5, 8 / state.strategy.expansion);
    creativeAdvance(state, duration, data, `build ${name}`);
    state.constructionTime += duration;
    state.buildings[name] = (state.buildings[name] || 0) + 1;
    creativeRecalculateCaps(state, data);
    state.buildLog.push({
      name,
      at: state.time,
      gatheringSeconds,
      constructionSeconds: duration
    });
    if (!state.milestones[`build:${name}`]) state.milestones[`build:${name}`] = state.time;
  }
  return true;
}

function creativeMaintainOperations(state, data) {
  if (state.maintenanceActive) return true;
  state.maintenanceActive = true;
  try {
    const canProduceFuel =
      (state.buildings.Electrolyser || 0) > 0 &&
      (state.buildings["Fuel Processor"] || 0) > 0;
    const strategicWaterReserve = canProduceFuel ? 40 : 8;
    if (
      (state.buildings.Drill || 0) > 0 &&
      (state.buildings.Smelter || 0) > 0 &&
      (state.resources.water || 0) < strategicWaterReserve
    ) {
      if (!creativeEnsureResource(state, data, "water", strategicWaterReserve)) return false;
    }

    const strategicFuelReserve = 45;
    if (canProduceFuel && (state.resources.fuel || 0) < strategicFuelReserve) {
      if (!creativeProduceFuel(
        state,
        data,
        strategicFuelReserve - (state.resources.fuel || 0)
      )) return false;
    }

    for (const [ammunition, debt] of Object.entries(state.defenseAmmoDebt)) {
      const ammoNeeded = Math.ceil(debt);
      if (ammoNeeded <= 0) continue;
      if (!creativeEnsureResource(state, data, ammunition, ammoNeeded)) return false;
      state.resources[ammunition] -= ammoNeeded;
      creativeRecord(state.consumed, ammunition, ammoNeeded);
      state.defenseAmmoDebt[ammunition] = Math.max(0, debt - ammoNeeded);
    }

    const defenseEnergy = Math.ceil(state.defenseEnergyDebt);
    if (defenseEnergy > 0) {
      if ((state.resources.energy || 0) < defenseEnergy) {
        const net = creativePower(state, data).net;
        if (net <= 0) return false;
        creativeAdvance(
          state,
          (defenseEnergy - (state.resources.energy || 0)) / net,
          data,
          "charge laser defenses"
        );
      }
      state.resources.energy = Math.max(0, (state.resources.energy || 0) - defenseEnergy);
      creativeRecord(state.consumed, "energy", defenseEnergy);
      state.defenseEnergyDebt = Math.max(0, state.defenseEnergyDebt - defenseEnergy);
    }

    const repairChunks = Math.floor(state.repairDebt);
    if (repairChunks > 0) {
      const repairCost = {
        gears: repairChunks,
        circuits: repairChunks,
        cables: repairChunks
      };
      if (!creativeEnsureCost(state, data, repairCost)) return false;
      creativeConsumeCost(state, repairCost);
      state.repairDebt -= repairChunks;
      creativeAdvance(state, repairChunks * 2, data, "ship repairs");
    }
    return true;
  } finally {
    state.maintenanceActive = false;
  }
}

function creativeBuildMiningDrone(state, data) {
  const droneCost = {
    ironPlate: 18,
    copperPlate: 10,
    gears: 4,
    circuits: 3,
    cables: 3
  };
  if (!creativeEnsureCost(state, data, droneCost)) return false;
  creativeConsumeCost(state, droneCost);
  creativeAdvance(state, 30, data, "build mining drone");
  state.drones++;
  if (!state.milestones.firstMiningDrone) {
    state.milestones.firstMiningDrone = state.time;
  }
  return true;
}

function creativeResearch(state, data, item, tierIndex) {
  if (state.research.has(item.name)) return true;
  const computerLevel =
    state.research.has("Computer MK4") ? 4 :
      state.research.has("Computer MK3") ? 3 :
        state.research.has("Computer MK2") ? 2 : 1;
  if (computerLevel < tierIndex + 1) return false;
  if (!creativeMaintainOperations(state, data)) return false;
  const gatheringStarted = state.time;
  if (!creativeEnsureCost(state, data, item.cost)) return false;
  const gatheringSeconds = state.time - gatheringStarted;
  creativeConsumeCost(state, item.cost);
  const materialTotal = Object.values(item.cost || {}).reduce((sum, value) => sum + value, 0);
  const duration = Math.max(2, materialTotal * 0.12 / state.strategy.research);
  creativeAdvance(
    state,
    duration,
    data,
    `research ${item.name}`,
    data.buildings.BUILDING_STATS.Laboratory.energyUse
  );
  state.researchTime += duration;
  state.research.add(item.name);
  state.researchLog.push({
    name: item.name,
    at: state.time,
    tier: tierIndex + 1,
    gatheringSeconds,
    researchSeconds: duration
  });
  state.milestones[`research:${item.name}`] = state.time;
  return true;
}

function creativeResearchScore(item, strategy) {
  const name = item.name;
  let score = 0;
  if (name === "Assembler") score += 1000;
  if (name === "Warehouse MK2") score += 950;
  if (name === "Fuel Processor" || name === "Electrolyser") score += 450;
  if (/Computer/.test(name)) score += strategy.research * 100;
  if (/Drill|Scooper|Collector/.test(name)) score += strategy.mining * 70;
  if (/Battery|Reactor|Turbine|Fuel|Electrolyser/.test(name)) score += strategy.energy * 65;
  if (/Warehouse|Tank|Hangar/.test(name)) score += strategy.expansion * 35;
  if (/Quantum|Stabilizer|Event Horizon/.test(name)) score += 120;
  const cost = Object.values(item.cost || {}).reduce((sum, value) => sum + value, 0);
  score -= cost * strategy.thrift * 0.02;
  return score;
}

function creativeBuildUsefulUnlock(state, data, name) {
  if (!data.buildings.BUILD_COSTS[name]) return true;
  if ((state.buildings[name] || 0) > 0) return true;
  return creativeBuild(state, data, name);
}

function creativeRunStrategy(data, strategy, maximumSeconds) {
  const state = createCreativeState(data, strategy);
  creativeConfigureAutoDispose(state);
  const fail = reason => {
    state.failed = true;
    state.failureReason = reason;
    return state;
  };

  if (!creativeBuild(state, data, "Laboratory")) return fail("cannot build Laboratory");
  const tierOne = data.buildings.RESEARCH_TIERS[0].items;
  const drillResearch = tierOne.find(item => item.name === "Drill");
  const smelterResearch = tierOne.find(item => item.name === "Smelter");
  if (!creativeResearch(state, data, drillResearch, 0)) return fail("cannot research Drill");
  if (!creativeBuild(state, data, "Drill")) return fail("cannot build Drill");
  if (!creativeResearch(state, data, smelterResearch, 0)) return fail("cannot research Smelter");
  if (!creativeBuild(state, data, "Smelter")) return fail("cannot build Smelter");
  const desiredDrills = Math.max(1, Math.min(4, Math.round(1 + strategy.mining * 1.5)));
  if (desiredDrills > 1 && !creativeBuild(state, data, "Drill", desiredDrills - 1)) {
    creativeRecord(state.shortages, "optional:earlyDrills", desiredDrills - 1);
  }

  for (let tierIndex = 0; tierIndex < data.buildings.RESEARCH_TIERS.length; tierIndex++) {
    const tier = data.buildings.RESEARCH_TIERS[tierIndex];
    const pending = tier.items
      .filter(item => !state.research.has(item.name))
      .sort((a, b) => creativeResearchScore(b, strategy) - creativeResearchScore(a, strategy));
    for (const item of pending) {
      if (state.time > maximumSeconds) return fail("simulation time limit");
      if (!creativeResearch(state, data, item, tierIndex)) {
        const computerUpgrade = tierIndex === 1 ? "Computer MK2" :
          tierIndex === 2 ? "Computer MK3" :
            tierIndex === 3 ? "Computer MK4" : null;
        if (computerUpgrade && !state.research.has(computerUpgrade)) {
          const priorTier = data.buildings.RESEARCH_TIERS[tierIndex - 1];
          const upgrade = priorTier.items.find(candidate => candidate.name === computerUpgrade);
          if (upgrade && !creativeResearch(state, data, upgrade, tierIndex - 1)) {
            return fail(`cannot unlock tier ${tierIndex + 1}`);
          }
        }
        if (!creativeResearch(state, data, item, tierIndex)) {
          return fail(`cannot research ${item.name}`);
        }
      }
      if (!creativeBuildUsefulUnlock(state, data, item.name)) {
        creativeRecord(state.shortages, `build:${item.name}`, 1);
      }
      if (item.name === "Gun Turret" && !(state.buildings["Gun Turret"] > 0)) {
        if (!creativeBuild(state, data, "Gun Turret")) {
          return fail("cannot build first Gun Turret");
        }
      }
      if (/^Hangar MK/.test(item.name) && !creativeBuildMiningDrone(state, data)) {
        return fail("cannot build first mining drone");
      }
    }
  }

  const endBuilds = [
    ["Assembler", 1],
    ["Electrolyser", 1],
    ["Fuel Processor", 1],
    ["Fusion Reactor", 1],
    ["Quantum Computer", 1],
    ["Gravitational Pull Stabilizer", 1],
    ["Event Horizon Shield", 4]
  ];
  for (const [name, count] of endBuilds) {
    const missing = Math.max(0, count - (state.buildings[name] || 0));
    if (missing > 0 && !creativeBuild(state, data, name, missing)) {
      return fail(`cannot build endgame requirement ${name}`);
    }
  }
  while ((state.resources.energyCap || 0) < 45000) {
    if (!creativeBuild(state, data, "Battery MK2")) {
      return fail("cannot reach 45000 energy storage");
    }
  }
  const power = creativePower(state, data);
  if (power.net <= 0) {
    while (creativePower(state, data).net <= 5) {
      if (!creativeBuild(state, data, "Solar Panel")) return fail("cannot restore positive energy");
    }
  }
  const chargeRate = Math.max(0.1, creativePower(state, data).net);
  const chargeTime = Math.max(0, 45000 - (state.resources.energy || 0)) / chargeRate;
  const chargeWater =
    chargeTime *
    (state.buildings["Life Support"] || 0) *
    (data.buildings.BUILDING_STATS["Life Support"]?.waterUse || 0);
  if (!creativeEnsureResource(state, data, "water", chargeWater + 20)) {
    return fail("cannot secure life-support water for black-hole charge");
  }
  creativeAdvance(state, chargeTime, data, "charge for black hole");
  state.resources.energy = Math.min(state.resources.energyCap, Math.max(45000, state.resources.energy));
  state.completed = true;
  state.milestones.endGoal = state.time;
  return state;
}

function creativeTotal(map) {
  return Object.entries(map || {})
    .filter(([key]) => key !== "energy")
    .reduce((sum, [, value]) => sum + Math.max(0, Number(value) || 0), 0);
}

function creativeSummarize(state, data) {
  const surplus = {};
  for (const [key, amount] of Object.entries(state.resources)) {
    if (amount > 0 && !key.endsWith("Cap") && !["energyNet", "itemUsed", "crew"].includes(key)) {
      surplus[key] = amount;
    }
  }
  return {
    id: state.strategy.id,
    name: state.strategy.name,
    archetype: state.strategy.archetype,
    completed: state.completed,
    failureReason: state.failureReason,
    simulatedSeconds: state.time,
    simulatedHours: state.time / 3600,
    buildings: state.buildings,
    research: Array.from(state.research),
    buildLog: state.buildLog,
    researchLog: state.researchLog,
    produced: state.produced,
    consumed: state.consumed,
    shortages: state.shortages,
    overflow: state.overflow,
    disposed: state.disposed,
    surplus,
    idlePeriods: state.idlePeriods,
    noProgressSeconds: state.noProgressTime,
    miningTrips: state.miningTrips,
    researchTime: state.researchTime,
    constructionTime: state.constructionTime,
    drones: state.drones,
    milestones: state.milestones,
    totalProduced: creativeTotal(state.produced),
    totalConsumed: creativeTotal(state.consumed),
    storagePressureSeconds: state.overflow.solidStoragePressureSeconds || 0,
    finalSolidUsed: creativeSolidUsed(state, data),
    finalSolidCapacity: state.resources.itemCap || 0
  };
}

function creativeRank(results, selector) {
  return results
    .filter(result => result.completed)
    .slice()
    .sort((a, b) => selector(a) - selector(b));
}

function creativeGatheringTarget(name) {
  const exceptional = new Set([
    "Quantum Computer",
    "Event Horizon Shield",
    "Gravitational Pull Stabilizer"
  ]);
  if (exceptional.has(name)) return { seconds: 600, label: "10 min endgame" };
  if (/Turret|Computer MK4|Fusion Reactor|Shield Generator|Hangar MK3/.test(name)) {
    return { seconds: 300, label: "5 min special" };
  }
  return { seconds: 180, label: "3 min normal" };
}

function creativeRecommendations(results) {
  const completed = results.filter(result => result.completed);
  if (completed.length === 0) return ["No strategy reached the end goal. Review progression costs and raw-resource access."];
  const average = key => completed.reduce((sum, item) => sum + (item[key] || 0), 0) / completed.length;
  const recommendations = [];
  const storageAffected = completed.filter(item => item.storagePressureSeconds > 300).length;
  if (storageAffected > completed.length * 0.25) {
    recommendations.push("Storage is a frequent bottleneck. Consider earlier Warehouse unlocks or lower intermediate stock requirements.");
  }
  if (average("noProgressSeconds") > 120) {
    recommendations.push("Strategies spend substantial time without progress, mostly while waiting for energy. Review early power generation and battery costs.");
  }
  const commonShortages = {};
  for (const result of completed) {
    for (const [key, value] of Object.entries(result.shortages || {})) {
      commonShortages[key] = (commonShortages[key] || 0) + value;
    }
  }
  const top = Object.entries(commonShortages).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    recommendations.push(`Most persistent shortages: ${top.map(([key]) => key).join(", ")}.`);
  }
  const fastestType = creativeRank(completed, item => item.simulatedSeconds)[0]?.archetype;
  if (fastestType) recommendations.push(`${fastestType} produced the fastest successful runs in this comparison.`);
  return recommendations;
}

function writeCreativeReport(results, rankings, recommendations) {
  const completed = results.filter(result => result.completed);
  const best = rankings.fastest[0] || results[0];
  const formatDuration = seconds => `${(seconds / 3600).toFixed(2)} h`;
  const percentile = (values, ratio) => {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  };
  const lines = [
    "# Space Industry Creative Simulation Report",
    "",
    `Run: ${runId}`,
    `Strategies simulated: ${results.length}`,
    `Successful strategies: ${completed.length}`,
    `Wall-clock runtime: ${elapsedSeconds().toFixed(2)} s`,
    `Best estimated game time: ${best ? formatDuration(best.simulatedSeconds) : "-"}`,
    "",
    "## Ranking",
    "",
    `Fastest strategy: ${rankings.fastest[0]?.name || "none"}`,
    `Most efficient strategy: ${rankings.efficient[0]?.name || "none"}`,
    `Lowest resource consumption: ${rankings.lowConsumption[0]?.name || "none"}`,
    `Best research speed: ${rankings.research[0]?.name || "none"}`,
    "",
    "| Rank | Strategy | Type | Game time | Consumed | Produced | Research time | Idle time | Mining trips |",
    "|---:|---|---|---:|---:|---:|---:|---:|---:|"
  ];
  rankings.fastest.slice(0, 25).forEach((item, index) => {
    lines.push(
      `| ${index + 1} | ${item.name} | ${item.archetype} | ${formatDuration(item.simulatedSeconds)} | ` +
      `${item.totalConsumed.toFixed(1)} | ${item.totalProduced.toFixed(1)} | ` +
      `${(item.researchTime / 60).toFixed(1)} min | ${(item.noProgressSeconds / 60).toFixed(1)} min | ${item.miningTrips} |`
    );
  });
  lines.push(
    "",
    "## Best Strategy Details",
    "",
    `Total simulated game time: ${formatDuration(best.simulatedSeconds)}`,
    `Estimated time to end goal: ${formatDuration(best.simulatedSeconds)}`,
    `Buildings built: ${Object.entries(best.buildings).map(([name, count]) => `${name} x${count}`).join(", ")}`,
    `Technologies researched: ${best.research.join(", ")}`,
    "",
    "### Produced Resources",
    "",
    "| Resource | Amount |",
    "|---|---:|"
  );
  Object.entries(best.produced).sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => lines.push(`| ${key} | ${value.toFixed(2)} |`));
  lines.push("", "### Consumed Resources", "", "| Resource | Amount |", "|---|---:|");
  Object.entries(best.consumed).sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => lines.push(`| ${key} | ${value.toFixed(2)} |`));
  lines.push("", "### Largest Bottlenecks", "", "| Resource/Goal | Missing amount |", "|---|---:|");
  Object.entries(best.shortages).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([key, value]) => lines.push(`| ${key} | ${value.toFixed(2)} |`));
  lines.push("", "### Times Without Progress", "");
  if (best.idlePeriods.length === 0) lines.push("None recorded.");
  else best.idlePeriods.slice(0, 20).forEach(item =>
    lines.push(`- ${(item.start / 60).toFixed(1)} min: ${item.reason} for ${(item.seconds / 60).toFixed(1)} min`)
  );
  lines.push("", "### Resource Surpluses", "", "| Resource | Final amount |", "|---|---:|");
  Object.entries(best.surplus).sort((a, b) => b[1] - a[1]).slice(0, 25)
    .forEach(([key, value]) => lines.push(`| ${key} | ${Number(value).toFixed(2)} |`));
  lines.push(
    "",
    "### First Research And Building Times",
    "",
    "| Type | Name | Resource gathering | Action time | Total since start | Target |",
    "|---|---|---:|---:|---:|---|"
  );
  const firstResearch = new Map();
  for (const item of best.researchLog) {
    if (!firstResearch.has(item.name)) firstResearch.set(item.name, item);
  }
  const firstBuildings = new Map();
  for (const item of best.buildLog) {
    if (!firstBuildings.has(item.name)) firstBuildings.set(item.name, item);
  }
  for (const item of firstResearch.values()) {
    const gathering = item.gatheringSeconds || 0;
    const target = creativeGatheringTarget(item.name);
    lines.push(
      `| Research | ${item.name} | ${(gathering / 60).toFixed(1)} min | ` +
      `${((item.researchSeconds || 0) / 60).toFixed(1)} min | ${(item.at / 60).toFixed(1)} min | ` +
      `${gathering <= target.seconds ? `OK (${target.label})` : `OVER ${target.label.toUpperCase()}`} |`
    );
  }
  for (const item of firstBuildings.values()) {
    const gathering = item.gatheringSeconds || 0;
    const target = creativeGatheringTarget(item.name);
    lines.push(
      `| Building | ${item.name} | ${(gathering / 60).toFixed(1)} min | ` +
      `${((item.constructionSeconds || 0) / 60).toFixed(1)} min | ${(item.at / 60).toFixed(1)} min | ` +
      `${gathering <= target.seconds ? `OK (${target.label})` : `OVER ${target.label.toUpperCase()}`} |`
    );
  }
  lines.push(
    "",
    "### First-Time Balance Across Successful Strategies",
    "",
    "| Type | Name | Average gathering | 90% gathering | Runs | Target |",
    "|---|---|---:|---:|---:|---|"
  );
  const timingGroups = new Map();
  for (const result of completed) {
    for (const [type, log] of [["Research", result.researchLog], ["Building", result.buildLog]]) {
      const seen = new Set();
      for (const item of log) {
        const id = `${type}:${item.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!timingGroups.has(id)) timingGroups.set(id, { type, name: item.name, values: [] });
        timingGroups.get(id).values.push(item.gatheringSeconds || 0);
      }
    }
  }
  for (const group of timingGroups.values()) {
    const average = group.values.reduce((sum, value) => sum + value, 0) / group.values.length;
    const p90 = percentile(group.values, 0.9);
    const target = creativeGatheringTarget(group.name);
    lines.push(
      `| ${group.type} | ${group.name} | ${(average / 60).toFixed(1)} min | ` +
      `${(p90 / 60).toFixed(1)} min | ${group.values.length} | ` +
      `${average <= target.seconds ? `OK (${target.label})` : `OVER ${target.label.toUpperCase()}`} |`
    );
  }
  lines.push("", "## Optimization Suggestions", "");
  recommendations.forEach(item => lines.push(`- ${item}`));
  lines.push(
    "",
    "## All Strategies",
    "",
    "| Strategy | Result | Estimated game time | Consumption | Research time | Storage pressure |",
    "|---|---|---:|---:|---:|---:|"
  );
  results.forEach(item => lines.push(
    `| ${item.name} | ${item.completed ? "completed" : item.failureReason} | ` +
    `${formatDuration(item.simulatedSeconds)} | ${item.totalConsumed.toFixed(1)} | ` +
    `${(item.researchTime / 60).toFixed(1)} min | ${(item.storagePressureSeconds / 60).toFixed(1)} min |`
  ));
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
}

async function runCreativeSimulation() {
  fs.mkdirSync(reportRoot, { recursive: true });
  worldNumber = "creative";
  runDir = path.join(reportRoot, runId);
  savePath = path.join(runDir, "save.json");
  metricsPath = path.join(runDir, "metrics.json");
  reportPath = path.join(runDir, "report.md");
  statusPath = path.join(runDir, "status.json");
  fs.mkdirSync(runDir, { recursive: true });

  const data = getCreativeGameData();
  const strategies = createCreativeStrategies(config.creativeStrategies);
  const maximumSeconds = config.creativeMaxHours * 3600;
  const results = [];
  console.log(`Creative-Simulation: ${strategies.length} Strategien werden berechnet...`);
  for (const strategy of strategies) {
    results.push(creativeSummarize(
      creativeRunStrategy(data, strategy, maximumSeconds),
      data
    ));
  }
  const rankings = {
    fastest: creativeRank(results, item => item.simulatedSeconds),
    efficient: creativeRank(results, item =>
      item.simulatedSeconds * 0.45 + item.totalConsumed * 0.35 + item.noProgressSeconds * 0.2
    ),
    lowConsumption: creativeRank(results, item => item.totalConsumed),
    research: creativeRank(results, item => item.researchTime)
  };
  const recommendations = creativeRecommendations(results);
  const best = rankings.fastest[0] || results[0];
  metrics.result = best?.completed ? "success" : "failed";
  metrics.resultReason = best?.completed ? "creative-simulation-complete" : "no-strategy-completed";
  metrics.finishedAt = nowIso();
  metrics.durationSeconds = Number(elapsedSeconds().toFixed(3));
  metrics.creative = {
    strategyCount: strategies.length,
    successfulStrategies: results.filter(item => item.completed).length,
    rankings: {
      fastest: rankings.fastest.slice(0, 10).map(item => item.name),
      efficient: rankings.efficient.slice(0, 10).map(item => item.name),
      lowConsumption: rankings.lowConsumption.slice(0, 10).map(item => item.name),
      research: rankings.research.slice(0, 10).map(item => item.name)
    },
    recommendations,
    results
  };
  writeJson(metricsPath, metrics);
  writeJson(savePath, {
    type: "creative-simulation",
    generatedAt: nowIso(),
    bestStrategy: best,
    note: "This is a simulation snapshot, not a playable browser savegame."
  });
  writeJson(statusPath, {
    runId,
    mode: "creative",
    status: "finished",
    result: metrics.result,
    strategies: strategies.length,
    successfulStrategies: metrics.creative.successfulStrategies,
    fastestStrategy: rankings.fastest[0]?.name || null,
    estimatedGameSeconds: rankings.fastest[0]?.simulatedSeconds || null,
    updatedAt: nowIso()
  });
  writeCreativeReport(results, rankings, recommendations);
  console.log(`Creative-Auswertung erstellt: ${reportPath}`);
  console.log(`Simulationsdaten: ${runDir}`);
}


runCreativeSimulation().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
