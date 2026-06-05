function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function worldToScreen(x, y) {
  const cam = buildMode ? buildCamera : camera;

  return {
    x: (x - cam.x) * camera.scale + VIEW.w / 2,
    y: (y - cam.y) * camera.scale + VIEW.h / 2
  };
}

function screenToWorld(x, y) {
  const cam = buildMode ? buildCamera : camera;

  return {
    x: (x - VIEW.w / 2) / camera.scale + cam.x,
    y: (y - VIEW.h / 2) / camera.scale + cam.y
  };
}

function screenToGrid(x, y) {
  const world = screenToWorld(x, y);

  return {
    x: Math.round((world.x - ship.x) / CONFIG.GRID_SIZE),
    y: Math.round((world.y - ship.y) / CONFIG.GRID_SIZE)
  };
}

function rotVec(x, y, a) {
  return {
    x: x * Math.cos(a) - y * Math.sin(a),
    y: x * Math.sin(a) + y * Math.cos(a)
  };
}

function getModuleCenter(m) {
  return {
    x: m.x + (m.w || 1) / 2 - 0.5,
    y: m.y + (m.h || 1) / 2 - 0.5
  };
}

function getCenterOfMass(modules = placedModules) {
  let tx = 0;
  let ty = 0;
  let tc = 0;

  for (const m of modules) {
    const cells = (m.w || 1) * (m.h || 1);
    const center = getModuleCenter(m);

    tx += center.x * cells;
    ty += center.y * cells;
    tc += cells;
  }

  return tc === 0 ? { x: 0, y: 0 } : { x: tx / tc, y: ty / tc };
}

function getModuleHealth(module) {
  return module.hp === undefined ? 1 : module.hp;
}

function damageModule(module, amount) {
  if (!module || amount <= 0) return;
  if (appState === "playing") tutorialEvent("damage");
  module.hp = Math.max(0, getModuleHealth(module) - amount);
  if (module.hp <= 0 && !module._destroyed) {
    module._destroyed = true;
    playSound("explosion", 120);
  }
}

function repairModuleHealth(module, amount) {
  if (!module || amount <= 0) return;
  module.hp = Math.min(1, getModuleHealth(module) + amount);
  if (module.hp >= 0.999) {
    module.hp = 1;
    module._repairCostLevel = undefined;
  }
}

function getMostDamagedModule(modules = placedModules) {
  let worst = null;
  let worstHp = 1;

  for (const module of modules) {
    const hp = getModuleHealth(module);
    if (hp < worstHp) {
      worst = module;
      worstHp = hp;
    }
  }

  return worst;
}

function getCrewWorkDurationSeconds() {
  if ((res.crew || 0) < 1) return Infinity;
  return 10 * Math.pow(2 / 3, Math.max(0, (res.crew || 0) - 1));
}

function canPayRepairChunk() {
  if (adminInstantBuild) return true;
  return (res.gears || 0) >= 1 && (res.circuits || 0) >= 1 && (res.cables || 0) >= 1;
}

function payRepairChunk() {
  if (!canPayRepairChunk()) return false;
  if (adminInstantBuild && ((res.gears || 0) < 1 || (res.circuits || 0) < 1 || (res.cables || 0) < 1)) return true;
  res.gears -= 1;
  res.circuits -= 1;
  res.cables -= 1;
  return true;
}

function applyRepairCosts(module, oldHp, newHp) {
  let oldLevel = Math.floor(oldHp * 10);
  const newLevel = Math.floor(newHp * 10);

  while (oldLevel < newLevel) {
    if (!payRepairChunk()) {
      module.hp = oldLevel / 10;
      return false;
    }
    oldLevel++;
  }

  return true;
}

function drawModuleHealthOverlay(module, sw, sh) {
  const hp = getModuleHealth(module);
  const isRepairing = repairMode && module.id === repairTargetModuleId;
  if (hp >= 0.999 && !isRepairing) return;

  ctx.fillStyle = isRepairing
    ? "rgba(60,255,120,0.32)"
    : hp < 0.5 ? "rgba(255,40,20,0.35)" : "rgba(255,150,20,0.28)";
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh);

  const barW = sw * 0.82;
  const barH = Math.max(3, 4 * camera.scale);
  const barY = -sh / 2 - Math.max(7, 8 * camera.scale);

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(-barW / 2, barY, barW, barH);
  ctx.fillStyle = hp < 0.5 ? "#ff3333" : "#ffaa33";
  ctx.fillRect(-barW / 2, barY, barW * hp, barH);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-barW / 2, barY, barW, barH);
}
function moduleWorldCenter(m) {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();
  const center = getModuleCenter(m);
  const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, ship.angle);

  return {
    x: ship.x + com.x * grid + rel.x,
    y: ship.y + com.y * grid + rel.y
  };
}

function getModuleAtCell(x, y, modules = placedModules) {
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    const w = m.w || 1;
    const h = m.h || 1;

    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        if (m.x + dx === x && m.y + dy === y) {
          return { module: m, index: i };
        }
      }
    }
  }

  return null;
}


function getModuleAtScreen(mx, my) {
  // Used outside build mode: the ship can be rotated, so screenToGrid() alone is not enough.
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();

  for (let i = placedModules.length - 1; i >= 0; i--) {
    const m = placedModules[i];
    const w = m.w || 1;
    const h = m.h || 1;
    const center = getModuleCenter(m);
    const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, ship.angle);
    const p = worldToScreen(ship.x + com.x * grid + rel.x, ship.y + com.y * grid + rel.y);
    const rot = m.rot || 0;
    const drawSize = getDrawSize(w, h, rot);
    const sw = drawSize.w * grid * camera.scale;
    const sh = drawSize.h * grid * camera.scale;

    const dx = mx - p.x;
    const dy = my - p.y;
    const a = -(ship.angle + rot * Math.PI / 2);
    const localX = dx * Math.cos(a) - dy * Math.sin(a);
    const localY = dx * Math.sin(a) + dy * Math.cos(a);

    if (localX >= -sw / 2 && localX <= sw / 2 && localY >= -sh / 2 && localY <= sh / 2) {
      return { module: m, index: i };
    }
  }

  return null;
}

function canPlaceModule(ax, ay, w, h, modules = placedModules) {
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      if (getModuleAtCell(ax + dx, ay + dy, modules)) return false;
    }
  }

  return true;
}

function canPlaceBlueprint(ax, ay, w, h) {
  return canPlaceModule(ax, ay, w, h, placedModules.concat(blueprints));
}

function getBuildBaseModules() {
  return placedModules.filter(module => !demolishSet.has(module.id));
}

function getReachableBlueprints(sourceBlueprints = blueprints) {
  const accepted = [];
  let remaining = sourceBlueprints.map(bp => ({ ...bp }));
  let changed = true;

  while (changed && remaining.length > 0) {
    changed = false;
    const nextRemaining = [];

    for (const bp of remaining) {
      const base = getBuildBaseModules().concat(accepted);
      if (!canPlaceModule(bp.x, bp.y, bp.w, bp.h, base)) {
        nextRemaining.push(bp);
        continue;
      }

      const testModule = {
        id: bp.id,
        x: bp.x,
        y: bp.y,
        type: bp.type,
        w: bp.w,
        h: bp.h,
        rot: bp.rot || 0
      };

      if (isConnected(base.concat(testModule))) {
        accepted.push(bp);
        changed = true;
      } else {
        nextRemaining.push(bp);
      }
    }

    remaining = nextRemaining;
  }

  return accepted;
}

function pruneUnreachableBlueprints() {
  const reachable = getReachableBlueprints();
  const removed = blueprints.length - reachable.length;

  if (removed > 0) {
    blueprints.length = 0;
    blueprints.push(...reachable);
    flash(`${removed} disconnected blueprint(s) removed`);
  }

  return removed;
}

function getBuildToolButtonAt(mx, my) {
  if (!buildMode) return null;

  const y = VIEW.h - 58;
  const exportX = VIEW.w / 2 - 170;
  const importX = VIEW.w / 2 + 10;

  if (mx >= exportX && mx <= exportX + 160 && my >= y && my <= y + 28) {
    return "export";
  }

  if (mx >= importX && mx <= importX + 160 && my >= y && my <= y + 28) {
    return "import";
  }

  return null;
}

function isMouseOverBuildTools() {
  return getBuildToolButtonAt(mouse.x, mouse.y) !== null;
}

function encodeShipData(data) {
  return "SHIP1:" + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

function decodeShipData(code) {
  const trimmed = code.trim();
  const payload = trimmed.startsWith("SHIP1:") ? trimmed.slice(6) : trimmed;
  return JSON.parse(decodeURIComponent(escape(atob(payload))));
}

function getExportableModules() {
  const visibleModules = placedModules
    .filter(module => module.type !== "Computer" && !demolishSet.has(module.id))
    .concat(blueprints);

  return visibleModules.map(module => {
    const data = {
      x: module.x,
      y: module.y,
      t: module.type,
      w: module.w || 1,
      h: module.h || 1,
      r: module.rot || 0
    };

    if (module.tankContent) data.tc = module.tankContent;
    if (module.tankCap) data.tp = module.tankCap;

    return data;
  });
}

function getActiveSmallShipExportSettings() {
  if (!activeSmallShipEdit?.ship) return null;
  const smallShip = activeSmallShipEdit.ship;

  return {
    modeMining: !!smallShip.modeMining,
    modeBattle: !!smallShip.modeBattle,
    modeGas: !!smallShip.modeGas,
    modeSolarWind: !!smallShip.modeSolarWind,
    cargoLimits: JSON.parse(JSON.stringify(smallShip.cargoLimits || {})),
    liquidLimits: JSON.parse(JSON.stringify(smallShip.liquidLimits || {}))
  };
}

function exportShipToClipboard() {
  const data = {
    v: 2,
    modules: getExportableModules(),
    drone: getActiveSmallShipExportSettings()
  };

  if (!data.drone) delete data.drone;
  const code = encodeShipData(data);

  navigator.clipboard.writeText(code)
    .then(() => flash("Ship code copied to clipboard"))
    .catch(() => {
      openInputDialog("Copy ship code", "Ship code", code, "text", () => {});
      flash("Copy ship code manually");
    });
}

function normalizeImportedShip(data) {
  if (!data || !Array.isArray(data.modules)) {
    throw new Error("Invalid ship code");
  }

  return data.modules
    .filter(module => module && module.t && module.t !== "Computer")
    .map(module => normalizeModuleShape({
      x: Number(module.x) || 0,
      y: Number(module.y) || 0,
      type: normalizeModuleType(module.t),
      w: Math.max(1, Number(module.w) || 1),
      h: Math.max(1, Number(module.h) || 1),
      rot: Number(module.r) || 0,
      tankContent: module.tc || undefined,
      tankCap: module.tp || undefined
    }));
}

function normalizeImportedDroneSettings(data) {
  if (!data || typeof data !== "object") return null;

  return {
    modeMining: !!data.modeMining,
    modeBattle: !!data.modeBattle,
    modeGas: !!data.modeGas,
    modeSolarWind: !!data.modeSolarWind,
    cargoLimits: JSON.parse(JSON.stringify(data.cargoLimits || {})),
    liquidLimits: JSON.parse(JSON.stringify(data.liquidLimits || {}))
  };
}

const LEGACY_MODULE_NAME_MAP = {
  "Turret": "Gun Turret",
  "Cannon Tower": "Cannon tower",
  "Railgun Turret": "Railgun turret",
  "Missile Turret": "Missile turret",
  "Laser Turret": "Laser turret",
  "Storage Tray": "Warehouse MK1",
  "Battery": "Battery MK1",
  "Warehouse": "Warehouse MK2",
  "Small Tank": "Tank MK1",
  "Big Tank": "Tank MK2",
  "Tank": "Tank MK2",
  "Small Hangar": "Hangar MK1",
  "Medium Hangar": "Hangar MK2",
  "Big Hangar": "Hangar MK3"
};

function normalizeModuleType(type) {
  const name = String(type || "");
  return LEGACY_MODULE_NAME_MAP[name] || name;
}

function normalizeModuleShape(module) {
  const normalized = { ...module, type: normalizeModuleType(module.type) };
  if (normalized.type === "Laser turret" && (normalized.w || 1) === 2 && (normalized.h || 1) === 3) {
    normalized.w = 3;
    normalized.h = 2;
  }
  return normalized;
}

function validateImportedModulesForCurrentEditor(modules) {
  if (!activeSmallShipEdit) return true;

  if (modules.some(module => isHangarType(module.type))) {
    flash("Drones cannot build hangars");
    return false;
  }

  const projectedTiles = countModuleTiles(placedModules) + countModuleTiles(blueprints) + countModuleTiles(modules);

  if (projectedTiles > activeSmallShipEdit.capacityTiles) {
    flash("Imported ship exceeds hangar size limit");
    return false;
  }

  return true;
}

function importShipFromCode() {
  openInputDialog("Import ship", "Paste ship code", "", "text", code => {
    if (!code) return;

    try {
      const decoded = decodeShipData(code);
      const modules = normalizeImportedShip(decoded);

      if (modules.length === 0) {
        flash("Ship code has no modules");
        return;
      }

      if (!validateImportedModulesForCurrentEditor(modules)) {
        importedShipGhost = null;
        return;
      }

      importedShipGhost = { modules, droneSettings: normalizeImportedDroneSettings(decoded?.drone) };
      heldItem = AIR;
      lastBlueprintKey = "";
      flash("Ship ghost ready");
    } catch (error) {
      importedShipGhost = null;
      flash("Invalid ship code");
    }
  });
}


function isHangarType(type) {
  return type === "Hangar MK1" || type === "Hangar MK2" || type === "Hangar MK3";
}

function getHangarCapacity(type) {
  return BUILDING_STATS[type]?.hangarCapacityTiles || 0;
}

function countModuleTiles(modules) {
  return modules.reduce((sum, module) => sum + (module.w || 1) * (module.h || 1), 0);
}

function getMassAccelerationFactor(modules = placedModules) {
  const tiles = Math.max(1, countModuleTiles(modules));
  return Math.max(0.32, Math.min(1.8, Math.sqrt(18 / tiles)));
}

function clampVelocity(body, maxSpeed = MAX_SHIP_SPEED) {
  const speed = Math.hypot(body.vx || 0, body.vy || 0);
  if (speed <= maxSpeed || speed <= 0.0001) return;

  body.vx = (body.vx / speed) * maxSpeed;
  body.vy = (body.vy / speed) * maxSpeed;
}

function canAccelerateWithVelocity(vx, vy, ax, ay, maxSpeed = MAX_SHIP_SPEED) {
  const speed = Math.hypot(vx, vy);
  if (speed < maxSpeed - 0.01) return true;
  return vx * ax + vy * ay <= 0;
}

function makeUniqueShipName(wantedName = "") {
  let base = wantedName.trim();

  if (!base) {
    do {
      base = `Drone${nextAutoShipNumber++}`;
    } while (smallShips.some(shipData => shipData.name === base));
    return base;
  }

  if (!smallShips.some(shipData => shipData.name === base)) return base;

  let index = 2;
  let candidate = `${base} ${index}`;
  while (smallShips.some(shipData => shipData.name === candidate)) {
    index++;
    candidate = `${base} ${index}`;
  }

  return candidate;
}

function enemyModule(x, y, type, w = 1, h = 1, rot = 0, extra = {}) {
  return { x, y, type, w, h, rot, ...extra };
}

function enemySolarSpine(minY, maxY) {
  const modules = [];

  for (let y = minY; y <= maxY; y++) {
    if (y !== 0) modules.push(enemyModule(0, y, "Solar Panel"));
  }

  return modules;
}

const ENEMY_SHIP_DESIGNS = [
  {
    id: 1,
    name: "Scout Needle",
    role: "patrol",
    ammo: 0,
    resources: { fuel: 100, water: 0, uranium: 0 },
    modules: [
      enemyModule(-1, 0, "Solar Panel"),
      enemyModule(1, 0, "Solar Panel"),
      enemyModule(0, 1, "Battery MK1", 1, 2, 2),
      enemyModule(0, -1, "Tank MK1", 1, 1, 0, { tankContent: "fuel", tankCap: 100 }),
      enemyModule(0, -3, "RCS Thruster", 1, 2, 2),
      enemyModule(1, 1, "RCS Thruster", 1, 2, 0),
      enemyModule(-1, -2, "Shield Generator", 1, 2, 2),
      enemyModule(-1, 1, "Solar Panel"),
      enemyModule(-1, 2, "Warehouse MK1"),
      enemyModule(1, -2, "Asteroid Collector"),
      enemyModule(1, -1, "Solar Panel")
    ]
  },
  {
    id: 2,
    name: "Picket Guard",
    role: "patrol",
    ammo: 20,
    resources: { fuel: 100, water: 0, uranium: 0 },
    modules: [
      enemyModule(-1, 0, "Solar Panel"),
      enemyModule(0, 1, "Battery MK1", 1, 2, 2),
      enemyModule(0, -1, "Tank MK1", 1, 1, 0, { tankContent: "fuel", tankCap: 100 }),
      enemyModule(0, -3, "RCS Thruster", 1, 2, 2),
      enemyModule(1, 1, "RCS Thruster", 1, 2, 0),
      enemyModule(-1, -2, "Shield Generator", 1, 2, 2),
      enemyModule(-1, 1, "Solar Panel"),
      enemyModule(-1, 2, "Warehouse MK1"),
      enemyModule(1, -2, "Asteroid Collector"),
      enemyModule(-2, 0, "Solar Panel"),
      enemyModule(-2, 1, "Solar Panel"),
      enemyModule(1, -1, "Turret", 2, 2, 0),
      enemyModule(2, 1, "Shield Generator", 1, 2, 0),
      enemyModule(-2, -1, "Solar Panel"),
      enemyModule(-2, 2, "Solar Panel"),
      enemyModule(2, -2, "Solar Panel"),
      enemyModule(-2, -2, "Solar Panel")
    ]
  },
  {
    id: 3,
    name: "Miner Escort",
    role: "miner",
    ammo: 50,
    resources: { fuel: 100, water: 0, uranium: 0 },
    modules: [
      enemyModule(-1, 0, "Solar Panel"),
      enemyModule(0, 1, "Battery MK1", 1, 2, 2),
      enemyModule(0, -1, "Tank MK1", 1, 1, 0, { tankContent: "fuel", tankCap: 100 }),
      enemyModule(0, -3, "RCS Thruster", 1, 2, 2),
      enemyModule(1, 1, "RCS Thruster", 1, 2, 0),
      enemyModule(-1, -2, "Shield Generator", 1, 2, 2),
      enemyModule(-1, 2, "Warehouse MK1"),
      enemyModule(1, -1, "Turret", 2, 2, 0),
      enemyModule(2, 1, "Shield Generator", 1, 2, 0),
      enemyModule(-2, 2, "Solar Panel"),
      enemyModule(-2, -2, "Solar Panel"),
      enemyModule(1, -2, "Shield Generator", 2, 1, 3),
      enemyModule(-2, 1, "Shield Generator", 2, 1, 1),
      enemyModule(-3, 1, "Solar Panel"),
      enemyModule(-3, 2, "Solar Panel"),
      enemyModule(3, 2, "Solar Panel"),
      enemyModule(3, 1, "Solar Panel"),
      enemyModule(3, 0, "Solar Panel"),
      enemyModule(3, -1, "Solar Panel"),
      enemyModule(-2, 3, "Solar Panel"),
      enemyModule(-1, 3, "Solar Panel"),
      enemyModule(0, 3, "Solar Panel"),
      enemyModule(1, 3, "Solar Panel"),
      enemyModule(2, 3, "Solar Panel"),
      enemyModule(-3, -1, "Turret", 2, 2, 0),
      enemyModule(-2, -3, "Drill"),
      enemyModule(-1, -3, "Drill"),
      enemyModule(1, -3, "Drill"),
      enemyModule(2, -3, "Drill")
    ]
  },
  {
    id: 4,
    name: "Shield Miner",
    role: "miner",
    ammo: 100,
    resources: { fuel: 120, water: 0, uranium: 0 },
    modules: [
      ...enemySolarSpine(-5, 5),
      enemyModule(0, 1, "Battery MK1", 1, 2, 2),
      enemyModule(0, 3, "Shield Generator", 1, 2, 0),
      enemyModule(0, -1, "Tank MK1", 1, 1, 0, { tankContent: "fuel", tankCap: 100 }),
      enemyModule(1, 2, "RCS Thruster", 1, 2, 0),
      enemyModule(-1, 2, "RCS Thruster", 1, 2, 0),
      enemyModule(-4, 0, "Shield Generator", 2, 1, 1),
      enemyModule(3, 0, "Shield Generator", 2, 1, 3),
      enemyModule(1, -4, "Turret", 2, 2, 0),
      enemyModule(-2, -4, "Turret", 2, 2, 0),
      enemyModule(-4, -2, "Turret", 2, 2, 0),
      enemyModule(3, -2, "Turret", 2, 2, 0),
      enemyModule(-2, -5, "Drill"),
      enemyModule(-1, -5, "Drill"),
      enemyModule(0, -5, "Drill"),
      enemyModule(1, -5, "Drill"),
      enemyModule(2, -5, "Drill"),
      enemyModule(-3, -4, "Warehouse MK1"),
      enemyModule(-3, -3, "Warehouse MK1")
    ]
  },
  {
    id: 5,
    name: "Crew Gunship",
    role: "miner",
    ammo: 200,
    crew: 3,
    resources: { fuel: 140, water: 120, uranium: 0, food: 80 },
    modules: [
      ...enemySolarSpine(-6, 5),
      enemyModule(0, 1, "Battery MK1", 1, 2, 2),
      enemyModule(1, 0, "Quarters", 2, 2, 0),
      enemyModule(-2, 0, "Life Support", 2, 2, 0),
      enemyModule(-1, -2, "Farm Module", 3, 1, 1),
      enemyModule(1, -4, "Turret", 2, 2, 0),
      enemyModule(-4, -2, "Turret", 2, 2, 0),
      enemyModule(3, -2, "Turret", 2, 2, 0),
      enemyModule(-2, -4, "Turret", 2, 2, 0),
      enemyModule(-3, -3, "Warehouse MK1"),
      enemyModule(4, 1, "RCS Thruster", 2, 1, 3),
      enemyModule(1, 4, "RCS Thruster", 1, 2, 0),
      enemyModule(-1, 4, "RCS Thruster", 1, 2, 0),
      enemyModule(-5, 1, "RCS Thruster", 2, 1, 1),
      enemyModule(4, 0, "Shield Generator", 2, 1, 3),
      enemyModule(-5, 0, "Shield Generator", 2, 1, 1),
      enemyModule(0, 4, "Shield Generator", 1, 2, 0),
      enemyModule(0, -5, "Shield Generator", 1, 2, 2),
      enemyModule(-2, -6, "Drill"),
      enemyModule(-1, -6, "Drill"),
      enemyModule(0, -6, "Drill"),
      enemyModule(1, -6, "Drill"),
      enemyModule(2, -6, "Drill")
    ]
  },
  {
    id: 6,
    name: "Carrier Miner",
    role: "miner",
    ammo: 260,
    crew: 5,
    resources: { fuel: 600, water: 600, uranium: 80, food: 120 },
    hangarDesignId: 2,
    modules: [
      ...enemySolarSpine(-8, 8),
      enemyModule(-1, -1, "Farm Module", 3, 1, 3),
      enemyModule(-3, -1, "Life Support", 2, 2, 0),
      enemyModule(2, -1, "Quarters", 2, 2, 0),
      enemyModule(2, 1, "Assembler", 2, 3, 0),
      enemyModule(-3, 1, "Electrolyser", 2, 1, 1),
      enemyModule(-3, 2, "Electrolyser", 2, 1, 1),
      enemyModule(-1, 1, "Fuel Processor", 3, 2, 1),
      enemyModule(-1, 0, "Warehouse MK1", 1, 1, 1),
      enemyModule(1, 0, "Warehouse MK1", 1, 1, 1),
      enemyModule(-1, 3, "Hangar MK1", 3, 4, 0),
      enemyModule(-3, -3, "Tank MK2", 2, 2, 0, { tankContent: "fuel", tankCap: 600 }),
      enemyModule(2, -3, "Tank MK2", 2, 2, 0, { tankContent: "water", tankCap: 600 }),
      enemyModule(-5, -1, "Shield Generator", 2, 1, 1),
      enemyModule(4, -1, "Shield Generator", 2, 1, 3),
      enemyModule(-5, 0, "Turret", 2, 2, 0),
      enemyModule(4, 0, "Turret", 2, 2, 0),
      enemyModule(-5, -5, "Turret", 2, 2, 0),
      enemyModule(4, -5, "Turret", 2, 2, 0),
      enemyModule(-2, -6, "Drill"),
      enemyModule(-1, -6, "Drill"),
      enemyModule(0, -6, "Drill"),
      enemyModule(1, -6, "Drill"),
      enemyModule(2, -6, "Drill"),
      enemyModule(-3, 3, "Reactor", 2, 2, 0),
      enemyModule(2, 5, "Condenserturbine", 2, 2, 0),
      enemyModule(-3, 5, "Condenserturbine", 2, 2, 0),
      enemyModule(-1, -4, "Smelter", 3, 3, 0),
      enemyModule(-3, -5, "RCS Thruster", 1, 2, 2),
      enemyModule(3, -5, "RCS Thruster", 1, 2, 2),
      enemyModule(-3, 7, "RCS Thruster", 1, 2, 0),
      enemyModule(3, 7, "RCS Thruster", 1, 2, 0)
    ]
  }
];
