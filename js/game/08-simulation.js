function updateBuildCamera() {
  if (!buildMode) return;

  const speed = 8 / camera.scale;

  if (keys.w) buildCamera.y -= speed;
  if (keys.s) buildCamera.y += speed;
  if (keys.a) buildCamera.x -= speed;
  if (keys.d) buildCamera.x += speed;

  if (dragging) {
    buildCamera.x -= (mouse.x - dragStart.x) / camera.scale;
    buildCamera.y -= (mouse.y - dragStart.y) / camera.scale;

    dragStart.x = mouse.x;
    dragStart.y = mouse.y;
  }
}

function updateBuildMode() {
  if (!buildMode || !hoveredGrid) return;
  if (isMouseOverInventory()) return;
  if (importedShipGhost) return;
  if (!mouseDown || heldItem === AIR || dragging) return;

  const grid = screenToGrid(mouse.x, mouse.y);
  if (activeSmallShipEdit && isHangarType(heldItem.name)) {
    flash("Drones cannot build hangars");
    return;
  }

  const [w, h] = getRotatedSize(heldItem);
  const anchor = getAnchorForItem(grid, heldItem);
  const key = `${heldItem.id}:${anchor.x}:${anchor.y}:${w}:${h}:${rotation}`;

  if (key === lastBlueprintKey) return;

  const projectedTiles = activeSmallShipEdit
    ? countModuleTiles(placedModules) + countModuleTiles(blueprints) + w * h
    : 0;

  if (activeSmallShipEdit && projectedTiles > activeSmallShipEdit.capacityTiles) {
    flash("Hangar ship size limit reached");
    return;
  }

  if (canPlaceBlueprint(anchor.x, anchor.y, w, h)) {
    blueprints.push({
      id: nextModuleId++,
      x: anchor.x,
      y: anchor.y,
      type: heldItem.name,
      w,
      h,
      rot: rotation
    });

    lastBlueprintKey = key;
  }
}

function processCommit() {
  if (!commitPending) return;

  if (adminInstantBuild) {
    // --- ADMIN MODE: instant batch build/demolish (original behaviour) ---
    if (performance.now() - commitStartTime < 1000) return;

    const dem = commitSnapshot.demolish;
    const bps = commitSnapshot.blueprints;

    // Demolish (outermost first, same as before)
    let next = placedModules.slice();
    const computer = next.find(m => m.type === "Computer") || next[0];
    const pendingDemolish = new Set(
      [...dem].filter(id => {
        const module = next.find(m => m.id === id);
        return module && module.type !== "Computer";
      })
    );
    let removedAny = true;
    while (removedAny && pendingDemolish.size > 0) {
      removedAny = false;
      const candidates = [...pendingDemolish]
        .map(id => next.find(module => module.id === id))
        .filter(Boolean)
        .sort((a, b) => {
          const ac = getModuleCenter(a);
          const bc = getModuleCenter(b);
          const cc = getModuleCenter(computer);
          const ad = Math.abs(ac.x - cc.x) + Math.abs(ac.y - cc.y);
          const bd = Math.abs(bc.x - cc.x) + Math.abs(bc.y - cc.y);
          return bd - ad;
        });
      for (const module of candidates) {
        const candidate = next.filter(m => m.id !== module.id);
        if (isConnected(candidate)) {
          next = candidate;
          refundBuildCost(module);
          pendingDemolish.delete(module.id);
          removedAny = true;
        }
      }
    }
    if (pendingDemolish.size > 0) {
      flash(`${pendingDemolish.size} module(s) still needed for ship structure`);
    }

    // Build (iterative batch)
    let pending = bps.slice();
    let placedAny = true;
    while (placedAny && pending.length > 0) {
      placedAny = false;
      const stillPending = [];
      for (const bp of pending) {
        if (!canPlaceModule(bp.x, bp.y, bp.w, bp.h, next)) continue;
        const testModule = { id: -1, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0 };
        if (isConnected(next.concat(testModule))) {
          if (!payCost(BUILD_COSTS[bp.type])) {
            flash(`Build needs ${getMissingCostText(BUILD_COSTS[bp.type])}`);
            stillPending.push(bp);
            continue;
          }
          const builtModule = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: false };
          next.push(builtModule);
          notifyTutorialModuleBuilt(builtModule.type);
          placedAny = true;
        } else {
          stillPending.push(bp);
        }
      }
      pending = stillPending;
    }
    if (pending.length > 0) {
      flash(`${pending.length} blueprint(s) not reachable - skipped`);
    }

    placedModules.length = 0;
    placedModules.push(...next);
    clearAsteroidsNearShip();
    blueprints.length = 0;
    demolishSet.clear();
    commitPending = false;
    commitSnapshot = null;
    return;
  }

  // --- NORMAL MODE: one module at a time, crew-speed gated ---
  if (repairMode && getMostDamagedModule()) {
    flash("Repairs must finish before build work");
    return;
  }

  const waitMs = getCrewWorkDurationSeconds() * 1000;
  if (!isFinite(waitMs)) {
    flash("Crew needed for build work");
    blueprints.length = 0;
    blueprints.push(...(commitSnapshot.blueprints || []));
    demolishSet.clear();
    commitPending = false;
    commitSnapshot = null;
    return;
  }

  if (performance.now() - commitStartTime < waitMs) return;

  const dem = commitSnapshot.demolish;
  const bps = commitSnapshot.blueprints;

  // Helper: Manhattan distance from module center to computer center
  function distToComputer(module, computerCenter) {
    const c = getModuleCenter(module);
    return Math.abs(c.x - computerCenter.x) + Math.abs(c.y - computerCenter.y);
  }

  // Helper: does a module (by grid rect) touch any module in a given set?
  function touchesAny(bp, moduleList) {
    const bx1 = bp.x;
    const by1 = bp.y;
    const bx2 = bp.x + (bp.w || 1) - 1;
    const by2 = bp.y + (bp.h || 1) - 1;
    for (const m of moduleList) {
      const mx1 = m.x;
      const my1 = m.y;
      const mx2 = m.x + (m.w || 1) - 1;
      const my2 = m.y + (m.h || 1) - 1;
      // Adjacent = overlapping or touching on any side
      if (bx1 <= mx2 + 1 && bx2 >= mx1 - 1 && by1 <= my2 + 1 && by2 >= my1 - 1) {
        // Exclude diagonal-only touches: at least one axis must share an edge
        const overlapX = Math.min(bx2, mx2) - Math.max(bx1, mx1);
        const overlapY = Math.min(by2, my2) - Math.max(by1, my1);
        if (overlapX >= 0 || overlapY >= 0) return true;
      }
    }
    return false;
  }

  let processedOne = false;

  // --- Step 1: Try to demolish one module (outermost first) ---
  if (dem.size > 0) {
    const current = placedModules.slice();
    const computer = current.find(m => m.type === "Computer") || current[0];
    const computerCenter = getModuleCenter(computer);

    const candidates = [...dem]
      .map(id => current.find(m => m.id === id))
      .filter(m => m && m.type !== "Computer")
      // Sort farthest from computer first (outermost first for demolish)
      .sort((a, b) => distToComputer(b, computerCenter) - distToComputer(a, computerCenter));

    for (const module of candidates) {
      const candidate = current.filter(m => m.id !== module.id);
      if (isConnected(candidate)) {
        placedModules.length = 0;
        placedModules.push(...candidate);
        refundBuildCost(module);
        dem.delete(module.id);
        processedOne = true;
        commitStartTime = performance.now();
        break;
      }
    }

    if (!processedOne && dem.size > 0) {
      flash(`${dem.size} module(s) still needed for ship structure`);
      dem.clear();
    }
  }

  // --- Step 2: If no demolish was done, try to build one blueprint ---
  if (!processedOne && bps.length > 0) {
    const current = placedModules.slice();
    const computer = current.find(m => m.type === "Computer") || current[0];
    const computerCenter = getModuleCenter(computer);

    // Collect placeable candidates: physically fits + connected
    const placeable = bps.filter(bp => {
      if (!canPlaceModule(bp.x, bp.y, bp.w, bp.h, current)) return false;
      const testModule = { id: -1, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0 };
      return isConnected(current.concat(testModule));
    });

    // Sort by distance to computer (closest first)
    placeable.sort((a, b) => {
      const ac = getModuleCenter(a);
      const bc = getModuleCenter(b);
      const ad = Math.abs(ac.x - computerCenter.x) + Math.abs(ac.y - computerCenter.y);
      const bd = Math.abs(bc.x - computerCenter.x) + Math.abs(bc.y - computerCenter.y);
      return ad - bd;
    });

    // Try to build the closest one we can afford; if not affordable,
    // skip to the next closest that is adjacent to an already-built module.
    let builtIndex = -1;
    for (let i = 0; i < placeable.length; i++) {
      const bp = placeable[i];
      if (payCost(BUILD_COSTS[bp.type])) {
        const builtModule = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: true };
        current.push(builtModule);
        notifyTutorialModuleBuilt(builtModule.type);
        // Find and remove this bp from bps array
        const idx = bps.indexOf(bp);
        if (idx !== -1) bps.splice(idx, 1);
        placedModules.length = 0;
        placedModules.push(...current);
        processedOne = true;
        commitStartTime = performance.now();
        builtIndex = i;
        break;
      } else {
        // Can't afford the closest: look for a cheaper one that touches already-built modules
        if (i === 0) {
          flash(`Build needs ${getMissingCostText(BUILD_COSTS[bp.type])}`);
        }
      }
    }

    // If we couldn't build the closest, try others that touch placed modules and are affordable
    if (!processedOne) {
      for (let i = 1; i < placeable.length; i++) {
        const bp = placeable[i];
        if (!touchesAny(bp, placedModules)) continue;
        if (payCost(BUILD_COSTS[bp.type])) {
          const toPlace = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: true };
          placedModules.push(toPlace);
          notifyTutorialModuleBuilt(toPlace.type);
          const idx = bps.indexOf(bp);
          if (idx !== -1) bps.splice(idx, 1);
          processedOne = true;
          commitStartTime = performance.now();
          break;
        }
      }
    }
  }

  const noBuildWorkPossible = !processedOne && dem.size === 0 && bps.length > 0;

  if (noBuildWorkPossible) {
    flash(`${bps.length} blueprint(s) waiting for resources or connection`);
  }

  // --- Finalize if everything is done or no current work can progress ---
  if (dem.size === 0 && (bps.length === 0 || noBuildWorkPossible)) {
    clearAsteroidsNearShip();
    blueprints.length = 0;
    if (noBuildWorkPossible) blueprints.push(...bps);
    demolishSet.clear();
    commitPending = false;
    commitSnapshot = null;
  }
}

function updateResources(dt) {
  const previousSnapshot = {};

  for (const key of RESOURCE_RATE_KEYS) {
    previousSnapshot[key] = res[key] || 0;
  }

  res.energyCap = 0;
  res.waterCap = 0;
  res.fuelCap = 0;
  res.hydrogenCap = 0;
  res.oxygenCap = 0;
  res.deuteriumCap = 0;
  res.tritiumCap = 0;
  res.helium3Cap = 0;
  res.crewCap = 0;
  res.itemCap = 0;
  res.itemUsed = 0;
  res.foodCap = 0;
  res.steamCap = 0;

  for (const m of placedModules) {
    if (m.tankContent && m.tankCap) {
      const key = m.tankContent + "Cap";
      if (res[key] !== undefined) res[key] += m.tankCap;
    }

    const stats = BUILDING_STATS[m.type];
    if (!stats) continue;

    if (stats.energyCap) res.energyCap += stats.energyCap;
    if (stats.crewCap) res.crewCap += stats.crewCap;
    if (stats.itemCap) res.itemCap += stats.itemCap;
  }

  const solarFactor = getSolarEfficiency();
  res.itemUsed = getSolidStorageUsed();

  let eProd = placedModules.reduce((sum, module) => {
    const stats = BUILDING_STATS[module.type];
    return sum + (stats?.energyProdBase || 0) * solarFactor;
  }, 0);
  let eUse = 0;
  const wasPowered = res.energy > 0;
  const hasPower = () => res.energy > 0 || eProd > eUse;

  for (const m of placedModules) {
    m._machineActive = null;
    const stats = BUILDING_STATS[m.type];
    if (!stats) continue;

    if (m.type === "Turbine" && res.steam >= stats.steamUse * dt) {
      const steam = Math.min(stats.steamUse * dt, res.steam);
      res.steam -= steam;
      eProd += stats.energyProd * (steam / (stats.steamUse * dt));
      m._machineActive = "turbine";
    }

    if (m.type === "Reactor" && res.uranium >= stats.uraniumUse * dt && res.water >= stats.waterUse * dt) {
      res.uranium -= stats.uraniumUse * dt;
      res.water -= stats.waterUse * dt;
      res.steam = Math.min(res.steamCap || 1000, res.steam + stats.steamProd * dt);
    }

    if (m.type === "Fusion Reactor") {
      const fusionFuel = m.fusionFuelMode === "helium3" ? "helium3" : "tritium";
      const fusionFuelUse = fusionFuel === "helium3" ? stats.helium3Use : stats.tritiumUse;

      if (res.deuterium >= stats.deuteriumUse * dt && res[fusionFuel] >= fusionFuelUse * dt && res.water >= stats.waterUse * dt) {
      res.deuterium -= stats.deuteriumUse * dt;
      res[fusionFuel] -= fusionFuelUse * dt;
      res.water -= stats.waterUse * dt;
      res.steam = Math.min(res.steamCap || 4000, res.steam + stats.steamProd * dt);
      }
    }

    if (m.type === "Condenserturbine" && res.steam >= stats.steamUse * dt) {
      const steam = Math.min(stats.steamUse * dt, res.steam);
      res.steam -= steam;
      eProd += stats.energyProd * (steam / (stats.steamUse * dt));
      storeResource("water", stats.waterProd * dt);
      m._machineActive = "turbine";
    }

    if (m.type === "Electrolyser" && hasPower() && res.water >= stats.waterUse * dt) {
      res.water -= stats.waterUse * dt;
      res.hydrogen = Math.min(res.hydrogenCap || 999, res.hydrogen + stats.hydrogenProd * dt);
      res.oxygen = Math.min(res.oxygenCap || 999, res.oxygen + stats.oxygenProd * dt);
      eUse += stats.energyUse;
    }

    if (m.type === "Fuel Processor" && hasPower() && res.hydrogen >= stats.hydrogenUse * dt && res.oxygen >= stats.oxygenUse * dt) {
      res.hydrogen -= stats.hydrogenUse * dt;
      res.oxygen -= stats.oxygenUse * dt;
      res.fuel = Math.min(res.fuelCap || 999, res.fuel + stats.fuelProd * dt);
      eUse += stats.energyUse;
    }

    if (m.type === "Smelter" && hasPower()) {
      const recipes = [
        { input: "ironOre", output: "ironPlate" },
        { input: "copperOre", output: "copperPlate" },
        { input: "siliconOre", output: "silicon" }
      ];
      const recipe = recipes.find(entry => (res[entry.input] || 0) >= stats.oreUse * dt);

      if (recipe) {
        res[recipe.input] -= stats.oreUse * dt;
        storeResource(recipe.output, stats.materialProd * dt);
        eUse += stats.energyUse;
        m._machineActive = "smelter";
      }
    }

    if (m.type === "Assembler" && hasPower()) {
      const product = getAssemblerProduct(m);
      const recipe = BUILDING_STATS.Assembler?.recipes?.[product];
      if (recipe) {
        m._assemblerTimer = (m._assemblerTimer || 0) + dt;
        eUse += stats.energyUse;
        m._machineActive = "assembler";

        if (m._assemblerTimer >= 1) {
          m._assemblerTimer = 0;

          const canCraft = Object.entries(recipe.inputs || {})
            .every(([key, amount]) => (res[key] || 0) >= amount);

          if (canCraft) {
            for (const [key, amount] of Object.entries(recipe.inputs || {})) {
              res[key] -= amount;
            }

            for (const [key, amount] of Object.entries(recipe.outputs || {})) {
              storeResource(key, amount);
            }
          }
        }
      }
    }

    if (m.type === "Farm Module" && hasPower() && res.water >= stats.waterUse * dt) {
      res.water -= stats.waterUse * dt;
      storeResource("food", stats.foodProd * dt);
      eUse += stats.energyUse;
    }

    if (m.type === "Life Support" && hasPower() && res.water >= stats.waterUse * dt) {
      res.water -= stats.waterUse * dt;
      eUse += stats.energyUse;
    }

    if (m.type === "Asteroid Collector" && hasPower()) {
      eUse += stats.energyUse;

      if (m._collectorTimer === undefined) {
        m._collectorTimer = 10 + Math.random() * 10;
      }

      const collectors = placedModules.filter(module => module.type === "Asteroid Collector").length;
      const efficiency = Math.min(4, Math.pow(Math.max(1, collectors), 0.585));
      m._collectorTimer -= dt * (efficiency / Math.max(1, collectors));

      if (m._collectorTimer <= 0) {
        const resource = COLLECTOR_SOLID_POOL[Math.floor(Math.random() * COLLECTOR_SOLID_POOL.length)];
        if (storeResource(resource, 1) > 0) playSound("items", 900);
        m._collectorTimer = 10 + Math.random() * 10;
      }
    }

    if (m.type === "Drill" && hasPower()) {
      eUse += stats.energyUse;
      const waterPlanet = findWaterPlanetForDrill(m);
      const target = waterPlanet ? null : findAsteroidForDrill(m);

      if (waterPlanet) {
        const accepted = storeResource("water", 100 * dt);
        if (accepted > 0 && performance.now() - (m._lastCollectSoundAt || 0) > 1800) {
          playSound("items", 1600);
          m._lastCollectSoundAt = performance.now();
        }
        m._drillTarget = waterPlanet;
        m._drillProgress = 0;
        m._machineActive = "drill";
      } else if (target) {
        if (m._drillTarget !== target) {
          m._drillTarget = target;
          m._drillProgress = 0;
          if (m._lastDrillSoundTarget !== target) {
            playSound("drill", 500);
            m._lastDrillSoundTarget = target;
          }
        }

        m._drillProgress = (m._drillProgress || 0) + dt;
        m._machineActive = "drill";

        if (m._drillProgress >= stats.drillTime) {
          harvestAsteroid(target);
          m._drillTarget = null;
          m._lastDrillSoundTarget = null;
          m._drillProgress = 0;
        }
      } else {
        m._drillTarget = null;
        m._drillProgress = 0;
      }
    }

    if (m.type === "Scooper" && hasPower()) {
      const planet = findNearestGasPlanet(ship.x, ship.y, CONFIG.GRID_SIZE * 8);
      if (planet) {
        eUse += stats.energyUse;
        const acceptedHydrogen = storeResource("hydrogen", stats.gasCollectRate * 0.8 * dt);
        const acceptedDeuterium = storeResource("deuterium", stats.gasCollectRate * 0.2 * dt);
        if ((acceptedHydrogen + acceptedDeuterium) > 0 && performance.now() - (m._lastCollectSoundAt || 0) > 1800) {
          playSound("items", 1600);
          m._lastCollectSoundAt = performance.now();
        }
        m._machineActive = "collector";
      }
    }

    if (m.type === "Solar Wind Collector" && hasPower()) {
      const star = findNearestStar(ship.x, ship.y, CONFIG.GRID_SIZE * 12);
      if (star) {
        eUse += stats.energyUse;
        const accepted = storeResource("helium3", stats.helium3CollectRate * dt);
        if (accepted > 0 && performance.now() - (m._lastCollectSoundAt || 0) > 1800) {
          playSound("items", 1600);
          m._lastCollectSoundAt = performance.now();
        }
        m._machineActive = "collector";
      }
    }

    if (m.type === "Turret" && turretsActive && hasPower()) {
      eUse += stats.energyUse;
    }
  }

  const crewFoodUse = res.crew * 0.25;
  if (crewFoodUse > 0) {
    res.food = Math.max(0, res.food - crewFoodUse * dt);
  }

  res.energyNet = eProd - eUse;
  const energyCap = Math.max(0, res.energyCap || 0);
  res.energy = energyCap > 0
    ? Math.max(0, Math.min(energyCap, res.energy + res.energyNet * dt))
    : 0;

  if (wasPowered && res.energy <= 0 && eUse > 0) {
    playSound("powerOff", 900);
  }

  for (const key of ["water", "steam", "hydrogen", "oxygen", "fuel", "ironOre", "copperOre", "siliconOre", "ironPlate", "copperPlate", "silicon", "nickel", "carbon", "deuterium", "tritium", "helium3", "uranium", "food", "ammo"]) {
    res[key] = Math.max(0, res[key]);
  }

  for (const key of RESOURCE_RATE_KEYS) {
    if (key === "energy") continue;

    const now = res[key] || 0;
    const previous = previousSnapshot[key] || 0;
    resourceRateDelta[key] = (resourceRateDelta[key] || 0) + (now - previous);
  }

  resourceRateDelta.energy = (resourceRateDelta.energy || 0) + res.energyNet * dt;
  resourceRateTimer += dt;

  if (resourceRateTimer >= 1) {
    for (const key of RESOURCE_RATE_KEYS) {
      resourceRates[key] = (resourceRateDelta[key] || 0) / resourceRateTimer;
      resourceRateDelta[key] = 0;
    }

    resourceRateTimer = 0;
  }

  updatePlanetMining(dt); // Passiver Ressourcenabbau wenn gelandet
  removeEmptyAsteroids();
}

function destroyShip(message, source) {
  if (source?.type === "blackhole" && appState === "playing") {
    startEndWorldFromBlackHole();
    return;
  }

  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;
  flash(message);

  if (message === "Ship destroyed" && appState === "playing") {
    appState = "menu";
    buildMode = false;
    selectedMenuSaveSlot = null;
    saveSelectionMode = null;
    pendingSavePayload = null;
    pendingOverwriteSlot = null;
    stopAllLoopSounds();
  }
}

function isAsteroidInShield(asteroid) {
  for (const module of placedModules) {
    if (module.type !== "Shield Generator") continue;

    const shieldCost = BUILDING_STATS[module.type]?.impactEnergyUse || 20;
    if (res.energy < shieldCost) continue;

    const center = moduleWorldCenter(module);
    const dx = asteroid.x - center.x;
    const dy = asteroid.y - center.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 4 * CONFIG.GRID_SIZE + asteroid.size) continue;

    const outDir = ship.angle + (module.rot || 0) * Math.PI / 2 + Math.PI / 2;
    const asteroidAngle = Math.atan2(dy, dx);

    if (Math.abs(normalizeAngle(asteroidAngle - outDir)) <= Math.PI / 2) {
      res.energy = Math.max(0, res.energy - shieldCost);
      return true;
    }
  }

  return false;
}

function getShipCollisionRadius() {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();
  let radius = grid * 0.75;

  for (const module of placedModules) {
    const center = getModuleCenter(module);
    const dx = (center.x - com.x) * grid;
    const dy = (center.y - com.y) * grid;
    const moduleRadius = Math.max(module.w || 1, module.h || 1) * grid * 0.55;
    radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy) + moduleRadius);
  }

  return radius;
}

function collidesAsteroidWithShip(asteroid) {
  const hits = [];

  for (const module of placedModules) {
    const center = moduleWorldCenter(module);
    const dx = asteroid.x - center.x;
    const dy = asteroid.y - center.y;
    const moduleRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.55;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= asteroid.size + moduleRadius) {
      hits.push({ module, dist });
    }
  }

  return hits
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5)
    .map(hit => hit.module);
}

function getMostDamagedSmallShipModule(smallShip) {
  let worst = null;
  let worstHp = 1;

  for (const module of smallShip.modules || []) {
    const hp = getModuleHealth(module);
    if (hp < worstHp) {
      worst = module;
      worstHp = hp;
    }
  }

  return worst;
}

function getCrewWorkDurationForCrew(crew) {
  if ((crew || 0) < 1) return Infinity;
  return 10 * Math.pow(2 / 3, Math.max(0, crew - 1));
}

function repairModuleStep(module, crew, dt) {
  const duration = getCrewWorkDurationForCrew(crew);
  if (!isFinite(duration) || duration <= 0) return false;

  const oldHp = getModuleHealth(module);
  const repairAmount = dt / duration;
  const newHp = Math.min(1, oldHp + repairAmount);

  if (!applyRepairCosts(module, oldHp, newHp)) return false;
  repairModuleHealth(module, repairAmount);
  return true;
}

function updateHangarDroneRepairs(dt) {
  if (buildMode) return;

  for (const smallShip of smallShips) {
    if (smallShip.status !== "hangar" && smallShip.status !== "docking") continue;

    let module = smallShip.modules.find(m => m.id === smallShip.repairTargetModuleId && getModuleHealth(m) < 0.999);
    if (!module) {
      module = getMostDamagedSmallShipModule(smallShip);
      smallShip.repairTargetModuleId = module ? module.id : null;
    }

    if (!module) continue;

    const droneCrew = smallShip.crew || 0;
    const hangarCrew = droneCrew > 0 ? 0 : res.crew || 0;
    const crew = droneCrew > 0 ? droneCrew : hangarCrew;
    if (crew < 1) continue;

    if (!repairModuleStep(module, crew, dt)) {
      flash("Drone repair parts missing");
      continue;
    }

    if (getModuleHealth(module) >= 0.999) {
      smallShip.repairTargetModuleId = null;
    }
  }
}
function updateRepairs(dt) {
  if (!repairMode || buildMode || commitPending) {
    repairTargetModuleId = null;
    return;
  }

  if ((res.crew || 0) < 1) return;

  let module = placedModules.find(m => m.id === repairTargetModuleId && getModuleHealth(m) < 0.999);

  if (!module) {
    module = getMostDamagedModule();
    repairTargetModuleId = module ? module.id : null;
  }

  if (!module) return;

  if (!repairModuleStep(module, res.crew || 0, dt)) {
    flash("Repair parts missing");
    return;
  }

  if (getModuleHealth(module) >= 0.999) {
    repairTargetModuleId = null;
  }
}

function shipHasPoweredFrontShield(intensity, dt) {
  if (!shieldsActive) return false;

  const shield = placedModules.find(module => module.type === "Shield Generator");
  if (!shield) return false;

  const drain = 65 * intensity * dt;
  if ((res.energy || 0) < drain) return false;

  res.energy -= drain;
  return true;
}

function updateStarHeat(dt) {
  if (adminInstantBuild) return;

  const heatRange = CONFIG.GRID_SIZE * 10;
  let maxIntensity = 0;
  const moduleHeat = [];

  for (const module of placedModules) {
    const center = moduleWorldCenter(module);
    const moduleRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.55;
    let intensity = 0;

    for (const star of worldStars) {
      const dist = Math.hypot(center.x - star.x, center.y - star.y);
      const gap = dist - star.radius - moduleRadius;
      intensity = Math.max(intensity, Math.max(0, Math.min(1, 1 - gap / heatRange)));
    }

    if (intensity > 0) {
      moduleHeat.push({ module, intensity });
      maxIntensity = Math.max(maxIntensity, intensity);
    }
  }

  if (maxIntensity <= 0) return;
  if (shipHasPoweredFrontShield(maxIntensity, dt)) return;

  for (const hit of moduleHeat) {
    damageModule(hit.module, hit.intensity * 0.036 * dt);
  }
}
function updateSpaceHazards(dt) {
  if (buildMode) return;

  const shipRadius = getShipCollisionRadius();
  const bodies = [];

  for (const star of worldStars) {
    bodies.push({ x: star.x, y: star.y, radius: star.radius, mass: star.radius * 2300, type: "star", star });
  }

  if (blackHole) {
    bodies.push({ x: blackHole.x, y: blackHole.y, radius: blackHole.radius, mass: blackHole.radius * 8000, type: "blackhole", blackHole });
  }

  for (const asteroid of asteroids) {
    bodies.push({ x: asteroid.x, y: asteroid.y, radius: asteroid.size, mass: asteroid.size * 1400, type: "asteroid", asteroid });
  }

  for (const planet of planets) {
    bodies.push({ x: planet.x, y: planet.y, radius: planet.radius, mass: planet.radius * 2500, type: "planet", planet });
  }

  for (const body of bodies) {
    if (body.type === "asteroid" && isAsteroidInShield(body.asteroid)) {
      body.asteroid.totalItems = 0;
      continue;
    }

    const dx = body.x - ship.x;
    const dy = body.y - ship.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    const asteroidHits = body.type === "asteroid" ? collidesAsteroidWithShip(body.asteroid) : [];
    const collided = body.type === "asteroid"
      ? asteroidHits.length > 0
      : dist < body.radius + shipRadius * 0.6;

    if (collided && adminInstantBuild) {
      if (body.type === "asteroid") body.asteroid.totalItems = 0;
      continue;
    }

    if (collided && body.type === "asteroid") {
      for (const module of asteroidHits) {
        damageModule(module, 0.5);
      }
      body.asteroid.totalItems = 0;
      continue;
    }

    if (collided) {
      destroyShip("Ship destroyed", body);
      continue;
    }


  }

  updateStarHeat(dt);
  removeEmptyAsteroids();
}

function updateTurretGuns(dt) {
  for (const m of placedModules) {
    if (m.type !== "Turret") continue;

    if (m._gunAngle === undefined) m._gunAngle = Math.random() * Math.PI * 2;
    if (m._gunTargetAngle === undefined) m._gunTargetAngle = m._gunAngle;
    if (m._gunSwitchTimer === undefined) m._gunSwitchTimer = 0.5 + Math.random() * 2;
    m._turning = false;

    const target = getNearestEnemyTargetForTurret(m, 50);

    if (target) {
      const turretWorld = moduleWorldCenter(m);
      m._gunTargetAngle = Math.atan2(
        target.y - turretWorld.y,
        target.x - turretWorld.x
      ) - ship.angle - (m.rot || 0) * Math.PI / 2 - Math.PI / 2;
    } else {
      m._gunSwitchTimer -= dt;

      if (m._gunSwitchTimer <= 0) {
        m._gunTargetAngle = Math.random() * Math.PI * 2;
        m._gunSwitchTimer = 1.0 + Math.random() * 3.0;
      }
    }

    const turnSpeed = 2.8; // rad/s, höher = schneller
    const diff = normalizeAngle(m._gunTargetAngle - m._gunAngle);
    const maxStep = turnSpeed * dt;

    if (Math.abs(diff) <= maxStep) {
      m._gunAngle = m._gunTargetAngle;
    } else {
      m._gunAngle += Math.sign(diff) * maxStep;
      m._turning = true;
    }

    m._gunAngle = normalizeAngle(m._gunAngle);
  }
}

function updateGameSounds() {
  updateLoopSound("background", audioUnlocked);

  const thrusterActive = placedModules.some(module => module._thrustActive)
    || smallShips.some(smallShip => smallShip._thrusting)
    || enemyShips.some(enemy => enemy._thrusting);

  const buildingActive = commitPending
    || (repairMode && !!getMostDamagedModule())
    || smallShips.some(smallShip => smallShip.repairTargetModuleId || smallShip.status === "building");

  updateLoopSound("thruster", thrusterActive);
  updateLoopSound("building", buildingActive);
  updateLoopSound("assembler", placedModules.some(module => module._machineActive === "assembler"));
  updateLoopSound("turbine", placedModules.some(module => module._machineActive === "turbine"));
  updateLoopSound("smelter", placedModules.some(module => module._machineActive === "smelter"));
  updateLoopSound("drill", false);
  updateLoopSound("turretTurn", placedModules.some(module => module.type === "Turret" && module._turning));
}
