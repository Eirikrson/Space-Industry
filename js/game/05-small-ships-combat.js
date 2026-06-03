function createSmallShipForHangar(hangar) {
  const smallShip = {
    id: nextSmallShipId++,
    hangarId: hangar.id,
    hangarType: hangar.type,
    name: makeUniqueShipName(),
    capacityTiles: getHangarCapacity(hangar.type),
    modules: [{ id: nextModuleId++, x: 0, y: 0, type: "Computer", w: 1, h: 1, rot: 0 }],
    modeMining: false,
    modeBattle: false,
    modeGas: false,
    modeSolarWind: false,
    status: "hangar",
    builtAt: performance.now(),
    x: ship.x,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: 0,
    targetAsteroid: null,
    targetPlanet: null,
    targetStar: null,
    cargo: {},
    cargoLimits: {},
    liquids: {},
    liquidLimits: {},
    fuel: 0,
    energy: 0,
    mineTimer: 0,
    transferDoneAt: 0,
    lastTransferAt: 0
  };

  smallShips.push(smallShip);
  hangar.smallShipId = smallShip.id;
  return smallShip;
}

function getSmallShipForHangar(hangar) {
  return smallShips.find(smallShip => smallShip.id === hangar.smallShipId) || createSmallShipForHangar(hangar);
}

function cloneModules(modules) {
  return modules.map(module => ({ ...module }));
}

function openSmallShipEditorForShip(smallShip) {
  if (!smallShip || buildMode || commitPending) return;

  if (hangarFindShipId === smallShip.id) hangarFindShipId = null;

  motherShipModulesBackup = cloneModules(placedModules);
  placedModules.length = 0;
  placedModules.push(...cloneModules(smallShip.modules));

  blueprints.length = 0;
  demolishSet.clear();
  heldItem = AIR;
  importedShipGhost = null;
  activeSmallShipEdit = {
    ship: smallShip,
    hangarId: smallShip.hangarId,
    capacityTiles: smallShip.capacityTiles,
    previousStatus: smallShip.status,
    previousBuiltAt: smallShip.builtAt,
    originalModulesJson: JSON.stringify(smallShip.modules)
  };

  buildMode = true;
  savedAngle = ship.angle;
  ship.angle = 0;
  buildCamera.x = ship.x;
  buildCamera.y = ship.y;
  flash(`${smallShip.name} blueprint`);
}

function openSmallShipEditor(hangar) {
  if (!isHangarType(hangar.type) || buildMode || commitPending) return;
  openSmallShipEditorForShip(getSmallShipForHangar(hangar));
}

function restoreMotherShipFromSmallEditor() {
  if (!motherShipModulesBackup) return;

  placedModules.length = 0;
  placedModules.push(...motherShipModulesBackup);
  motherShipModulesBackup = null;
}

function commitSmallShipEditor() {
  if (!activeSmallShipEdit) return false;

  const editedShip = activeSmallShipEdit.ship;
  const capacity = activeSmallShipEdit.capacityTiles;
  let next = placedModules.slice();

  for (const id of demolishSet) {
    const module = next.find(item => item.id === id);
    if (!module || module.type === "Computer") continue;

    const candidate = next.filter(item => item.id !== id);
    if (isConnected(candidate)) {
      next = candidate;
    }
  }

  for (const bp of blueprints) {
    if (isHangarType(bp.type)) continue;

    const candidate = {
      id: nextModuleId++,
      x: bp.x,
      y: bp.y,
      type: bp.type,
      w: bp.w,
      h: bp.h,
      rot: bp.rot || 0,
      tankContent: bp.tankContent,
      tankCap: bp.tankCap
    };

    if (countModuleTiles(next.concat(candidate)) > capacity) continue;
    if (canPlaceModule(candidate.x, candidate.y, candidate.w, candidate.h, next) && isConnected(next.concat(candidate))) {
      next.push(candidate);
    }
  }

  const changed = JSON.stringify(next) !== activeSmallShipEdit.originalModulesJson;
  editedShip.modules = cloneModules(next);

  if (activeSmallShipEdit.previousStatus === "hangar" && changed) {
    editedShip.status = "building";
    editedShip.builtAt = performance.now() + 2000;
  } else {
    editedShip.status = activeSmallShipEdit.previousStatus || editedShip.status;
    editedShip.builtAt = activeSmallShipEdit.previousBuiltAt || performance.now();
  }

  blueprints.length = 0;
  demolishSet.clear();
  activeSmallShipEdit = null;
  buildMode = false;
  ship.angle = savedAngle;
  restoreMotherShipFromSmallEditor();
  flash(editedShip.status === "building" ? `${editedShip.name} building` : `${editedShip.name} updated`);
  return true;
}

function getHangarById(id) {
  return placedModules.find(module => module.id === id && isHangarType(module.type)) || null;
}

function getSmallShipById(id) {
  return smallShips.find(smallShip => smallShip.id === id) || null;
}

function isHangarFreeForShip(hangar, smallShip) {
  if (!hangar || !isHangarType(hangar.type)) return false;
  return !hangar.smallShipId || hangar.smallShipId === smallShip.id || !getSmallShipById(hangar.smallShipId);
}

function getSmallShipCargoCap(smallShip) {
  return smallShip.modules.reduce((sum, module) => {
    return sum + (BUILDING_STATS[module.type]?.itemCap || 0);
  }, 0);
}

function getSmallShipCargoUsed(smallShip) {
  return Object.values(smallShip.cargo || {}).reduce((sum, amount) => sum + amount, 0);
}

function getSmallShipCargoLimit(smallShip, key) {
  return Math.max(0, Math.floor((smallShip.cargoLimits && smallShip.cargoLimits[key]) ?? 50));
}

function getSmallShipLiquidLimit(smallShip, key) {
  return Math.max(0, Math.floor((smallShip.liquidLimits && smallShip.liquidLimits[key]) ?? (key === "fuel" ? getSmallShipFuelCap(smallShip) : 50)));
}

function getSmallShipLiquidAmount(smallShip, key) {
  if (key === "fuel") return smallShip.fuel || 0;
  return (smallShip.liquids && smallShip.liquids[key]) || 0;
}

function setSmallShipLiquidAmount(smallShip, key, value) {
  if (key === "fuel") {
    smallShip.fuel = Math.max(0, value);
    return;
  }

  smallShip.liquids = smallShip.liquids || {};
  smallShip.liquids[key] = Math.max(0, value);
}

function getSmallShipLiquidCap(smallShip, key) {
  if (key === "fuel") return getSmallShipFuelCap(smallShip);

  let cap = 0;
  for (const module of smallShip.modules) {
    if (TANK_OPTIONS[module.type] && module.tankContent === key) {
      cap += module.tankCap || 0;
    }
  }

  return cap;
}

function setSmallShipLiquidLimit(smallShip, key) {
  if (!smallShip) return;

  const current = getSmallShipLiquidLimit(smallShip, key);
  openInputDialog(`Load limit for ${formatResourceName(key)}`, "Amount", current, "number", value => {
    smallShip.liquidLimits = smallShip.liquidLimits || {};
    smallShip.liquidLimits[key] = Math.max(0, Math.floor(Number(value) || 0));
    flash("Load limit updated");
  });
}

function setSmallShipCargoLimit(smallShip, key) {
  if (!smallShip || key === "crew") return;

  const current = getSmallShipCargoLimit(smallShip, key);
  openInputDialog(`Cargo limit for ${formatResourceName(key)}`, "Amount", current, "number", value => {
    smallShip.cargoLimits = smallShip.cargoLimits || {};
    smallShip.cargoLimits[key] = Math.max(0, Math.floor(Number(value) || 0));
    flash("Cargo limit updated");
  });
}

function getSmallShipFuelCap(smallShip) {
  let cap = 0;

  for (const module of smallShip.modules) {
    if (TANK_OPTIONS[module.type] && module.tankContent === "fuel") {
      cap += (module.tankCap || 5000) / 50;
    }
  }

  return cap;
}

function getSmallShipEnergyCap(smallShip) {
  let cap = 0;

  for (const module of smallShip.modules) {
    if (module.type === "Battery") cap += 200;
  }

  return cap;
}

function smallShipHasModule(smallShip, type) {
  return smallShip.modules.some(module => module.type === type);
}

function smallShipSolarOutput(smallShip) {
  return smallShip.modules.filter(module => module.type === "Solar Panel").length;
}

function storeSmallShipCargo(smallShip, key, amount = 1) {
  if (!SOLID_RESOURCES.has(key) || amount <= 0) return 0;

  const free = Math.max(0, getSmallShipCargoCap(smallShip) - getSmallShipCargoUsed(smallShip));
  const resourceFree = Math.max(0, getSmallShipCargoLimit(smallShip, key) - ((smallShip.cargo && smallShip.cargo[key]) || 0));
  const accepted = Math.min(amount, free, resourceFree);

  if (accepted > 0) {
    smallShip.cargo[key] = (smallShip.cargo[key] || 0) + accepted;
  }

  return accepted;
}

function storeSmallShipLiquid(smallShip, key, amount = 1) {
  if (!LIQUID_RESOURCES.has(key) || amount <= 0) return 0;

  const cap = Math.min(getSmallShipLiquidCap(smallShip, key), getSmallShipLiquidLimit(smallShip, key));
  const current = getSmallShipLiquidAmount(smallShip, key);
  const accepted = Math.max(0, Math.min(amount, cap - current));

  if (accepted > 0) {
    setSmallShipLiquidAmount(smallShip, key, current + accepted);
  }

  return accepted;
}

function unloadSmallShipCargo(smallShip) {
  let delivered = 0;

  for (const key in smallShip.cargo) {
    const amount = smallShip.cargo[key] || 0;
    if (amount > 0) {
      delivered += storeResource(key, amount);
    }
  }

  smallShip.cargo = {};

  for (const key in smallShip.liquids || {}) {
    const amount = smallShip.liquids[key] || 0;
    if (amount > 0) {
      delivered += storeResource(key, amount);
    }
  }

  if (delivered > 0) playSound("items", 900);
  smallShip.liquids = {};
}

function loadSmallShipSupplies(smallShip, dt) {
  const energyCap = getSmallShipEnergyCap(smallShip);
  const fuelCap = Math.min(getSmallShipFuelCap(smallShip), getSmallShipLiquidLimit(smallShip, "fuel"));
  const energyNeed = Math.max(0, energyCap - (smallShip.energy || 0));
  const fuelNeed = Math.max(0, fuelCap - (smallShip.fuel || 0));
  const energyLoad = Math.min(energyNeed, res.energy, 80 * dt);
  const fuelLoad = Math.min(fuelNeed, res.fuel, 60 * dt);

  smallShip.energy = Math.min(energyCap, (smallShip.energy || 0) + energyLoad);
  smallShip.fuel = Math.min(fuelCap, (smallShip.fuel || 0) + fuelLoad);
  res.energy -= energyLoad;
  res.fuel -= fuelLoad;

  for (const key of LIQUID_RESOURCES) {
    if (key === "fuel") continue;

    const cap = Math.min(getSmallShipLiquidCap(smallShip, key), getSmallShipLiquidLimit(smallShip, key));
    const need = Math.max(0, cap - getSmallShipLiquidAmount(smallShip, key));
    const load = Math.min(need, res[key] || 0, 60 * dt);

    if (load > 0) {
      setSmallShipLiquidAmount(smallShip, key, getSmallShipLiquidAmount(smallShip, key) + load);
      res[key] -= load;
    }
  }
}

function isAsteroidReservedByOtherDrone(asteroid, smallShip) {
  return smallShips.some(other => {
    if (other === smallShip) return false;
    if (!other.modeMining) return false;
    if (other.status === "hangar" || other.status === "building") return false;
    return other.targetAsteroid === asteroid;
  });
}

function getNearestAsteroidForSmallShip(smallShip) {
  let best = null;
  let bestDist = Infinity;
  const motherRange = CONFIG.GRID_SIZE * 50;

  for (const asteroid of asteroids) {
    if (asteroid.totalItems <= 0) continue;

    const motherDist = Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y);
    if (motherDist > motherRange) continue;

    const dist = Math.hypot(asteroid.x - smallShip.x, asteroid.y - smallShip.y);
    if (dist < bestDist) {
      best = asteroid;
      bestDist = dist;
    }
  }

  return best;
}
function hasMiningTargetNearMother(rangeTiles = 40) {
  const range = CONFIG.GRID_SIZE * rangeTiles;

  return asteroids.some(asteroid => {
    if (asteroid.totalItems <= 0) return false;
    return Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y) <= range;
  });
}

function findNearestGasPlanet(x, y, maxDistance = Infinity) {
  let best = null;
  let bestDist = maxDistance;

  for (const planet of planets) {
    if (planet.typeKey !== "gas") continue;

    const dist = Math.max(0, Math.hypot(planet.x - x, planet.y - y) - planet.radius);
    if (dist < bestDist) {
      best = planet;
      bestDist = dist;
    }
  }

  return best;
}

function findNearestStar(x, y, maxDistance = Infinity) {
  let best = null;
  let bestDist = maxDistance;

  for (const star of worldStars) {
    const dist = Math.max(0, Math.hypot(star.x - x, star.y - y) - star.radius);
    if (dist < bestDist) {
      best = star;
      bestDist = dist;
    }
  }

  return best;
}

function hasGasPlanetNearMother(rangeTiles = 50) {
  return findNearestGasPlanet(ship.x, ship.y, CONFIG.GRID_SIZE * rangeTiles) !== null;
}

function hasStarNearMother(rangeTiles = 50) {
  return findNearestStar(ship.x, ship.y, CONFIG.GRID_SIZE * rangeTiles) !== null;
}


function moveSmallShipToward(smallShip, targetX, targetY, dt, stopDistance = CONFIG.GRID_SIZE) {
  smallShip._thrusting = false;
  const dx = targetX - smallShip.x;
  const dy = targetY - smallShip.y;
  const dist = Math.hypot(dx, dy);
  const maxSpeed = MAX_SHIP_SPEED * 60;
  const accel = 260 * getMassAccelerationFactor(smallShip.modules);

  if (dist > 0.1) {
    smallShip.angle = Math.atan2(dy, dx) + Math.PI / 2;
  }

  let desiredVx = 0;
  let desiredVy = 0;

  if (dist > stopDistance) {
    const speed = Math.min(maxSpeed, Math.max(35, (dist - stopDistance) * 1.4));
    desiredVx = (dx / dist) * speed;
    desiredVy = (dy / dist) * speed;
  }

  const dvx = desiredVx - smallShip.vx;
  const dvy = desiredVy - smallShip.vy;
  const dv = Math.hypot(dvx, dvy);
  const step = Math.min(dv, accel * dt);

  if ((smallShip.fuel || 0) > 0 && dv > 0.001) {
    const fuelUse = step * 0.012;
    const fuelScale = Math.min(1, smallShip.fuel / Math.max(0.0001, fuelUse));
    const ax = (dvx / dv) * step * fuelScale;
    const ay = (dvy / dv) * step * fuelScale;

    if (canAccelerateWithVelocity(smallShip.vx / 60, smallShip.vy / 60, ax / 60, ay / 60)) {
      smallShip.vx += ax;
      smallShip.vy += ay;
      smallShip.fuel = Math.max(0, smallShip.fuel - fuelUse * fuelScale);
      smallShip._thrusting = fuelScale > 0.01;
    }
  } else if ((smallShip.fuel || 0) <= 0) {
    smallShip.vx *= 0.999;
    smallShip.vy *= 0.999;
  }

  clampVelocity(smallShip, MAX_SHIP_SPEED * 60);
  smallShip.x += smallShip.vx * dt;
  smallShip.y += smallShip.vy * dt;
}

function hasSmallShipTripSupplies(smallShip) {
  const fuel = smallShip.fuel || 0;
  const energy = smallShip.energy || 0;
  const needsMachinePower = smallShipHasModule(smallShip, "Drill") || smallShipHasModule(smallShip, "Scooper") || smallShipHasModule(smallShip, "Solar Wind Collector");
  const hasSolarBackup = smallShipSolarOutput(smallShip) > 0;

  if (fuel < 5) return false;
  if (needsMachinePower && energy < 3 && !hasSolarBackup) return false;

  return true;
}

function needsSmallShipTransfer(smallShip) {
  if (getSmallShipCargoUsed(smallShip) > 0) return true;
  for (const key in smallShip.liquids || {}) {
    if ((smallShip.liquids[key] || 0) > 0.5) return true;
  }
  if ((smallShip.modeMining || smallShip.modeGas || smallShip.modeSolarWind) && hasSmallShipTripSupplies(smallShip)) return false;

  const fuelNeed = getSmallShipFuelCap(smallShip) - (smallShip.fuel || 0);
  const energyNeed = getSmallShipEnergyCap(smallShip) - (smallShip.energy || 0);
  return fuelNeed > 0.5 || energyNeed > 0.5;
}
function finishSmallShipTransfer(smallShip, hangar) {
  smallShip.status = "hangar";
  smallShip.targetAsteroid = null;
  smallShip.targetPlanet = null;
  smallShip.targetStar = null;
  smallShip.mineTimer = 0;
  smallShip.vx = 0;
  smallShip.vy = 0;

  const pos = moduleWorldCenter(hangar);
  smallShip.x = pos.x;
  smallShip.y = pos.y;

  unloadSmallShipCargo(smallShip);
  loadSmallShipSupplies(smallShip, 60);
  smallShip.lastTransferAt = performance.now();
}

function beginSmallShipTransfer(smallShip, hangar) {
  smallShip.status = "docking";
  smallShip.targetAsteroid = null;
  smallShip.targetPlanet = null;
  smallShip.targetStar = null;
  smallShip.mineTimer = 0;
  smallShip.vx = 0;
  smallShip.vy = 0;
  smallShip.transferDoneAt = performance.now() + 1000;

  const pos = moduleWorldCenter(hangar);
  smallShip.x = pos.x;
  smallShip.y = pos.y;
}

function getHangarExitPosition(hangar) {
  const pos = moduleWorldCenter(hangar);
  let dx = pos.x - ship.x;
  let dy = pos.y - ship.y;
  const len = Math.hypot(dx, dy);

  if (len < 1) {
    dx = Math.cos(ship.angle - Math.PI / 2);
    dy = Math.sin(ship.angle - Math.PI / 2);
  } else {
    dx /= len;
    dy /= len;
  }

  return {
    x: pos.x + dx * CONFIG.GRID_SIZE * 2,
    y: pos.y + dy * CONFIG.GRID_SIZE * 2
  };
}

function launchSmallShip(smallShip, hangar) {
  const pos = getHangarExitPosition(hangar);
  smallShip.x = pos.x;
  smallShip.y = pos.y;
  smallShip.vx = ship.vx;
  smallShip.vy = ship.vy;
  if ((smallShip.fuel || 0) <= 0) {
    flash(`${smallShip.name} needs fuel`);
    return;
  }

  smallShip.status = smallShip.modeGas ? "gas" : smallShip.modeSolarWind ? "solarWind" : "mining";
  smallShip.targetAsteroid = null;
  smallShip.targetPlanet = null;
  smallShip.targetStar = null;
  smallShip.mineTimer = 0;
}

function updateMiningSmallShip(smallShip, dt) {
  const hangar = getHangarById(smallShip.hangarId);
  const motherDist = Math.hypot(smallShip.x - ship.x, smallShip.y - ship.y);
  const cargoFull = getSmallShipCargoUsed(smallShip) >= getSmallShipCargoCap(smallShip);

  smallShip.energy = Math.min(getSmallShipEnergyCap(smallShip), (smallShip.energy || 0) + smallShipSolarOutput(smallShip) * dt);

  if (!hangar || recallSmallShips || cargoFull || motherDist > CONFIG.GRID_SIZE * 50) {
    smallShip.status = "returning";
    smallShip.targetAsteroid = null;
    return;
  }

  if (!smallShipHasModule(smallShip, "Drill") || getSmallShipCargoCap(smallShip) <= 0) {
    smallShip.status = "returning";
    return;
  }

  if (!smallShip.targetAsteroid || !asteroids.includes(smallShip.targetAsteroid) || smallShip.targetAsteroid.totalItems <= 0) {
    smallShip.targetAsteroid = getNearestAsteroidForSmallShip(smallShip);
  }

  if (!smallShip.targetAsteroid) {
    smallShip.status = "returning";
    return;
  }

  const asteroid = smallShip.targetAsteroid;
  const dist = Math.hypot(asteroid.x - smallShip.x, asteroid.y - smallShip.y);
  const mineDistance = asteroid.size + CONFIG.GRID_SIZE * 1.4;

  if (dist > mineDistance) {
    moveSmallShipToward(smallShip, asteroid.x, asteroid.y, dt, mineDistance);
    smallShip.mineTimer = 0;
    return;
  }

  smallShip.vx += (asteroid.vx * 60 - smallShip.vx) * Math.min(1, dt * 2);
  smallShip.vy += (asteroid.vy * 60 - smallShip.vy) * Math.min(1, dt * 2);
  smallShip.x += smallShip.vx * dt;
  smallShip.y += smallShip.vy * dt;

  if ((smallShip.energy || 0) < 3 * dt) return;

  smallShip.energy = Math.max(0, smallShip.energy - 3 * dt);
  smallShip.mineTimer += dt;

  if (smallShip.mineTimer >= 0.35) {
    smallShip.mineTimer = 0;
    const key = takeAsteroidResource(asteroid);

    if (key && SOLID_RESOURCES.has(key)) {
      storeSmallShipCargo(smallShip, key, 1);
    }

    if (asteroid.totalItems <= 0 || getSmallShipCargoUsed(smallShip) >= getSmallShipCargoCap(smallShip)) {
      smallShip.status = "returning";
      smallShip.targetAsteroid = null;
    }
  }
}

function getSmallShipGasFree(smallShip, keys) {
  let free = 0;

  for (const key of keys) {
    const cap = Math.min(getSmallShipLiquidCap(smallShip, key), getSmallShipLiquidLimit(smallShip, key));
    free += Math.max(0, cap - getSmallShipLiquidAmount(smallShip, key));
  }

  return free;
}

function updateGasSmallShip(smallShip, dt) {
  const hangar = getHangarById(smallShip.hangarId);
  const motherDist = Math.hypot(smallShip.x - ship.x, smallShip.y - ship.y);
  const gasKeys = ["hydrogen", "deuterium"];

  smallShip.energy = Math.min(getSmallShipEnergyCap(smallShip), (smallShip.energy || 0) + smallShipSolarOutput(smallShip) * dt);

  if (!hangar || recallSmallShips || motherDist > CONFIG.GRID_SIZE * 50 || getSmallShipGasFree(smallShip, gasKeys) <= 0.5) {
    smallShip.status = "returning";
    smallShip.targetPlanet = null;
    return;
  }

  if (!smallShipHasModule(smallShip, "Scooper")) {
    smallShip.status = "returning";
    return;
  }

  if (!smallShip.targetPlanet || smallShip.targetPlanet.typeKey !== "gas") {
    smallShip.targetPlanet = findNearestGasPlanet(smallShip.x, smallShip.y, CONFIG.GRID_SIZE * 55);
  }

  if (!smallShip.targetPlanet) {
    smallShip.status = "returning";
    return;
  }

  const planet = smallShip.targetPlanet;
  const orbitRadius = planet.radius + CONFIG.GRID_SIZE * 6;
  const angle = Math.atan2(smallShip.y - planet.y, smallShip.x - planet.x) + dt * 0.35;
  const targetX = planet.x + Math.cos(angle) * orbitRadius;
  const targetY = planet.y + Math.sin(angle) * orbitRadius;
  const dist = Math.hypot(smallShip.x - targetX, smallShip.y - targetY);

  moveSmallShipToward(smallShip, targetX, targetY, dt, CONFIG.GRID_SIZE * 1.5);
  if (dist > CONFIG.GRID_SIZE * 4) return;

  const collectors = smallShip.modules.filter(module => module.type === "Scooper").length;
  const stats = BUILDING_STATS.Scooper;
  const energyUse = stats.energyUse * collectors * dt;
  if ((smallShip.energy || 0) < energyUse) return;

  smallShip.energy -= energyUse;
  const rate = stats.gasCollectRate * collectors * dt;
  const accepted = storeSmallShipLiquid(smallShip, "hydrogen", rate * 0.8) + storeSmallShipLiquid(smallShip, "deuterium", rate * 0.2);
  if (accepted > 0 && performance.now() - (smallShip._lastCollectSoundAt || 0) > 1800) {
    playSound("items", 1600);
    smallShip._lastCollectSoundAt = performance.now();
  }
}

function updateSolarWindSmallShip(smallShip, dt) {
  const hangar = getHangarById(smallShip.hangarId);
  const motherDist = Math.hypot(smallShip.x - ship.x, smallShip.y - ship.y);

  smallShip.energy = Math.min(getSmallShipEnergyCap(smallShip), (smallShip.energy || 0) + smallShipSolarOutput(smallShip) * dt);

  if (!hangar || recallSmallShips || motherDist > CONFIG.GRID_SIZE * 50 || getSmallShipGasFree(smallShip, ["helium3"]) <= 0.5) {
    smallShip.status = "returning";
    smallShip.targetStar = null;
    return;
  }

  if (!smallShipHasModule(smallShip, "Solar Wind Collector")) {
    smallShip.status = "returning";
    return;
  }

  if (!smallShip.targetStar) {
    smallShip.targetStar = findNearestStar(smallShip.x, smallShip.y, CONFIG.GRID_SIZE * 60);
  }

  if (!smallShip.targetStar) {
    smallShip.status = "returning";
    return;
  }

  const star = smallShip.targetStar;
  const orbitRadius = star.radius + CONFIG.GRID_SIZE * 10;
  const angle = Math.atan2(smallShip.y - star.y, smallShip.x - star.x) + dt * 0.28;
  const targetX = star.x + Math.cos(angle) * orbitRadius;
  const targetY = star.y + Math.sin(angle) * orbitRadius;
  const dist = Math.hypot(smallShip.x - targetX, smallShip.y - targetY);

  moveSmallShipToward(smallShip, targetX, targetY, dt, CONFIG.GRID_SIZE * 2);
  if (dist > CONFIG.GRID_SIZE * 5) return;

  const collectors = smallShip.modules.filter(module => module.type === "Solar Wind Collector").length;
  const stats = BUILDING_STATS["Solar Wind Collector"];
  const energyUse = stats.energyUse * collectors * dt;
  if ((smallShip.energy || 0) < energyUse) return;

  smallShip.energy -= energyUse;
  const accepted = storeSmallShipLiquid(smallShip, "helium3", stats.helium3CollectRate * collectors * dt);
  if (accepted > 0 && performance.now() - (smallShip._lastCollectSoundAt || 0) > 1800) {
    playSound("items", 1600);
    smallShip._lastCollectSoundAt = performance.now();
  }
}

function updateReturningSmallShip(smallShip, dt) {
  const hangar = getHangarById(smallShip.hangarId);

  if (!hangar) {
    smallShip.status = "orphaned";
    return;
  }

  const pos = moduleWorldCenter(hangar);
  const dockRadius = CONFIG.GRID_SIZE * 2.5;
  const dist = Math.hypot(pos.x - smallShip.x, pos.y - smallShip.y);

  if (dist <= dockRadius) {
    beginSmallShipTransfer(smallShip, hangar);
    return;
  }

  moveSmallShipToward(smallShip, pos.x, pos.y, dt, CONFIG.GRID_SIZE * 2);

  const nextDist = Math.hypot(pos.x - smallShip.x, pos.y - smallShip.y);
  if (nextDist <= dockRadius) {
    beginSmallShipTransfer(smallShip, hangar);
  }
}

function updateSmallShips(dt) {
  if (buildMode || activeSmallShipEdit) return;

  const now = performance.now();

  for (const smallShip of smallShips) {
    if (smallShip.status === "building" && now >= smallShip.builtAt) {
      smallShip.status = "hangar";
      flash(`${smallShip.name} ready`);
    }

    const hangar = getHangarById(smallShip.hangarId);
    const computerOnly = smallShip.modules.length === 1 && smallShip.modules[0].type === "Computer";

    if (!hangar && computerOnly) {
      smallShip._delete = true;
      continue;
    }

    if (smallShip.status === "hangar") {
      if (hangar) {
        const pos = moduleWorldCenter(hangar);
        smallShip.x = pos.x;
        smallShip.y = pos.y;

        if (needsSmallShipTransfer(smallShip) && now - (smallShip.lastTransferAt || 0) > 1200) {
          beginSmallShipTransfer(smallShip, hangar);
        }
      } else {
        smallShip.status = "orphaned";
      }

      if (!recallSmallShips && smallShip.modeMining && hangar && smallShip.status === "hangar" && hasSmallShipTripSupplies(smallShip) && hasMiningTargetNearMother(40)) {
        launchSmallShip(smallShip, hangar);
      } else if (!recallSmallShips && smallShip.modeGas && hangar && smallShip.status === "hangar" && hasSmallShipTripSupplies(smallShip) && smallShipHasModule(smallShip, "Scooper") && hasGasPlanetNearMother(50)) {
        launchSmallShip(smallShip, hangar);
      } else if (!recallSmallShips && smallShip.modeSolarWind && hangar && smallShip.status === "hangar" && hasSmallShipTripSupplies(smallShip) && smallShipHasModule(smallShip, "Solar Wind Collector") && hasStarNearMother(50)) {
        launchSmallShip(smallShip, hangar);
      }
    } else if (smallShip.status === "docking") {
      if (!hangar) {
        smallShip.status = "orphaned";
      } else if (now >= (smallShip.transferDoneAt || 0)) {
        finishSmallShipTransfer(smallShip, hangar);
      }
    } else if (smallShip.status === "mining") {
      updateMiningSmallShip(smallShip, dt);
    } else if (smallShip.status === "gas") {
      updateGasSmallShip(smallShip, dt);
    } else if (smallShip.status === "solarWind") {
      updateSolarWindSmallShip(smallShip, dt);
    } else if (smallShip.status === "returning") {
      updateReturningSmallShip(smallShip, dt);
    } else if (smallShip.status === "orphaned") {
      smallShip.x += (ship.x - smallShip.x) * Math.min(1, dt * 0.2);
      smallShip.y += (ship.y - smallShip.y) * Math.min(1, dt * 0.2);
    }
  }

  for (let i = smallShips.length - 1; i >= 0; i--) {
    if (smallShips[i]._delete) {
      smallShips.splice(i, 1);
    }
  }

  removeEmptyAsteroids();
}

function getSmallShipClickRadius(smallShip) {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass(smallShip.modules);
  let radius = grid * 0.75;

  for (const module of smallShip.modules) {
    const center = getModuleCenter(module);
    const dx = (center.x - com.x) * grid;
    const dy = (center.y - com.y) * grid;
    const moduleRadius = Math.hypot(dx, dy) + Math.max(module.w || 1, module.h || 1) * grid * 0.7;
    radius = Math.max(radius, moduleRadius);
  }

  return radius;
}

function getSmallShipAtScreen(mx, my) {
  if (buildMode) return null;

  for (const smallShip of smallShips) {
    if (smallShip.status === "hangar" || smallShip.status === "building" || smallShip.status === "docking") continue;

    const p = worldToScreen(smallShip.x, smallShip.y);
    const radius = Math.max(18, getSmallShipClickRadius(smallShip) * camera.scale);

    if (Math.hypot(mx - p.x, my - p.y) <= radius) {
      return smallShip;
    }
  }

  return null;
}
function cloneEnemyModules(design) {
  const modules = [{ id: nextModuleId++, x: 0, y: 0, type: "Computer", w: 1, h: 1, rot: 0, hp: 1 }];

  for (const module of design.modules || []) {
    modules.push({
      id: nextModuleId++,
      x: module.x,
      y: module.y,
      type: module.type,
      w: module.w || 1,
      h: module.h || 1,
      rot: module.rot || 0,
      tankContent: module.tankContent,
      tankCap: module.tankCap,
      hp: 1
    });
  }

  return modules;
}

function getEnemyDesign(id) {
  return ENEMY_SHIP_DESIGNS.find(design => design.id === id) || ENEMY_SHIP_DESIGNS[0];
}

function getEnemyModuleWorldCenter(enemy, module) {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass(enemy.modules);
  const center = getModuleCenter(module);
  const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, enemy.angle || 0);

  return { x: enemy.x + rel.x, y: enemy.y + rel.y };
}

function getEnemyShipRadius(enemy) {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass(enemy.modules);
  let radius = grid;

  for (const module of enemy.modules) {
    const center = getModuleCenter(module);
    const dx = (center.x - com.x) * grid;
    const dy = (center.y - com.y) * grid;
    radius = Math.max(radius, Math.hypot(dx, dy) + Math.max(module.w || 1, module.h || 1) * grid * 0.75);
  }

  return radius;
}

function getEnemyResourceCaps(enemy) {
  const caps = { fuel: 80, water: 0, steam: 0, energy: 40, uranium: 0, food: 0 };

  for (const module of enemy.modules) {
    if (module.type === "Battery") caps.energy += 200;
    if (module.type === "Quarters") caps.food += 100;
    if (TANK_OPTIONS[module.type] && module.tankContent) {
      caps[module.tankContent] = (caps[module.tankContent] || 0) + (module.tankCap || 600);
    }
  }

  return caps;
}

function createEnemyShip(designId, x, y, fleetId, offsetX = 0, offsetY = 0) {
  const design = getEnemyDesign(designId);
  const modules = cloneEnemyModules(design);
  const caps = getEnemyResourceCaps({ modules });
  const resources = {
    fuel: Math.min(caps.fuel || 0, design.resources?.fuel ?? caps.fuel ?? 0),
    water: Math.min(caps.water || 0, design.resources?.water ?? caps.water ?? 0),
    uranium: design.resources?.uranium || 0,
    food: design.resources?.food || 0,
    energy: caps.energy,
    ammo: design.ammo || 0
  };

  const enemy = {
    id: nextEnemyShipId++,
    fleetId,
    designId,
    name: design.name,
    role: design.role || "patrol",
    modules,
    resources,
    crew: design.crew || 0,
    x: x + offsetX,
    y: y + offsetY,
    vx: 0,
    vy: 0,
    angle: Math.random() * Math.PI * 2,
    targetAsteroid: null,
    patrolAngle: Math.random() * Math.PI * 2,
    _thrusting: false,
    _dead: false
  };

  enemyShips.push(enemy);
  return enemy;
}

function getPlayerStrengthScore() {
  return countModuleTiles(placedModules) + smallShips.reduce((sum, drone) => sum + countModuleTiles(drone.modules || []) * 0.6, 0);
}

function chooseEnemyFleetDesign() {
  const strength = getPlayerStrengthScore();
  const available = ENEMY_FLEET_DESIGNS.filter(fleet => strength >= fleet.minStrength);
  if (currentWorldIsEnd && available.length) {
    return available[Math.max(0, available.length - 1)];
  }
  return available[Math.floor(Math.random() * available.length)] || ENEMY_FLEET_DESIGNS[0];
}

function getEnemySpawnPosition() {
  const minDistance = CONFIG.GRID_SIZE * 85;
  const maxDistance = CONFIG.GRID_SIZE * 135;
  const angle = Math.random() * Math.PI * 2;
  const distance = minDistance + Math.random() * (maxDistance - minDistance);

  return {
    x: Math.max(300, Math.min(CONFIG.WORLD_WIDTH - 300, ship.x + Math.cos(angle) * distance)),
    y: Math.max(300, Math.min(CONFIG.WORLD_HEIGHT - 300, ship.y + Math.sin(angle) * distance))
  };
}

function formatDirectionFromPlayer(target) {
  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const distanceTiles = Math.max(1, Math.round(Math.hypot(dx, dy) / CONFIG.GRID_SIZE));
  const noseAngle = ship.angle - Math.PI / 2 - SHIP_NOSE_OFFSET;
  const angleToTarget = Math.atan2(dy, dx);
  const diff = normalizeAngle(angleToTarget - noseAngle);
  const abs = Math.abs(diff);
  let direction = "ahead";

  if (abs > Math.PI * 0.75) {
    direction = "behind";
  } else if (abs > Math.PI * 0.25) {
    direction = diff > 0 ? "right" : "left";
  }

  return `${distanceTiles} m ${direction}`;
}
function spawnEnemyFleet(fleet = chooseEnemyFleetDesign()) {
  const pos = getEnemySpawnPosition();
  const fleetId = nextEnemyFleetId++;
  const spacing = CONFIG.GRID_SIZE * 7;
  const count = fleet.ships.length;

  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    createEnemyShip(fleet.ships[i], pos.x, pos.y, fleetId, offset, Math.sin(i) * CONFIG.GRID_SIZE * 2);
  }

  flash(`Enemy fleet detected: ${formatDirectionFromPlayer(pos)}`);
  playSound("enemyDetected", 500);
}

function updateEnemySpawning() {
  const enemyLimit = currentWorldIsEnd
    ? Math.max(4, Math.floor(getPlayerStrengthScore() / 45))
    : Math.max(1, Math.floor(getPlayerStrengthScore() / 90));
  if (buildMode || enemyShips.length > enemyLimit) return;

  const now = performance.now();
  if (now < nextEnemySpawnAt) return;

  spawnEnemyFleet();
  nextEnemySpawnAt = currentWorldIsEnd
    ? now + 18000 + Math.random() * 22000
    : now + 45000 + Math.random() * 45000;
}
function getNearestEnemyTargetForTurret(turretModule, rangeTiles = 12) {
  if (enemyShips.length === 0) return null;

  const world = moduleWorldCenter(turretModule);
  let best = null;
  let bestDist = Infinity;
  const range = CONFIG.GRID_SIZE * rangeTiles;

  for (const enemy of enemyShips) {
    if (enemy._dead) continue;
    const computer = enemy.modules.find(module => module.type === "Computer");
    const targetWorld = computer ? getEnemyModuleWorldCenter(enemy, computer) : { x: enemy.x, y: enemy.y };
    const dist = Math.hypot(targetWorld.x - world.x, targetWorld.y - world.y);
    if (dist < range && dist < bestDist) {
      best = { x: targetWorld.x, y: targetWorld.y, enemy };
      bestDist = dist;
    }
  }

  return best;
}

function getClosestPlayerModuleTo(x, y) {
  let best = null;
  let bestDist = Infinity;

  for (const module of placedModules) {
    const world = moduleWorldCenter(module);
    const dist = Math.hypot(world.x - x, world.y - y);
    if (dist < bestDist) {
      best = module;
      bestDist = dist;
    }
  }

  return best;
}

function getClosestEnemyModuleTo(enemy, x, y) {
  let best = null;
  let bestDist = Infinity;

  for (const module of enemy.modules) {
    const world = getEnemyModuleWorldCenter(enemy, module);
    const dist = Math.hypot(world.x - x, world.y - y);
    if (dist < bestDist) {
      best = module;
      bestDist = dist;
    }
  }

  return best;
}

function moveEnemyToward(enemy, targetX, targetY, dt, stopDistance = CONFIG.GRID_SIZE * 6) {
  enemy._thrusting = false;
  const dx = targetX - enemy.x;
  const dy = targetY - enemy.y;
  const dist = Math.hypot(dx, dy);

  if (dist > 0.1) enemy.angle = Math.atan2(dy, dx) + Math.PI / 2;

  let desiredVx = 0;
  let desiredVy = 0;

  if (dist > stopDistance) {
    const speed = Math.min(130, Math.max(25, (dist - stopDistance) * 0.75));
    desiredVx = (dx / dist) * speed;
    desiredVy = (dy / dist) * speed;
  }

  const dvx = desiredVx - enemy.vx;
  const dvy = desiredVy - enemy.vy;
  const dv = Math.hypot(dvx, dvy);
  const step = Math.min(dv, 220 * getMassAccelerationFactor(enemy.modules) * dt);

  if ((enemy.resources.fuel || 0) > 0 && dv > 0.001) {
    const fuelUse = step * 0.01;
    const scale = Math.min(1, enemy.resources.fuel / Math.max(0.0001, fuelUse));
    const ax = (dvx / dv) * step * scale;
    const ay = (dvy / dv) * step * scale;

    if (canAccelerateWithVelocity(enemy.vx / 60, enemy.vy / 60, ax / 60, ay / 60)) {
      enemy.vx += ax;
      enemy.vy += ay;
      enemy.resources.fuel = Math.max(0, enemy.resources.fuel - fuelUse * scale);
      enemy._thrusting = scale > 0.01;
    }
  }

  clampVelocity(enemy, MAX_SHIP_SPEED * 60);
  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;
}

function findEnemyMiningAsteroid(enemy) {
  let best = null;
  let bestDist = Infinity;

  for (const asteroid of asteroids) {
    if (asteroid.totalItems <= 0) continue;
    const dist = Math.hypot(asteroid.x - enemy.x, asteroid.y - enemy.y);
    if (dist < bestDist) {
      best = asteroid;
      bestDist = dist;
    }
  }

  return best;
}

function updateEnemyMining(enemy, dt) {
  if (!enemy.modules.some(module => module.type === "Drill")) return;
  if (!enemy.targetAsteroid || !asteroids.includes(enemy.targetAsteroid) || enemy.targetAsteroid.totalItems <= 0) {
    enemy.targetAsteroid = findEnemyMiningAsteroid(enemy);
  }

  const asteroid = enemy.targetAsteroid;
  if (!asteroid) return;

  const dist = Math.hypot(asteroid.x - enemy.x, asteroid.y - enemy.y);
  const mineDistance = asteroid.size + CONFIG.GRID_SIZE * 1.5;

  if (dist > mineDistance) {
    moveEnemyToward(enemy, asteroid.x, asteroid.y, dt, mineDistance);
    enemy.mineTimer = 0;
    return;
  }

  enemy.vx += (asteroid.vx * 60 - enemy.vx) * Math.min(1, dt * 2);
  enemy.vy += (asteroid.vy * 60 - enemy.vy) * Math.min(1, dt * 2);
  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;
  enemy.mineTimer = (enemy.mineTimer || 0) + dt;

  if (enemy.mineTimer >= 0.35) {
    enemy.mineTimer = 0;
    takeAsteroidResource(asteroid);
  }
}

function fireCombatBullet(owner, shooter, fromX, fromY, targetX, targetY) {
  const angle = Math.atan2(targetY - fromY, targetX - fromX);
  const speed = 420;

  playSound("turretShot", 70);

  combatBullets.push({
    owner,
    shooter,
    x: fromX,
    y: fromY,
    vx: Math.cos(angle) * speed + (shooter.vx || 0),
    vy: Math.sin(angle) * speed + (shooter.vy || 0),
    ttl: 3.2
  });
}

function updateEnemyTurrets(enemy, dt) {
  const attackRange = CONFIG.GRID_SIZE * 16;
  const targetModule = getClosestPlayerModuleTo(enemy.x, enemy.y);
  if (!targetModule) return;

  const targetWorld = moduleWorldCenter(targetModule);
  const targetDist = Math.hypot(targetWorld.x - enemy.x, targetWorld.y - enemy.y);
  if (targetDist > attackRange) return;

  for (const turret of enemy.modules) {
    if (turret.type !== "Turret") continue;
    turret._fireCooldown = Math.max(0, (turret._fireCooldown || 0) - dt);
    const turretWorld = getEnemyModuleWorldCenter(enemy, turret);
    turret._gunAngle = Math.atan2(targetWorld.y - turretWorld.y, targetWorld.x - turretWorld.x) - enemy.angle - (turret.rot || 0) * Math.PI / 2 - Math.PI / 2;

    if (turret._fireCooldown <= 0 && (enemy.resources.ammo || 0) >= 0.1) {
      enemy.resources.ammo -= 0.1;
      turret._fireCooldown = 1;
      fireCombatBullet("enemy", enemy, turretWorld.x, turretWorld.y, targetWorld.x, targetWorld.y);
    }
  }
}

function updatePlayerTurrets(dt) {
  if (!turretsActive || buildMode || (res.ammo || 0) < 0.1) return;

  for (const turret of placedModules) {
    if (turret.type !== "Turret") continue;
    turret._fireCooldown = Math.max(0, (turret._fireCooldown || 0) - dt);
    if (turret._fireCooldown > 0) continue;

    const target = getNearestEnemyTargetForTurret(turret);
    if (!target) continue;

    const turretWorld = moduleWorldCenter(turret);
    res.ammo -= 0.1;
    turret._fireCooldown = 1;
    fireCombatBullet("player", ship, turretWorld.x, turretWorld.y, target.x, target.y);
  }
}

function playerShieldBlocksBullet(bullet) {
  if (!shieldsActive || bullet._shieldPierced) return false;

  for (const module of placedModules) {
    if (module.type !== "Shield Generator") continue;
    const shieldCost = BUILDING_STATS[module.type]?.impactEnergyUse || 20;
    if ((res.energy || 0) < shieldCost) continue;

    const center = moduleWorldCenter(module);
    const dx = bullet.x - center.x;
    const dy = bullet.y - center.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CONFIG.GRID_SIZE * 4) continue;

    const outDir = ship.angle + (module.rot || 0) * Math.PI / 2 + Math.PI / 2;
    const bulletAngle = Math.atan2(dy, dx);

    if (Math.abs(normalizeAngle(bulletAngle - outDir)) <= Math.PI / 2) {
      res.energy = Math.max(0, res.energy - shieldCost);
      if (Math.random() < 0.7) return true;
      bullet._shieldPierced = true;
      return false;
    }
  }

  return false;
}

function updateCombatBullets(dt) {
  for (let i = combatBullets.length - 1; i >= 0; i--) {
    const bullet = combatBullets[i];
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.ttl -= dt;

    if (bullet.ttl <= 0) {
      combatBullets.splice(i, 1);
      continue;
    }

    if (bullet.owner === "enemy") {
      if (playerShieldBlocksBullet(bullet)) {
        combatBullets.splice(i, 1);
        continue;
      }

      const module = getClosestPlayerModuleTo(bullet.x, bullet.y);
      if (!module) continue;
      const world = moduleWorldCenter(module);
      const hitRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.55;
      if (Math.hypot(world.x - bullet.x, world.y - bullet.y) <= hitRadius) {
        damageModule(module, 0.25);
        combatBullets.splice(i, 1);
      }
    } else if (bullet.owner === "player") {
      for (const enemy of enemyShips) {
        const module = getClosestEnemyModuleTo(enemy, bullet.x, bullet.y);
        if (!module) continue;
        const world = getEnemyModuleWorldCenter(enemy, module);
        const hitRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.55;
        if (Math.hypot(world.x - bullet.x, world.y - bullet.y) <= hitRadius) {
          damageModule(module, 0.25);
          combatBullets.splice(i, 1);
          break;
        }
      }
    }
  }
}
function updateEnemyShips(dt) {
  if (buildMode) return;

  updateEnemySpawning();

  for (const enemy of enemyShips) {
    if (enemy._dead) continue;
    cleanupEnemyShipDamage(enemy);
    if (enemy._dead) continue;

    const caps = getEnemyResourceCaps(enemy);
    enemy.resources.energy = Math.min(caps.energy, (enemy.resources.energy || 0) + enemy.modules.filter(module => module.type === "Solar Panel").length * dt);

    const playerDist = Math.hypot(ship.x - enemy.x, ship.y - enemy.y);
    const attackRange = CONFIG.GRID_SIZE * 16;

    if (playerDist < CONFIG.GRID_SIZE * 35 || enemy.role === "patrol") {
      moveEnemyToward(enemy, ship.x, ship.y, dt, attackRange * 0.75);
    } else if (enemy.role === "miner") {
      updateEnemyMining(enemy, dt);
    } else {
      enemy.patrolAngle += dt * 0.2;
      moveEnemyToward(enemy, enemy.x + Math.cos(enemy.patrolAngle) * CONFIG.GRID_SIZE * 8, enemy.y + Math.sin(enemy.patrolAngle) * CONFIG.GRID_SIZE * 8, dt, CONFIG.GRID_SIZE * 2);
    }

    updateEnemyTurrets(enemy, dt);

    if (!enemy.modules.some(module => module.type === "Computer" && getModuleHealth(module) > 0)) {
      enemy._dead = true;
    }
  }

  for (let i = enemyShips.length - 1; i >= 0; i--) {
    if (enemyShips[i]._dead) enemyShips.splice(i, 1);
  }
}

function drawEnemyShipModule(enemy, module, com) {
  const grid = CONFIG.GRID_SIZE;
  const center = getModuleCenter(module);
  const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, enemy.angle || 0);
  const p = worldToScreen(enemy.x + rel.x, enemy.y + rel.y);
  const rot = module.rot || 0;
  const drawSize = getDrawSize(module.w || 1, module.h || 1, rot);
  const sw = drawSize.w * grid * camera.scale;
  const sh = drawSize.h * grid * camera.scale;
  const isThruster = module.type === "Main Thruster" || module.type === "RCS Thruster";
  const spriteName = isThruster ? (enemy._thrusting ? module.type + " On" : module.type + " Off") : module.type;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((enemy.angle || 0) + rot * Math.PI / 2);

  if (TANK_OPTIONS[module.type] && module.tankContent && TANK_COLORS[module.tankContent]) {
    ctx.fillStyle = TANK_COLORS[module.tankContent];
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  }

  if (module.type === "Turret") {
    drawImageSprite("TurretBase", -sw / 2, -sh / 2, sw, sh);
    ctx.rotate(module._gunAngle || 0);
    drawImageSprite("TurretGunStraight", -sw / 2, -sh / 2, sw, sh);
  } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
    ctx.fillStyle = module.type === "Computer" ? "#66ffff" : "rgba(55,35,45,0.9)";
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  }

  drawModuleHealthOverlay(module, sw, sh);
  ctx.restore();

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((enemy.angle || 0) + rot * Math.PI / 2);
  ctx.strokeStyle = "rgba(255,40,40,0.95)";
  ctx.lineWidth = Math.max(2, 3 * camera.scale);
  ctx.strokeRect(-sw / 2 - 2, -sh / 2 - 2, sw + 4, sh + 4);
  ctx.restore();
}

function drawEnemyShips() {
  if (buildMode) return;

  for (const enemy of enemyShips) {
    const com = getCenterOfMass(enemy.modules);

    for (const module of enemy.modules) {
      drawEnemyShipModule(enemy, module, com);
    }

    const p = worldToScreen(enemy.x, enemy.y);
    const radius = getEnemyShipRadius(enemy) * camera.scale;
    const label = `ENEMY ${enemy.name}`;
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = Math.max(110, ctx.measureText(label).width + 18);
    const x = p.x - width / 2;
    const y = p.y - radius - 30;

    ctx.fillStyle = "rgba(40,0,0,0.88)";
    ctx.fillRect(x, y, width, 22);
    ctx.strokeStyle = "rgba(255,60,60,0.9)";
    ctx.strokeRect(x, y, width, 22);
    ctx.fillStyle = "white";
    ctx.fillText(label, p.x, y + 11);
  }
}

function drawCombatBullets() {
  if (buildMode) return;

  for (const bullet of combatBullets) {
    const p = worldToScreen(bullet.x, bullet.y);
    ctx.fillStyle = bullet.owner === "enemy" ? "#ff3333" : "#66ccff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, 3 * camera.scale), 0, Math.PI * 2);
    ctx.fill();
  }
}
function getSmallShipConfigButtonAt(mx, my) {
  if (!activeSmallShipEdit) return null;

  const width = 235;
  const x = 10;
  const y = Math.min(VIEW.h - 278, 640);
  const buttonH = 26;

  if (mx < x || mx > x + width) return null;
  if (my >= y + 46 && my <= y + 46 + buttonH) return "name";
  if (my >= y + 82 && my <= y + 82 + buttonH) return "mining";
  if (my >= y + 116 && my <= y + 116 + buttonH) return "battle";
  if (my >= y + 150 && my <= y + 150 + buttonH) return "gas";
  if (my >= y + 184 && my <= y + 184 + buttonH) return "solarWind";
  if (my >= y + 218 && my <= y + 218 + buttonH) return "findHangar";

  return null;
}

function handleSmallShipConfigClick(action) {
  if (!activeSmallShipEdit || !action) return false;

  const smallShip = activeSmallShipEdit.ship;
  playSound("toggle", 120);

  if (action === "name") {
    openInputDialog("Ship name", "Name", smallShip.name, "text", name => {
      smallShip.name = makeUniqueShipName(name);
    });
  } else if (action === "mining") {
    smallShip.modeMining = !smallShip.modeMining;
    if (smallShip.modeMining) {
      smallShip.modeBattle = false;
      smallShip.modeGas = false;
      smallShip.modeSolarWind = false;
    }
  } else if (action === "battle") {
    smallShip.modeBattle = !smallShip.modeBattle;
    if (smallShip.modeBattle) {
      smallShip.modeMining = false;
      smallShip.modeGas = false;
      smallShip.modeSolarWind = false;
    }
  } else if (action === "gas") {
    smallShip.modeGas = !smallShip.modeGas;
    if (smallShip.modeGas) {
      smallShip.modeMining = false;
      smallShip.modeBattle = false;
      smallShip.modeSolarWind = false;
    }
  } else if (action === "solarWind") {
    smallShip.modeSolarWind = !smallShip.modeSolarWind;
    if (smallShip.modeSolarWind) {
      smallShip.modeMining = false;
      smallShip.modeBattle = false;
      smallShip.modeGas = false;
    }
  } else if (action === "findHangar") {
    beginFindHangarForSmallShip(smallShip);
  }

  return true;
}

function getSmallShipCargoLimitAt(mx, my) {
  if (!activeSmallShipEdit) return null;

  return smallShipCargoLimitRects.find(rect =>
    mx >= rect.x && mx <= rect.x + rect.w &&
    my >= rect.y && my <= rect.y + rect.h
  ) || null;
}
function beginFindHangarForSmallShip(smallShip) {
  if (activeSmallShipEdit) {
    smallShip.modules = cloneModules(placedModules);
    restoreMotherShipFromSmallEditor();
    activeSmallShipEdit = null;
    buildMode = false;
    ship.angle = savedAngle;
  }

  const currentHangar = getHangarById(smallShip.hangarId);

  if (currentHangar) {
    highlightedHangarId = currentHangar.id;
    hangarHighlightUntil = performance.now() + 2500;
    flash(`${smallShip.name} hangar highlighted`);
    return;
  }

  hangarFindShipId = smallShip.id;
  highlightedHangarId = null;
  flash("Select a free hangar");
}

function assignSmallShipToHangar(smallShip, hangar) {
  if (!smallShip || !isHangarFreeForShip(hangar, smallShip)) return false;

  if (countModuleTiles(smallShip.modules) > getHangarCapacity(hangar.type)) {
    flash("Ship too large for this hangar");
    return false;
  }

  const oldHangar = getHangarById(smallShip.hangarId);
  if (oldHangar && oldHangar.smallShipId === smallShip.id) {
    oldHangar.smallShipId = null;
  }

  hangar.smallShipId = smallShip.id;
  smallShip.hangarId = hangar.id;
  smallShip.hangarType = hangar.type;
  smallShip.capacityTiles = getHangarCapacity(hangar.type);
  smallShip.status = "returning";
  hangarFindShipId = null;
  highlightedHangarId = hangar.id;
  hangarHighlightUntil = performance.now() + 2500;
  flash(`${smallShip.name} assigned to hangar`);
  return true;
}

function handleHangarFindClick(result) {
  if (!hangarFindShipId || !result || !isHangarType(result.module.type)) return false;

  const smallShip = getSmallShipById(hangarFindShipId);
  if (!smallShip) {
    hangarFindShipId = null;
    return false;
  }

  if (!isHangarFreeForShip(result.module, smallShip)) {
    flash("Hangar already occupied");
    return true;
  }

  assignSmallShipToHangar(smallShip, result.module);
  return true;
}
