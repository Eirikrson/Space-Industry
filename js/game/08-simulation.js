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
  if (turretControlWindowOpen) return;
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
    : countModuleTiles(placedModules) + countModuleTiles(blueprints) + w * h;

  if (activeSmallShipEdit && projectedTiles > activeSmallShipEdit.capacityTiles) {
    flash("Hangar ship size limit reached");
    return;
  }

  if (!activeSmallShipEdit && projectedTiles > getMotherShipTileLimit()) {
    flash(`Computer MK${getComputerLevel()} supports max ${getMotherShipTileLimit()} ship tiles`);
    return;
  }

  if (!activeSmallShipEdit && !hasComputerLevelForBuilding(heldItem.name)) {
    flash("Mother ship computer has not enough processing power");
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
      rot: rotation,
      tankContent: heldItem.tankContent,
      tankCap: heldItem.tankCap,
      freeBuild: !!heldItem.freeBuild,
      salvageSource: heldItem.salvageSource ? { ...heldItem.salvageSource } : undefined
    });

    lastBlueprintKey = key;
    if (heldItem.freeBuild) {
      if (!takeMatchingSalvageModule(heldItem)) {
        heldItem = AIR;
        lastBlueprintKey = "";
      }
    }
  }
}

function processCommit() {
  if (!commitPending) return;

  if (adminInstantBuild) {
    // --- ADMIN MODE: instant batch build/demolish (original behaviour) ---
    if (performance.now() - commitStartTime < 1000) return;

    const dem = commitSnapshot.demolish;
    const bps = commitSnapshot.blueprints;
    let changedAny = false;

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
          changedAny = true;
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
        if (!canPlaceModule(bp.x, bp.y, bp.w, bp.h, next)) {
          returnSalvageBlueprint(bp);
          continue;
        }
        const testModule = { id: -1, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0 };
        if (isConnected(next.concat(testModule))) {
          if (!bp.freeBuild && !payCost(BUILD_COSTS[bp.type])) {
            flash(`Build needs ${getMissingCostText(BUILD_COSTS[bp.type])}`);
            stillPending.push(bp);
            continue;
          }
          const builtModule = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: !bp.freeBuild };
          next.push(builtModule);
          notifyTutorialModuleBuilt(builtModule.type);
          placedAny = true;
          changedAny = true;
        } else {
          stillPending.push(bp);
        }
      }
      pending = stillPending;
    }
    if (pending.length > 0) {
      returnSalvageBlueprints(pending);
      flash(`${pending.length} blueprint(s) not reachable - skipped`);
    }

    placedModules.length = 0;
    placedModules.push(...next);
    clearAsteroidsNearShip();
    blueprints.length = 0;
    demolishSet.clear();
    commitPending = false;
    commitSnapshot = null;
    if (changedAny) buildWorkSoundUntil = performance.now() + 850;
    return;
  }

  // --- NORMAL MODE: one module at a time, crew-speed gated ---
  if (repairMode && getMostDamagedModule() && !commitSnapshot.automatic) {
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
        buildWorkSoundUntil = performance.now() + 850;
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
      if (bp.freeBuild || payCost(BUILD_COSTS[bp.type])) {
        const builtModule = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: !bp.freeBuild };
        current.push(builtModule);
        notifyTutorialModuleBuilt(builtModule.type);
        // Find and remove this bp from bps array
        const idx = bps.indexOf(bp);
        if (idx !== -1) bps.splice(idx, 1);
        placedModules.length = 0;
        placedModules.push(...current);
        processedOne = true;
        buildWorkSoundUntil = performance.now() + 850;
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
        if (bp.freeBuild || payCost(BUILD_COSTS[bp.type])) {
          const toPlace = { id: nextModuleId++, x: bp.x, y: bp.y, type: bp.type, w: bp.w, h: bp.h, rot: bp.rot || 0, tankContent: bp.tankContent, tankCap: bp.tankCap, buildCostPaid: !bp.freeBuild };
          placedModules.push(toPlace);
          notifyTutorialModuleBuilt(toPlace.type);
          const idx = bps.indexOf(bp);
          if (idx !== -1) bps.splice(idx, 1);
          processedOne = true;
          buildWorkSoundUntil = performance.now() + 850;
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
  let solarEnergyProdBase = 0;
  let asteroidCollectorCount = 0;

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
    if (stats.steamCap) res.steamCap += stats.steamCap;
    if (stats.energyProdBase) solarEnergyProdBase += stats.energyProdBase;
    if (m.type === "Asteroid Collector") asteroidCollectorCount++;
  }

  const solarFactor = getSolarEfficiency();
  res.itemUsed = getSolidStorageUsed();

  let eProd = solarEnergyProdBase * solarFactor;
  if (typeof getDysonChargeRate === "function") eProd += getDysonChargeRate();
  let eUse = 0;
  const wasPowered = res.energy > 0;
  const collectorEfficiency = Math.min(4, Math.pow(Math.max(1, asteroidCollectorCount), 0.585));
  const orbitGasPlanet = orbitModeActive && orbitPhase === "free" && orbitTarget?.typeKey === "gas"
    ? orbitTarget
    : null;
  const orbitStar = orbitModeActive && orbitPhase === "free" && orbitTarget instanceof GalaxyStar
    ? orbitTarget
    : null;
  let nearbyGasPlanet;
  let nearbyStar;
  const hasPower = () => res.energy > 0 || eProd > eUse;
  const canUsePower = module => {
    const now = performance.now();
    if ((module._powerRetryAt || 0) > now) return false;
    if (hasPower()) return true;
    module._powerRetryAt = now + 2000;
    return false;
  };

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
      const steamAmount = Math.min(stats.steamProd * dt, getResourceStorageFree("steam"));
      if (steamAmount > 0) {
        const productionScale = steamAmount / Math.max(0.001, stats.steamProd * dt);
        res.uranium -= stats.uraniumUse * dt * productionScale;
        res.water -= stats.waterUse * dt * productionScale;
        storeResource("steam", steamAmount);
      }
    }

    if (m.type === "Fusion Reactor") {
      const fusionFuel = m.fusionFuelMode === "helium3" ? "helium3" : "tritium";
      const fusionFuelUse = fusionFuel === "helium3" ? stats.helium3Use : stats.tritiumUse;

      if (res.deuterium >= stats.deuteriumUse * dt && res[fusionFuel] >= fusionFuelUse * dt && res.water >= stats.waterUse * dt) {
        const steamAmount = Math.min(stats.steamProd * dt, getResourceStorageFree("steam"));
        if (steamAmount > 0) {
          const productionScale = steamAmount / Math.max(0.001, stats.steamProd * dt);
          res.deuterium -= stats.deuteriumUse * dt * productionScale;
          res[fusionFuel] -= fusionFuelUse * dt * productionScale;
          res.water -= stats.waterUse * dt * productionScale;
          storeResource("steam", steamAmount);
        }
      }
    }

    if (m.type === "Condenser Turbine" && res.steam >= stats.steamUse * dt) {
      const waterAmount = Math.min(stats.waterProd * dt, getResourceStorageFree("water"));
      if (waterAmount > 0) {
        const productionScale = waterAmount / Math.max(0.001, stats.waterProd * dt);
        const steam = Math.min(stats.steamUse * dt * productionScale, res.steam);
        res.steam -= steam;
        eProd += stats.energyProd * (steam / (stats.steamUse * dt));
        storeResource("water", waterAmount);
        m._machineActive = "turbine";
      }
    }

    if (m.type === "Electrolyser" && canUsePower(m) && res.water >= stats.waterUse * dt) {
      const targets = ensureElectrolyserTargets(m);
      const needsHydrogen = (res.hydrogen || 0) < (targets.hydrogen || 0);
      const needsOxygen = (res.oxygen || 0) < (targets.oxygen || 0);
      if (needsHydrogen || needsOxygen) {
        const productionScale = Math.min(
          1,
          getResourceStorageFree("hydrogen") / Math.max(0.001, stats.hydrogenProd * dt),
          getResourceStorageFree("oxygen") / Math.max(0.001, stats.oxygenProd * dt)
        );
        if (productionScale > 0) {
          res.water -= stats.waterUse * dt * productionScale;
          storeResource("hydrogen", stats.hydrogenProd * dt * productionScale);
          storeResource("oxygen", stats.oxygenProd * dt * productionScale);
          eUse += stats.energyUse;
          m._machineActive = "electrolyser";
        }
      }
    }

    if (m.type === "Fuel Processor" && canUsePower(m) && res.hydrogen >= stats.hydrogenUse * dt && res.oxygen >= stats.oxygenUse * dt) {
      const target = ensureFuelProcessorTarget(m);
      const fuelAmount = Math.min(
        stats.fuelProd * dt,
        Math.max(0, target - (res.fuel || 0)),
        getResourceStorageFree("fuel")
      );
      if (fuelAmount > 0) {
        const productionScale = fuelAmount / Math.max(0.001, stats.fuelProd * dt);
        res.hydrogen -= stats.hydrogenUse * dt * productionScale;
        res.oxygen -= stats.oxygenUse * dt * productionScale;
        storeResource("fuel", fuelAmount);
        eUse += stats.energyUse;
        m._machineActive = "fuelProcessor";
      }
    }

    if (m.type === "Smelter" && canUsePower(m)) {
      const product = getSmelterProduct(m);
      const recipe = getSmelterRecipes()[product];
      if (recipe) {
        const [inputKey, inputPerSecond] = Object.entries(recipe.inputs)[0];
        const [outputKey, outputPerSecond] = Object.entries(recipe.outputs)[0];
        const target = ensureSmelterTargets(m)[outputKey] || 0;
        const outputAmount = Math.min(outputPerSecond * dt, Math.max(0, target - (res[outputKey] || 0)));
        const inputAmount = outputAmount * inputPerSecond / Math.max(0.001, outputPerSecond);

        if (outputAmount > 0 && (res[inputKey] || 0) >= inputAmount) {
          const accepted = Math.min(outputAmount, getResourceStorageFree(outputKey));
          if (accepted > 0) {
            res[inputKey] -= accepted * inputPerSecond / Math.max(0.001, outputPerSecond);
            storeResource(outputKey, accepted);
            eUse += stats.energyUse;
            m._machineActive = "smelter";
          }
        }
      }
    }

    if (m.type === "Assembler" && canUsePower(m)) {
      const product = getAssemblerProduct(m);
      const recipe = BUILDING_STATS.Assembler?.recipes?.[product];
      if (recipe) {
        m._assemblerTimer = (m._assemblerTimer || 0) + dt;
        eUse += stats.energyUse;
        m._machineActive = "assembler";

        if (m._assemblerTimer >= 1) {
          m._assemblerTimer = 0;

          const outputFits = Object.entries(recipe.outputs || {})
            .every(([key, amount]) => getResourceStorageFree(key) >= amount);
          const canCraft = outputFits && Object.entries(recipe.inputs || {})
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

    if (m.type === "Farm Module" && canUsePower(m) && res.water >= stats.waterUse * dt) {
      const target = ensureFarmTarget(m);
      const foodAmount = Math.min(
        stats.foodProd * dt,
        Math.max(0, target - (res.food || 0)),
        getResourceStorageFree("food")
      );
      if (foodAmount > 0) {
        const productionScale = foodAmount / Math.max(0.001, stats.foodProd * dt);
        res.water -= stats.waterUse * dt * productionScale;
        storeResource("food", foodAmount);
        eUse += stats.energyUse;
        m._machineActive = "farm";
      }
    }

    if (m.type === "Life Support" && canUsePower(m) && res.water >= stats.waterUse * dt) {
      res.water -= stats.waterUse * dt;
      eUse += stats.energyUse;
    }

    if (m.type === "Asteroid Collector" && canUsePower(m)) {
      eUse += stats.energyUse;

      if (m._collectorTimer === undefined) {
        m._collectorTimer = 10 + Math.random() * 10;
      }

      m._collectorTimer -= dt * (collectorEfficiency / Math.max(1, asteroidCollectorCount));

      if (m._collectorTimer <= 0) {
        const resource = COLLECTOR_SOLID_POOL[Math.floor(Math.random() * COLLECTOR_SOLID_POOL.length)];
        if (storeResource(resource, 1) > 0) playSound("items", 900);
        m._collectorTimer = 10 + Math.random() * 10;
      }
    }

    if (m.type === "Drill" && canUsePower(m)) {
      eUse += stats.energyUse;
      m._drillScanTimer = Math.max(0, (m._drillScanTimer || 0) - dt);
      if (m._drillScanTimer <= 0) {
        m._drillScanTimer = 0.2;
        m._drillWaterPlanet = findWaterPlanetForDrill(m);
        m._drillAsteroid = m._drillWaterPlanet ? null : findAsteroidForDrill(m);
      }
      const waterPlanet = m._drillWaterPlanet && planets.includes(m._drillWaterPlanet)
        ? m._drillWaterPlanet
        : null;
      const target = m._drillAsteroid && asteroids.includes(m._drillAsteroid) && m._drillAsteroid.totalItems > 0
        ? m._drillAsteroid
        : null;

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
        }

        m._drillProgress = (m._drillProgress || 0) + dt;
        m._machineActive = "drill";

        if (m._drillProgress >= stats.drillTime) {
          harvestAsteroid(target);
          m._drillTarget = null;
          m._drillProgress = 0;
        }
      } else {
        m._drillTarget = null;
        m._drillProgress = 0;
      }
    }

    if (m.type === "Scooper" && canUsePower(m)) {
      if (nearbyGasPlanet === undefined) {
        nearbyGasPlanet = findNearestGasPlanet(ship.x, ship.y, CONFIG.GRID_SIZE * 8);
      }
      const planet = orbitGasPlanet || nearbyGasPlanet;
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

    if (m.type === "Solar Wind Collector" && canUsePower(m)) {
      if (nearbyStar === undefined) {
        nearbyStar = findNearestStar(ship.x, ship.y, CONFIG.GRID_SIZE * 12);
      }
      const star = orbitStar || nearbyStar;
      if ((star && !isStarCoveredByCompleteDysonSphere(star)) || orbitGasPlanet) {
        eUse += stats.energyUse;
        const rateFactor = orbitGasPlanet ? 0.6 : 1;
        const accepted = storeResource("helium3", stats.helium3CollectRate * rateFactor * dt);
        if (accepted > 0 && performance.now() - (m._lastCollectSoundAt || 0) > 1800) {
          playSound("items", 1600);
          m._lastCollectSoundAt = performance.now();
        }
        m._machineActive = "collector";
      }
    }

    if ((m.type === "Event Horizon Shield" || m.type === "Gravitational Pull Stabilizer" || m.type === "Quantum Computer") && canUsePower(m)) {
      eUse += stats.energyUse;
      m._machineActive = "endgame";
    }

    if (isTurretType(m.type) && canUsePower(m)) {
      eUse += stats.energyUse;
    }
  }

  const crewFoodUse = res.crew * 0.025;
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

  updatePlanetMining(dt);

  for (const key of ["water", "steam", "hydrogen", "oxygen", "fuel", "ironOre", "copperOre", "siliconOre", "ironPlate", "copperPlate", "silicon", "nickel", "carbon", "deuterium", "tritium", "helium3", "uranium", "food", "ammo", "cannonBalls", "railgunRods", "rocketAmmunition"]) {
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

  removeEmptyAsteroids();
}

function destroyShip(message, source) {
  if (source?.type === "blackhole" && appState === "playing") {
    startBlackHoleEnding(
      canSurviveBlackHoleEntry(),
      "The ship is torn apart before it can stabilize the gravitational pull."
    );
    return;
  }

  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;
  flash(message);

  if (appState === "playing") {
    startGameOverEnding(message || "Ship destroyed");
  }
}

function updateAutomaticBlueprintBuild() {
  if (!autoBlueprintRepair || buildMode || commitPending || blueprints.length === 0) return;
  const now = performance.now();
  if (now < nextAutoBlueprintBuildAttemptAt) return;

  nextAutoBlueprintBuildAttemptAt = now + 5000;
  commitPending = true;
  commitStartTime = now;
  commitSnapshot = {
    blueprints: JSON.parse(JSON.stringify(blueprints)),
    demolish: new Set(),
    automatic: true
  };
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

let shipCollisionRadiusCache = 0;
let shipCollisionRadiusCacheUntil = 0;

function getShipCollisionRadius() {
  const now = performance.now();
  if (shipCollisionRadiusCache > 0 && now < shipCollisionRadiusCacheUntil) {
    return shipCollisionRadiusCache;
  }

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

  shipCollisionRadiusCache = radius;
  shipCollisionRadiusCacheUntil = now + 250;
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

let starHeatCheckTimer = 0;
let starHeatElapsed = 0;

function updateStarHeat(dt, activeWorldChunks = getActiveWorldChunks(false)) {
  if (adminInstantBuild) return;
  starHeatElapsed += dt;
  starHeatCheckTimer -= dt;
  if (starHeatCheckTimer > 0) return;
  starHeatCheckTimer = 0.2;
  const heatDt = starHeatElapsed;
  starHeatElapsed = 0;

  const heatRange = CONFIG.GRID_SIZE * 10;
  let maxIntensity = 0;
  const moduleHeat = [];
  for (const module of placedModules) {
    const center = moduleWorldCenter(module);
    const moduleRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.55;
    let intensity = 0;

    for (const star of worldStars) {
      if (!isPointInActiveChunks(star.x, star.y, activeWorldChunks)) continue;
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
  if (shipHasPoweredFrontShield(maxIntensity, heatDt)) return;

  for (const hit of moduleHeat) {
    damageModule(hit.module, hit.intensity * 0.036 * heatDt);
  }
}
// ── Landing & post-launch invulnerability ─────────────────────────────────
let _postLaunchImmunePlanet = null;
let _postLaunchImmuneActive = false;
let _wasLandingModeActive   = false; // tracks previous frame's landingModeActive

function updateLandingInvulnerability() {
  // While actively landed: remember which planet for post-launch immunity
  if (shipLanded && landedPlanet) {
    _postLaunchImmunePlanet = landedPlanet;
  }

  // Detect landing mode being turned OFF after a landed session
  if (_wasLandingModeActive && !landingModeActive && _postLaunchImmunePlanet) {
    _postLaunchImmuneActive = true;
  }
  _wasLandingModeActive = landingModeActive;

  // Check if ship has left the planet's orbit radius → end immunity
  if (_postLaunchImmuneActive && _postLaunchImmunePlanet) {
    const dist = Math.hypot(ship.x - _postLaunchImmunePlanet.x, ship.y - _postLaunchImmunePlanet.y);
    const orbitR = typeof getDesiredOrbitRadius === "function"
      ? getDesiredOrbitRadius(_postLaunchImmunePlanet)
      : _postLaunchImmunePlanet.radius * 4;
    if (dist > orbitR) {
      _postLaunchImmuneActive = false;
      _postLaunchImmunePlanet = null;
    }
  }
}

function isShipInvulnerableToPlanet(planet) {
  if (landingModeActive) return true;            // approach / landed / leaving
  if (_postLaunchImmuneActive && _postLaunchImmunePlanet === planet) return true;
  return false;
}

function updateSpaceHazards(dt) {
  if (buildMode) return;

  updateLandingInvulnerability();

  const shipRadius = getShipCollisionRadius();
  const bodies = [];
  const activeWorldChunks = getActiveWorldChunks(false);

  for (const star of worldStars) {
    if (!isCircleInActiveChunks(star.x, star.y, star.radius + shipRadius, activeWorldChunks)) continue;
    bodies.push({ x: star.x, y: star.y, radius: star.radius, mass: star.radius * 2300, type: "star", star });
  }

  if (blackHole && isCircleInActiveChunks(blackHole.x, blackHole.y, blackHole.radius + shipRadius, activeWorldChunks)) {
    bodies.push({ x: blackHole.x, y: blackHole.y, radius: blackHole.radius, mass: blackHole.radius * 8000, type: "blackhole", blackHole });
  }

  for (const asteroid of asteroids) {
    if (!isPointInActiveChunks(asteroid.x, asteroid.y, activeWorldChunks)) continue;
    bodies.push({ x: asteroid.x, y: asteroid.y, radius: asteroid.size, mass: asteroid.size * 1400, type: "asteroid", asteroid });
  }

  for (const planet of planets) {
    if (!isCircleInActiveChunks(planet.x, planet.y, planet.radius + shipRadius, activeWorldChunks)) continue;
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

    const asteroidHits = body.type === "asteroid" ? collidesAsteroidWithShip(body.asteroid) : [];
    const collisionRadius = body.radius + shipRadius * 0.6;
    const collided = body.type === "asteroid"
      ? asteroidHits.length > 0
      : distSq < collisionRadius * collisionRadius;

    if (collided && adminInstantBuild) {
      if (body.type === "blackhole") {
        destroyShip("Ship destroyed", body);
        continue;
      }
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
      if (
        body.type === "planet" &&
        orbitModeActive &&
        orbitTarget instanceof EndTwinPlanet &&
        body.planet instanceof EndTwinPlanet
      ) {
        continue;
      }
      // Planet collision: skip if invulnerable (landed / landing / post-launch)
      if (body.type === "planet" && isShipInvulnerableToPlanet(body.planet)) {
        continue;
      }
      // Orbit mode protects from planet collisions too (autopilot approach)
      if (body.type === "planet" && orbitModeActive) {
        continue;
      }
      // Stars and black hole always destroy (no protection)
      destroyShip("Ship destroyed", body);
      continue;
    }
  }

  updateStarHeat(dt, activeWorldChunks);
  removeEmptyAsteroids();
}

function updateTurretGuns(dt) {
  for (const m of placedModules) {
    if (!isTurretType(m.type)) continue;

    if (m._gunAngle === undefined) m._gunAngle = Math.random() * Math.PI * 2;
    if (m._gunTargetAngle === undefined) m._gunTargetAngle = m._gunAngle;
    if (m._gunSwitchTimer === undefined) m._gunSwitchTimer = 0.5 + Math.random() * 2;
    m._turning = false;

    m._targetScanTimer = Math.max(0, (m._targetScanTimer || 0) - dt);
    let target = resolveCachedTurretTarget(m);
    if (m._targetScanTimer <= 0 || !target) {
      target = getNearestEnemyTargetForTurret(m, getTurretConfig(m.type).rangeTiles);
      m._cachedTarget = target;
      m._targetScanTimer = target ? 0.35 : 0.75;
    }

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

    const turnSpeed = 2.8; // rad/s, higher means faster.
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
  const audioPaused = appState !== "playing"
    || buildMode
    || mapVisible
    || researchWindowOpen
    || !!assemblerWindowModule
    || !!smelterWindowModule
    || !!electrolyserWindowModule
    || !!fuelProcessorWindowModule
    || !!farmWindowModule
    || turretControlWindowOpen
    || !!activeSmallShipEdit
    || dysonPanelOpen
    || !!uiDialog
    || !!tutorialOverlay;

  if (audioPaused) {
    updateBackgroundSound(false);
    updateLayeredSound("thruster", false, 7000);
    updateLoopSound("building", false);
    updateLoopSound("assembler", false);
    updateLoopSound("turbine", false);
    updateLayeredSound("smelter", false, 1000);
    updateLayeredSound("drill", false, 1000);
    updateLoopSound("turretTurn", false);
    return;
  }

  updateBackgroundSound(audioUnlocked);

  const thrusterActive = placedModules.some(module => module._thrustActive)
    || smallShips.some(smallShip => smallShip._thrusting)
    || enemyShips.some(enemy => enemy._thrusting);

  const repairPartsAvailable = canPayRepairChunk();
  const buildingActive = performance.now() < buildWorkSoundUntil
    || (repairMode && (res.crew || 0) > 0 && repairPartsAvailable && !!getMostDamagedModule())
    || smallShips.some(smallShip =>
      smallShip.status === "building" ||
      (smallShip.repairTargetModuleId && repairPartsAvailable &&
        ((smallShip.crew || 0) > 0 || (res.crew || 0) > 0))
    );

  updateLayeredSound("thruster", thrusterActive, 7000);
  updateLoopSound("building", buildingActive);
  updateLoopSound("assembler", placedModules.some(module => module._machineActive === "assembler"));
  updateLoopSound("turbine", placedModules.some(module => module._machineActive === "turbine"));
  updateLayeredSound("smelter", placedModules.some(module => module._machineActive === "smelter"), 1000, Infinity);
  const drillActive = shipLanded || placedModules.some(module => module._machineActive === "drill");
  updateLayeredSound("drill", drillActive, 1000);
  updateLoopSound("turretTurn", placedModules.some(module => isTurretType(module.type) && module._turning));
}
