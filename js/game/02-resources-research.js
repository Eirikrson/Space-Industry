function takeAsteroidResource(asteroid) {
  const available = Object.keys(asteroid.contents).filter(key => asteroid.contents[key] > 0);
  if (available.length === 0) return null;

  const key = available[Math.floor(Math.random() * available.length)];
  asteroid.contents[key] -= 1;
  asteroid.totalItems = Math.max(0, asteroid.totalItems - 1);
  if (asteroid.totalItems <= 0) notifyTutorialAsteroidMined();

  return key;
}

function isLiquidResource(key) {
  return LIQUID_RESOURCES.has(key);
}

function getSolidStorageUsed() {
  let used = 0;

  for (const key of SOLID_RESOURCES) {
    used += res[key] || 0;
  }

  return used;
}

function storeResource(key, amount = 1) {
  if (amount <= 0 || res[key] === undefined) return 0;

  if (isLiquidResource(key)) {
    const cap = res[key + "Cap"] || 0;
    if (cap <= 0) return 0;

    const accepted = Math.max(0, Math.min(amount, cap - res[key]));
    res[key] += accepted;
    return accepted;
  }

  if (SOLID_RESOURCES.has(key)) {
    const free = Math.max(0, (res.itemCap || 0) - getSolidStorageUsed());
    const accepted = Math.max(0, Math.min(amount, free));
    res[key] += accepted;
    return accepted;
  }

  return 0;
}

function getResourceStorageFree(key) {
  if (isLiquidResource(key)) {
    return Math.max(0, (res[key + "Cap"] || 0) - (res[key] || 0));
  }
  if (SOLID_RESOURCES.has(key)) {
    return Math.max(0, (res.itemCap || 0) - getSolidStorageUsed());
  }
  return 0;
}

function isBuildingUnlocked(type) {
  return adminInstantBuild || type === "Computer" || unlockedResearch.has(type);
}

function getComputerLevel() {
  if (adminInstantBuild) return 4;
  if (unlockedResearch.has("Computer MK4")) return 4;
  if (unlockedResearch.has("Computer MK3")) return 3;
  if (unlockedResearch.has("Computer MK2")) return 2;
  return 1;
}

function getMotherShipTileLimit() {
  return [0, 100, 350, 500, 800][getComputerLevel()] || 100;
}

function getRequiredComputerLevelForBuilding(type) {
  if (type === "Hangar MK1") return 2;
  if (type === "Hangar MK2") return 3;
  if (type === "Hangar MK3") return 4;
  return 1;
}

function hasComputerLevelForBuilding(type) {
  return getComputerLevel() >= getRequiredComputerLevelForBuilding(type);
}

function getResearchTierRequiredComputerLevel(tierIndex) {
  return tierIndex + 1;
}

function getVisibleInventory() {
  return INVENTORY
    .map(category => ({
      ...category,
      items: category.items.filter(item => isBuildingUnlocked(item.name) && hasComputerLevelForBuilding(item.name))
    }))
    .filter(category => category.items.length > 0);
}

function getVisibleBuildTabs() {
  return BUILD_MENU_TABS.map(tab => ({
    ...tab,
    items: tab.items
      .map(name => getInventoryItemByName(name))
      .filter(item => isBuildingUnlocked(item.name) && hasComputerLevelForBuilding(item.name))
  }));
}

function getBuildTabOrderIndex(itemName) {
  if (itemName === "Laboratory") return -100;
  const researchIndex = RESEARCH_ITEMS.findIndex(item => item.name === itemName);
  if (researchIndex >= 0) return 1000 + researchIndex;
  const baseUnlocked = BASE_UNLOCKED_BUILDINGS instanceof Set
    ? BASE_UNLOCKED_BUILDINGS.has(itemName)
    : (BASE_UNLOCKED_BUILDINGS || []).includes(itemName);
  if (baseUnlocked) return 0;
  return 9999;
}

function sortBuildTabItemsByUnlockOrder() {
  for (const tab of BUILD_MENU_TABS) {
    tab.items.sort((a, b) => {
      const diff = getBuildTabOrderIndex(a) - getBuildTabOrderIndex(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }
}

sortBuildTabItemsByUnlockOrder();

function getInventoryItemByName(name) {
  for (const category of INVENTORY) {
    const item = category.items.find(candidate => candidate.name === name);
    if (item) return item;
  }

  return { id: name.toLowerCase().replace(/\s+/g, "_"), name, size: [1, 1] };
}

function hasCost(cost) {
  if (!cost || adminInstantBuild) return true;
  return Object.entries(cost).every(([key, amount]) => (res[key] || 0) >= amount);
}

function payCost(cost) {
  if (!cost || adminInstantBuild) return true;
  if (!hasCost(cost)) return false;

  for (const [key, amount] of Object.entries(cost)) {
    res[key] -= amount;
  }

  return true;
}

function refundBuildCost(moduleOrType) {
  const type = typeof moduleOrType === "string" ? moduleOrType : moduleOrType?.type;
  const cost = BUILD_COSTS[type];
  if (!cost || moduleOrType?.buildCostPaid === false) return false;

  let refundedAny = false;
  for (const [key, amount] of Object.entries(cost)) {
    const stored = storeResource(key, amount);
    refundedAny = stored > 0 || refundedAny;
  }

  return refundedAny;
}

function getMissingCostText(cost) {
  if (!cost) return "";
  const missing = [];

  for (const [key, amount] of Object.entries(cost)) {
    const lack = amount - (res[key] || 0);
    if (lack > 0) missing.push(`${Math.ceil(lack)} ${formatResourceName(key)}`);
  }

  return missing.join(", ");
}

function formatCost(cost) {
  if (!cost) return "Unlocked";
  return getOrderedCostEntries(cost)
    .map(([key, amount]) => `${amount} ${formatResourceName(key)}`)
    .join(", ");
}

function getOrderedCostEntries(cost) {
  if (!cost) return [];
  const orderedKeys = COST_RESOURCE_ORDER
    .filter(key => cost[key])
    .concat(Object.keys(cost).filter(key => !COST_RESOURCE_ORDER.includes(key)));
  return orderedKeys.map(key => [key, cost[key]]);
}

function getAssemblerRecipeKeys() {
  return Object.keys(BUILDING_STATS.Assembler?.recipes || {});
}

function getSmelterRecipes() {
  const stats = BUILDING_STATS.Smelter || {};
  const inputAmount = stats.oreUse || 1;
  const outputAmount = stats.materialProd || 1;
  return {
    ironPlate: { inputs: { ironOre: inputAmount }, outputs: { ironPlate: outputAmount } },
    copperPlate: { inputs: { copperOre: inputAmount }, outputs: { copperPlate: outputAmount } },
    silicon: { inputs: { siliconOre: inputAmount }, outputs: { silicon: outputAmount } }
  };
}

function getSmelterRecipeKeys() {
  return Object.keys(getSmelterRecipes());
}

function getDefaultAssemblerTargets() {
  return Object.fromEntries(getAssemblerRecipeKeys().map(key => [key, 0]));
}

function ensureAssemblerTargets(module) {
  const defaults = getDefaultAssemblerTargets();
  module.assemblerTargets = { ...defaults, ...(module.assemblerTargets || {}) };
  return module.assemblerTargets;
}

function getDefaultSmelterTargets() {
  return Object.fromEntries(getSmelterRecipeKeys().map(key => [key, 0]));
}

function ensureSmelterTargets(module) {
  const defaults = getDefaultSmelterTargets();
  module.smelterTargets = { ...defaults, ...(module.smelterTargets || {}) };
  return module.smelterTargets;
}

function ensureElectrolyserTargets(module) {
  module.electrolyserTargets = {
    hydrogen: 0,
    oxygen: 0,
    ...(module.electrolyserTargets || {})
  };
  return module.electrolyserTargets;
}

function ensureFuelProcessorTarget(module) {
  module.fuelProcessorTarget = Math.max(0, Number(module.fuelProcessorTarget) || 0);
  return module.fuelProcessorTarget;
}

function ensureFarmTarget(module) {
  module.farmTarget = Math.max(0, Number(module.farmTarget) || 0);
  return module.farmTarget;
}

function formatRecipeResources(resources) {
  return Object.entries(resources || {})
    .map(([key, amount]) => `${amount} ${formatResourceName(key)}`)
    .join(" + ");
}

function getBuildingDescription(name) {
  if (name === "Quantum Computer") {
    const lines = (BUILDING_DESCRIPTIONS[name] || ["No description available."]).slice();
    const needed = typeof getRequiredStabilizerCount === "function" ? getRequiredStabilizerCount() : 1;
    const have = typeof getPlacedStabilizerCount === "function" ? getPlacedStabilizerCount() : 0;
    const shieldNeed = typeof getRequiredEventHorizonShieldCount === "function" ? getRequiredEventHorizonShieldCount() : 4;
    const shieldHave = placedModules.filter(module => module.type === "Event Horizon Shield" && getModuleHealth(module) > 0).length;
    lines.push("");
    lines.push(`Black-hole stabilizers ${have}/${needed}`);
    lines.push(`Event Horizon Shields ${shieldHave}/${shieldNeed}`);
    lines.push("Shield need scales with ship size.");
    return lines;
  }

  if (name !== "Assembler") return (BUILDING_DESCRIPTIONS[name] || ["No description available."]).slice();

  const recipes = BUILDING_STATS.Assembler?.recipes || {};
  const lines = [
    `INPUT Energy        -${BUILDING_STATS.Assembler.energyUse}/sec while active`
  ];

  for (const [product, recipe] of Object.entries(recipes)) {
    lines.push("");
    lines.push(`${formatResourceName(product)}: ${formatRecipeResources(recipe.inputs)} -> ${formatRecipeResources(recipe.outputs)}`);
  }

  return lines;
}

function getVisibleResearchSections() {
  const sections = [];
  for (let tierIndex = 0; tierIndex < RESEARCH_TIERS.length; tierIndex++) {
    if (getComputerLevel() < getResearchTierRequiredComputerLevel(tierIndex)) continue;
    sections.push(RESEARCH_TIERS[tierIndex]);
  }
  return sections;
}

function getResearchDisplayEntries() {
  const entries = [];

  for (const tier of getVisibleResearchSections()) {
    entries.push({ type: "title", tier, displayH: 38 });
    for (const item of tier.items) {
      const costLines = item.cost ? getResearchCostLineCount(item.cost) : 1;
      const h = 32 + (costLines - 1) * 18;
      entries.push({ type: "item", item, costLines, h, displayH: h + 6 });
    }
  }

  return entries;
}

function getBalancedResearchSplitIndex(entries) {
  if (entries.length <= 1) return entries.length;
  const total = entries.reduce((sum, entry) => sum + entry.displayH, 0);
  let bestIndex = Math.ceil(entries.length / 2);
  let bestDiff = Infinity;
  let left = 0;

  for (let i = 1; i < entries.length; i++) {
    left += entries[i - 1].displayH;
    let index = i;
    if (entries[index]?.type === "item" && entries[index - 1]?.type === "title") {
      index = i - 1;
    }
    const adjustedLeft = entries.slice(0, index).reduce((sum, entry) => sum + entry.displayH, 0);
    const diff = Math.abs(adjustedLeft - (total - adjustedLeft));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  }

  if (entries[bestIndex - 1]?.type === "title") bestIndex -= 1;
  return Math.max(1, Math.min(entries.length - 1, bestIndex));
}

function getResearchWindowLayout() {
  const width = Math.min(980, VIEW.w - 40);
  const entries = getResearchDisplayEntries();
  const split = getBalancedResearchSplitIndex(entries);
  const leftH = entries.slice(0, split).reduce((sum, entry) => sum + entry.displayH, 0);
  const rightH = entries.slice(split).reduce((sum, entry) => sum + entry.displayH, 0);
  const estimatedHeight = 74 + Math.max(leftH, rightH);
  const height = Math.min(Math.max(360, estimatedHeight), VIEW.h - 30);
  const x = VIEW.w / 2 - width / 2;
  const y = VIEW.h / 2 - height / 2;
  const gap = 12;
  const colW = (width - 32 - gap) / 2;
  const costXOffset = 176;

  return { x, y, width, height, gap, colW, rowH: 32, costXOffset };
}

function getResearchCostLineCount(cost) {
  const count = getOrderedCostEntries(cost).length;
  if (count <= 3) return 1;
  if (count <= 7) return 2;
  return 3;
}

function getResearchRows() {
  const layout = getResearchWindowLayout();
  const rows = [];
  const colY = [layout.y + 48, layout.y + 48];
  const entries = getResearchDisplayEntries();
  const split = getBalancedResearchSplitIndex(entries);

  for (let i = 0; i < entries.length; i++) {
    const col = i < split ? 0 : 1;
    const x = layout.x + 10 + col * (layout.colW + layout.gap);
    const y = colY[col];
    const entry = entries[i];

    if (entry.type === "title") {
      const titleY = y > layout.y + 48 ? y + 14 : y;
      rows.push({ type: "title", text: entry.tier.title, x, y: titleY, w: layout.colW, h: 18 });
      colY[col] = titleY + 24;
    } else {
      rows.push({
        type: "item",
        item: entry.item,
        x,
        y,
        w: layout.colW,
        h: entry.h,
        costLines: entry.costLines,
        costX: x + layout.costXOffset
      });
      colY[col] += entry.displayH;
    }
  }

  return rows;
}

function getResearchItemAt(mx, my) {
  if (!researchWindowOpen) return null;

  for (const row of getResearchRows()) {
    if (
      row.type === "item" &&
      mx >= row.x &&
      mx <= row.x + row.w &&
      my >= row.y &&
      my <= row.y + row.h
    ) {
      return row.item;
    }
  }

  return null;
}

function tryResearch(item) {
  if (!item || unlockedResearch.has(item.name)) return;

  if (!payCost(item.cost)) {
    flash(`Research needs ${getMissingCostText(item.cost)}`);
    return;
  }

  unlockedResearch.add(item.name);
  newlyUnlockedResearch.add(item.name);
  notifyTutorialResearch(item.name);
  flash(`${item.name} researched`);
  playSound("labFinish", 900);
}

function openAssemblerSettings(module) {
  ensureAssemblerTargets(module);

  assemblerWindowModule = module;
  smelterWindowModule = null;
  electrolyserWindowModule = null;
  fuelProcessorWindowModule = null;
  farmWindowModule = null;
  researchWindowOpen = false;
  flash("Assembler settings open");
}

function getAssemblerWindowLayout() {
  const width = 360;
  const height = 64 + getAssemblerRecipeKeys().length * 42;
  return {
    x: VIEW.w / 2 - width / 2,
    y: VIEW.h / 2 - height / 2,
    width,
    height,
    rowH: 34
  };
}

function getAssemblerTargetButtonAt(mx, my) {
  if (!assemblerWindowModule) return null;

  const layout = getAssemblerWindowLayout();
  const keys = getAssemblerRecipeKeys();

  for (let i = 0; i < keys.length; i++) {
    const y = layout.y + 56 + i * 42;
    if (
      mx >= layout.x + 14 &&
      mx <= layout.x + layout.width - 14 &&
      my >= y &&
      my <= y + layout.rowH
    ) {
      return keys[i];
    }
  }

  return null;
}

function setAssemblerTarget(key) {
  if (!assemblerWindowModule) return;

  const targets = ensureAssemblerTargets(assemblerWindowModule);
  openInputDialog(`Target ${formatResourceName(key)}`, "Amount", targets[key] || 0, "number", value => {
    targets[key] = Math.max(0, Math.floor(Number(value) || 0));
    assemblerWindowModule.assemblerTargets = targets;
    flash("Assembler target updated");
  });
}

function openSmelterSettings(module) {
  ensureSmelterTargets(module);

  smelterWindowModule = module;
  assemblerWindowModule = null;
  electrolyserWindowModule = null;
  fuelProcessorWindowModule = null;
  farmWindowModule = null;
  researchWindowOpen = false;
  flash("Smelter settings open");
}

function getSmelterWindowLayout() {
  const width = 360;
  const height = 64 + getSmelterRecipeKeys().length * 42;
  return {
    x: VIEW.w / 2 - width / 2,
    y: VIEW.h / 2 - height / 2,
    width,
    height,
    rowH: 34
  };
}

function getSmelterTargetButtonAt(mx, my) {
  if (!smelterWindowModule) return null;

  const layout = getSmelterWindowLayout();
  const keys = getSmelterRecipeKeys();

  for (let i = 0; i < keys.length; i++) {
    const y = layout.y + 56 + i * 42;
    if (
      mx >= layout.x + 14 &&
      mx <= layout.x + layout.width - 14 &&
      my >= y &&
      my <= y + layout.rowH
    ) {
      return keys[i];
    }
  }

  return null;
}

function setSmelterTarget(key) {
  if (!smelterWindowModule) return;

  const targets = ensureSmelterTargets(smelterWindowModule);
  openInputDialog(`Target ${formatResourceName(key)}`, "Amount", targets[key] || 0, "number", value => {
    targets[key] = Math.max(0, Math.floor(Number(value) || 0));
    smelterWindowModule.smelterTargets = targets;
    flash("Smelter target updated");
  });
}

function getSmelterProduct(module) {
  const targets = ensureSmelterTargets(module);
  const recipes = getSmelterRecipes();
  let best = null;
  let bestDeficit = 0;

  for (const key of getSmelterRecipeKeys()) {
    const recipe = recipes[key];
    const canProduce = Object.entries(recipe?.inputs || {})
      .every(([inputKey, amount]) => (res[inputKey] || 0) >= Math.min(amount, 0.001));
    if (!canProduce) continue;
    const deficit = (targets[key] || 0) - (res[key] || 0);
    if (deficit > bestDeficit) {
      best = key;
      bestDeficit = deficit;
    }
  }

  return best;
}

function openElectrolyserSettings(module) {
  ensureElectrolyserTargets(module);
  electrolyserWindowModule = module;
  fuelProcessorWindowModule = null;
  farmWindowModule = null;
  assemblerWindowModule = null;
  smelterWindowModule = null;
  researchWindowOpen = false;
  flash("Electrolyser settings open");
}

function getElectrolyserWindowLayout() {
  const width = 380;
  const height = 64 + 2 * 42;
  return {
    x: VIEW.w / 2 - width / 2,
    y: VIEW.h / 2 - height / 2,
    width,
    height,
    rowH: 34
  };
}

function getElectrolyserTargetButtonAt(mx, my) {
  if (!electrolyserWindowModule) return null;
  const layout = getElectrolyserWindowLayout();
  const keys = ["hydrogen", "oxygen"];
  for (let i = 0; i < keys.length; i++) {
    const y = layout.y + 56 + i * 42;
    if (mx >= layout.x + 14 && mx <= layout.x + layout.width - 14 &&
        my >= y && my <= y + layout.rowH) {
      return keys[i];
    }
  }
  return null;
}

function setElectrolyserTarget(key) {
  if (!electrolyserWindowModule) return;
  const targets = ensureElectrolyserTargets(electrolyserWindowModule);
  openInputDialog(`Minimum ${formatResourceName(key)}`, "Amount", targets[key] || 0, "number", value => {
    targets[key] = Math.max(0, Math.floor(Number(value) || 0));
    electrolyserWindowModule.electrolyserTargets = targets;
    flash("Electrolyser minimum updated");
  });
}

function openFuelProcessorSettings(module) {
  ensureFuelProcessorTarget(module);
  fuelProcessorWindowModule = module;
  electrolyserWindowModule = null;
  farmWindowModule = null;
  assemblerWindowModule = null;
  smelterWindowModule = null;
  researchWindowOpen = false;
  flash("Fuel Processor settings open");
}

function getFuelProcessorWindowLayout() {
  const width = 380;
  const height = 64 + 42;
  return {
    x: VIEW.w / 2 - width / 2,
    y: VIEW.h / 2 - height / 2,
    width,
    height,
    rowH: 34
  };
}

function getFuelProcessorTargetButtonAt(mx, my) {
  if (!fuelProcessorWindowModule) return null;
  const layout = getFuelProcessorWindowLayout();
  const y = layout.y + 56;
  return mx >= layout.x + 14 && mx <= layout.x + layout.width - 14 &&
    my >= y && my <= y + layout.rowH
    ? "fuel"
    : null;
}

function setFuelProcessorTarget() {
  if (!fuelProcessorWindowModule) return;
  const target = ensureFuelProcessorTarget(fuelProcessorWindowModule);
  openInputDialog("Minimum Fuel", "Amount", target, "number", value => {
    fuelProcessorWindowModule.fuelProcessorTarget = Math.max(0, Math.floor(Number(value) || 0));
    flash("Fuel Processor minimum updated");
  });
}

function openFarmSettings(module) {
  ensureFarmTarget(module);
  farmWindowModule = module;
  fuelProcessorWindowModule = null;
  electrolyserWindowModule = null;
  assemblerWindowModule = null;
  smelterWindowModule = null;
  researchWindowOpen = false;
  flash("Farm settings open");
}

function getFarmWindowLayout() {
  const width = 380;
  const height = 64 + 42;
  return {
    x: VIEW.w / 2 - width / 2,
    y: VIEW.h / 2 - height / 2,
    width,
    height,
    rowH: 34
  };
}

function getFarmTargetButtonAt(mx, my) {
  if (!farmWindowModule) return null;
  const layout = getFarmWindowLayout();
  const y = layout.y + 56;
  return mx >= layout.x + 14 && mx <= layout.x + layout.width - 14 &&
    my >= y && my <= y + layout.rowH
    ? "food"
    : null;
}

function setFarmTarget() {
  if (!farmWindowModule) return;
  const target = ensureFarmTarget(farmWindowModule);
  openInputDialog("Minimum Food", "Amount", target, "number", value => {
    farmWindowModule.farmTarget = Math.max(0, Math.floor(Number(value) || 0));
    flash("Farm minimum updated");
  });
}

function getAssemblerProduct(module) {
  const targets = ensureAssemblerTargets(module);
  let best = null;
  let bestDeficit = 0;

  for (const key of getAssemblerRecipeKeys()) {
    const recipe = BUILDING_STATS.Assembler?.recipes?.[key];
    const canCraft = Object.entries(recipe?.inputs || {})
      .every(([inputKey, amount]) => (res[inputKey] || 0) >= amount);
    if (!canCraft) continue;
    const deficit = (targets[key] || 0) - (res[key] || 0);
    if (deficit > bestDeficit) {
      best = key;
      bestDeficit = deficit;
    }
  }

  return best;
}

function getDrillProbe(module) {
  const center = moduleWorldCenter(module);
  const frontAngle = ship.angle + (module.rot || 0) * Math.PI / 2 - Math.PI / 2 - SHIP_NOSE_OFFSET;
  const frontX = Math.cos(frontAngle);
  const frontY = Math.sin(frontAngle);

  return {
    x: center.x + frontX * CONFIG.GRID_SIZE * 0.5,
    y: center.y + frontY * CONFIG.GRID_SIZE * 0.5,
    frontX,
    frontY
  };
}

function findAsteroidForDrill(module) {
  const probe = getDrillProbe(module);
  const drillReach = CONFIG.GRID_SIZE * 2;

  let best = null;
  let bestDist = Infinity;

  for (const asteroid of asteroids) {
    if (asteroid.totalItems <= 0) continue;

    const dx = asteroid.x - probe.x;
    const dy = asteroid.y - probe.y;
    const forwardDist = dx * probe.frontX + dy * probe.frontY;
    const sideDist = Math.abs(dx * probe.frontY - dy * probe.frontX);
    const surfaceGap = forwardDist - asteroid.size;

    if (forwardDist < -asteroid.size) continue;
    if (sideDist > asteroid.size + CONFIG.GRID_SIZE * 0.5) continue;

    if (surfaceGap <= drillReach && surfaceGap < bestDist) {
      best = asteroid;
      bestDist = surfaceGap;
    }
  }

  return best;
}

function findWaterPlanetForDrill(module) {
  const probe = getDrillProbe(module);
  const drillReach = CONFIG.GRID_SIZE * 2;

  for (const planet of planets) {
    if (planet.type !== "water") continue;

    const dx = planet.x - probe.x;
    const dy = planet.y - probe.y;
    const forwardDist = dx * probe.frontX + dy * probe.frontY;
    const sideDist = Math.abs(dx * probe.frontY - dy * probe.frontX);
    const surfaceGap = forwardDist - planet.radius;

    if (forwardDist < -planet.radius) continue;
    if (sideDist > planet.radius + CONFIG.GRID_SIZE * 0.75) continue;
    if (surfaceGap <= drillReach) return planet;
  }

  return null;
}

function harvestAsteroid(asteroid) {
  let collected = 0;

  for (const key in asteroid.contents) {
    const amount = asteroid.contents[key];
    if (amount > 0) {
      const stored = storeResource(key, amount);
      asteroid.contents[key] = isLiquidResource(key)
        ? 0
        : Math.max(0, amount - stored);
      collected += stored;
    }
  }

  if (collected > 0) playSound("items", 250);
  asteroid.totalItems = getAsteroidTotal(asteroid.contents);
  if (asteroid.totalItems <= 0) {
    asteroid.contents = {};
    if (asteroid._localDynamic && !asteroid._beltDynamic) {
      nextOpenSpaceAsteroidSpawnAt = Math.max(
        nextOpenSpaceAsteroidSpawnAt,
        worldPlayTime + 60
      );
    }
    notifyTutorialAsteroidMined();
    const index = asteroids.indexOf(asteroid);
    if (index >= 0) asteroids.splice(index, 1);
  }
  return collected;
}
