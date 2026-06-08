function getImportedShipBounds(modules) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const module of modules) {
    minX = Math.min(minX, module.x);
    minY = Math.min(minY, module.y);
    maxX = Math.max(maxX, module.x + module.w);
    maxY = Math.max(maxY, module.y + module.h);
  }

  return { minX, minY, maxX, maxY };
}

function getImportedShipOffset(grid, modules) {
  const bounds = getImportedShipBounds(modules);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  return {
    x: grid.x - Math.floor(width / 2) - bounds.minX,
    y: grid.y - Math.floor(height / 2) - bounds.minY
  };
}

function canPlaceImportedShip(grid, modules = importedShipGhost?.modules || []) {
  const offset = getImportedShipOffset(grid, modules);
  const temp = placedModules.concat(blueprints);

  if (!activeSmallShipEdit) {
    const projectedTiles = countModuleTiles(temp) + countModuleTiles(modules);
    if (projectedTiles > getMotherShipTileLimit()) return false;
    if (modules.some(module => !hasComputerLevelForBuilding(module.type))) return false;
  }

  for (const module of modules) {
    if (!canPlaceModule(module.x + offset.x, module.y + offset.y, module.w, module.h, temp)) {
      return false;
    }
  }

  return true;
}

function placeImportedShipGhost(grid) {
  if (!importedShipGhost) return false;

  const modules = importedShipGhost.modules;
  const droneSettings = importedShipGhost.droneSettings;
  if (!validateImportedModulesForCurrentEditor(modules)) {
    importedShipGhost = null;
    return false;
  }

  if (!canPlaceImportedShip(grid, modules)) {
    if (!activeSmallShipEdit && countModuleTiles(placedModules.concat(blueprints)) + countModuleTiles(modules) > getMotherShipTileLimit()) {
      flash(`Computer MK${getComputerLevel()} supports max ${getMotherShipTileLimit()} ship tiles`);
    } else if (!activeSmallShipEdit && modules.some(module => !hasComputerLevelForBuilding(module.type))) {
      flash("Mother ship computer has not enough processing power");
    } else {
      flash("Not enough space for ship");
    }
    return false;
  }

  const offset = getImportedShipOffset(grid, modules);

  for (const module of modules) {
    blueprints.push({
      id: nextModuleId++,
      x: module.x + offset.x,
      y: module.y + offset.y,
      type: module.type,
      w: module.w,
      h: module.h,
      rot: module.rot || 0,
      tankContent: module.tankContent,
      tankCap: module.tankCap
    });
  }

  if (activeSmallShipEdit?.ship && droneSettings) {
    Object.assign(activeSmallShipEdit.ship, {
      modeMining: !!droneSettings.modeMining,
      modeBattle: !!droneSettings.modeBattle,
      modeGas: !!droneSettings.modeGas,
      modeSolarWind: !!droneSettings.modeSolarWind,
      cargoLimits: JSON.parse(JSON.stringify(droneSettings.cargoLimits || {})),
      liquidLimits: JSON.parse(JSON.stringify(droneSettings.liquidLimits || {}))
    });
  }

  importedShipGhost = null;
  lastBlueprintKey = "";
  flash("Ship blueprint placed");
  return true;
}

function getRotatedSize(item) {
  const [w, h] = item.size;
  return rotation % 2 === 0 ? [w, h] : [h, w];
}

function getDrawSize(w, h, rot) {
  return rot % 2 === 0
    ? { w, h }
    : { w: h, h: w };
}

function getAnchorForItem(grid, item) {
  const [w, h] = getRotatedSize(item);

  return {
    x: grid.x - Math.floor(w / 2),
    y: grid.y - Math.floor(h / 2)
  };
}

function getAllOccupied(modules = placedModules) {
  const cells = [];

  for (const m of modules) {
    const w = m.w || 1;
    const h = m.h || 1;

    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        cells.push({ x: m.x + dx, y: m.y + dy });
      }
    }
  }

  return cells;
}

function isConnected(modules = placedModules) {
  const cells = getAllOccupied(modules);
  if (!cells.length) return true;

  const occupied = new Set(cells.map(c => `${c.x},${c.y}`));
  const visited = new Set();
  const stack = [cells[0]];

  while (stack.length) {
    const cell = stack.pop();
    const key = `${cell.x},${cell.y}`;

    if (visited.has(key)) continue;
    visited.add(key);

    const neighbors = [
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 }
    ];

    for (const n of neighbors) {
      const nk = `${n.x},${n.y}`;
      if (occupied.has(nk) && !visited.has(nk)) stack.push(n);
    }
  }

  return visited.size === occupied.size;
}

function getModulesConnectedToComputer(modules = placedModules) {
  const computer = modules.find(module => module.type === "Computer");
  if (!computer || getModuleHealth(computer) <= 0) return [];

  const occupied = new Map();

  for (const module of modules) {
    const w = module.w || 1;
    const h = module.h || 1;

    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        occupied.set(`${module.x + dx},${module.y + dy}`, module);
      }
    }
  }

  const startCells = [];
  const cw = computer.w || 1;
  const ch = computer.h || 1;

  for (let dx = 0; dx < cw; dx++) {
    for (let dy = 0; dy < ch; dy++) {
      startCells.push({ x: computer.x + dx, y: computer.y + dy });
    }
  }

  const visitedCells = new Set();
  const connectedModules = new Set();
  const stack = startCells;

  while (stack.length) {
    const cell = stack.pop();
    const key = `${cell.x},${cell.y}`;
    if (visitedCells.has(key) || !occupied.has(key)) continue;

    visitedCells.add(key);
    connectedModules.add(occupied.get(key));

    stack.push(
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 }
    );
  }

  return modules.filter(module => connectedModules.has(module));
}

function cleanupModuleDamage(modules, options = {}) {
  const computer = modules.find(module => module.type === "Computer");
  if (!computer || getModuleHealth(computer) <= 0) {
    return { modules: [], computerDestroyed: true, removed: modules.length };
  }

  const alive = modules.filter(module => module.type === "Computer" || getModuleHealth(module) > 0);
  const connected = getModulesConnectedToComputer(alive);
  const connectedIds = new Set(connected.map(module => module.id));
  const removedModules = modules.filter(module => !connectedIds.has(module.id));
  const removed = modules.length - connected.length;

  return { modules: connected, computerDestroyed: false, removed, removedModules };
}

function cleanupPlayerShipDamage() {
  const result = cleanupModuleDamage(placedModules);

  if (result.computerDestroyed) {
    if (!ship._computerDestroyed) {
      ship._computerDestroyed = true;
      destroyShip("Ship destroyed", ship);
    }

    for (const module of placedModules) {
      if (module.type !== "Computer") module.hp = 0;
    }
    return;
  }

  if (result.removed <= 0) return;

  if (autoBlueprintRepair) {
    for (const module of result.removedModules || []) {
      if (module.type === "Computer") continue;
      const duplicate = blueprints.some(bp =>
        bp.x === module.x &&
        bp.y === module.y &&
        bp.type === module.type &&
        bp.w === (module.w || 1) &&
        bp.h === (module.h || 1)
      );
      if (duplicate) continue;

      blueprints.push({
        id: nextModuleId++,
        x: module.x,
        y: module.y,
        type: module.type,
        w: module.w || 1,
        h: module.h || 1,
        rot: module.rot || 0,
        tankContent: module.tankContent,
        tankCap: module.tankCap
      });
    }
  }

  placedModules.length = 0;
  placedModules.push(...result.modules);

  for (const id of [...demolishSet]) {
    if (!placedModules.some(module => module.id === id)) demolishSet.delete(id);
  }

  flash(`${result.removed} destroyed module(s) removed`);
}

function cleanupEnemyShipDamage(enemy) {
  const result = cleanupModuleDamage(enemy.modules || []);

  if (result.computerDestroyed || result.modules.length === 0) {
    addEnemySalvage(enemy, enemy.modules || []);
    if (!enemy._killCounted) {
      enemy._killCounted = true;
      enemyShipsDestroyed++;
    }
    enemy._dead = true;
    return;
  }

  enemy.modules = result.modules;
}

function flash(msg) {
  const text = String(msg);
  const now = performance.now();
  const existing = flashMessages.find(message => !message.persistent && message.text === text);
  if (existing) {
    existing.until = now + 4000;
    return;
  }

  flashMessages.push({
    id: nextFlashMessageId++,
    text,
    until: now + 4000,
    persistent: false
  });

  let transientCount = 0;
  for (const message of flashMessages) {
    if (!message.persistent) transientCount++;
  }
  if (transientCount > 8) {
    const oldestIndex = flashMessages.findIndex(message => !message.persistent);
    if (oldestIndex >= 0) flashMessages.splice(oldestIndex, 1);
  }
}

function setPersistentFlash(key, msg, active) {
  const existingIndex = flashMessages.findIndex(message => message.persistent && message.key === key);
  const existing = existingIndex >= 0 ? flashMessages[existingIndex] : null;
  if (!active) {
    if (existingIndex >= 0) flashMessages.splice(existingIndex, 1);
    return;
  }
  if (existing) {
    existing.text = String(msg);
    return;
  }
  flashMessages.push({
    id: nextFlashMessageId++,
    key,
    text: String(msg),
    until: Infinity,
    persistent: true
  });
}

function getBuildInventoryLayout() {
  const tabs = getVisibleBuildTabs();
  let activeTab = tabs.find(tab => tab.id === activeBuildTabId) || tabs[0];

  if (!activeTab) {
    activeTab = tabs[0];
    activeBuildTabId = activeTab ? activeTab.id : "power";
  }

  const rows = [];
  const rowH = 54;
  const menuW = 330;
  const menuX = Math.max(302, VIEW.w - menuW - 15);
  const menuY = 10;
  const tabSize = 44;
  const tabGap = 8;
  const tabY = menuY + 86;
  const titleY = tabY + tabSize + 24;
  let y = titleY + 24;

  for (const item of activeTab.items) {
    rows.push({ type: "item", item, y, h: rowH });
    y += rowH;
  }

  const tabRects = tabs.map((tab, index) => ({
    tab,
    x: menuX + 10 + index * (tabSize + tabGap),
    y: tabY,
    w: tabSize,
    h: tabSize
  }));

  return {
    tabs,
    activeTab,
    rows,
    sx: menuX + 10,
    sy: y,
    menuX,
    menuY,
    menuW,
    menuH: Math.max(180, y - menuY + 12),
    rowH,
    tabRects,
    titleY
  };
}

function getBuildTabAt(mx, my) {
  const layout = getBuildInventoryLayout();
  return layout.tabRects.find(rect =>
    mx >= rect.x && mx <= rect.x + rect.w &&
    my >= rect.y && my <= rect.y + rect.h
  )?.tab || null;
}

function getInventoryButtonAt(mx, my) {
  const layout = getBuildInventoryLayout();
  const x = layout.sx;
  const bw = layout.menuW - 20;

  for (const row of layout.rows) {
    if (row.type !== "item") continue;
    const y = row.y;

    if (mx >= x && mx <= x + bw && my >= y && my <= y + row.h - 6) {
      return row.item;
    }
  }

  return null;
}

function isMouseOverInventory() {
  return buildMode && (
    getInventoryButtonAt(mouse.x, mouse.y) !== null ||
    getBuildTabAt(mouse.x, mouse.y) !== null ||
    isMouseOverBuildTools() ||
    isMouseOverSalvagePanel(mouse.x, mouse.y)
  );
}

function removeBlueprintAt(grid) {
  const index = blueprints.findIndex(bp =>
    grid.x >= bp.x &&
    grid.x < bp.x + bp.w &&
    grid.y >= bp.y &&
    grid.y < bp.y + bp.h
  );

  if (index !== -1) {
    const [removed] = blueprints.splice(index, 1);
    returnSalvageBlueprint(removed);
    return true;
  }

  return false;
}

function getImageSprite(name) {
  const data = loadedImages[name];
  if (!data) return null;

  const img = data.image;
  if (!img || !img.complete || img.naturalWidth === 0) return null;

  return data;
}

function getThumbnailSpriteName(name) {
  if (getImageSprite(name)) return name;
  if (name === "Main Thruster" && getImageSprite("Main Thruster Off")) return "Main Thruster Off";
  if (name === "RCS Thruster" && getImageSprite("RCS Thruster Off")) return "RCS Thruster Off";
  if (name.startsWith("Computer MK") && getImageSprite("Computer")) return "Computer";
  if (name === "Quantum computer" && getImageSprite("Computer")) return "Computer";
  return name;
}

function drawImageSprite(name, x, y, w, h) {
  const data = getImageSprite(getThumbnailSpriteName(name));
  if (!data) return false;

  const img = data.image;
  const frames = data.frames || 1;
  const speed = data.speed || 200;
  const frameIndex = frames === 1 ? 0 : Math.floor(performance.now() / speed) % frames;
  const frameWidth = img.width;
  const frameHeight = img.height / frames;

  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(
    img,
    0,
    frameIndex * frameHeight,
    frameWidth,
    frameHeight,
    x,
    y,
    w,
    h
  );

  return true;
}

function openCrewManagement(cx, cy) {
  ddOverlay.innerHTML = `<div class="dd-title">Crew Management</div>`;
  ddOverlay.style.background = "rgba(4, 10, 30, 0.96)";
  ddOverlay.style.border = "1px solid rgba(100,150,255,0.65)";
  ddOverlay.style.borderRadius = "6px";
  ddOverlay.style.minWidth = "220px";
  ddOverlay.style.padding = "8px";

  const info = document.createElement("div");
  info.style.cursor = "default";
  info.style.color = "white";
  info.style.font = "13px Consolas, monospace";
  info.style.padding = "8px 6px 10px";
  info.textContent = `Population: ${res.crew}/${res.crewCap}`;
  ddOverlay.appendChild(info);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "10px";
  controls.style.justifyContent = "center";
  controls.style.cursor = "default";
  controls.style.padding = "2px 0 10px";

  function makeCrewButton(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.width = "54px";
    button.style.height = "30px";
    button.style.background = "rgba(4, 10, 30, 0.82)";
    button.style.border = "1px solid rgba(100,150,255,0.7)";
    button.style.color = "white";
    button.style.font = "bold 18px Consolas, monospace";
    button.style.cursor = "pointer";
    button.style.borderRadius = "0";
    button.style.padding = "0";
    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(80, 190, 255, 0.72)";
      button.style.borderColor = "#ccf6ff";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = "rgba(4, 10, 30, 0.82)";
      button.style.borderColor = "rgba(100,150,255,0.7)";
    });
    button.addEventListener("mousedown", e => {
      e.stopPropagation();
      onClick();
      openCrewManagement(cx, cy);
    });
    return button;
  }

  controls.appendChild(makeCrewButton("-", () => {
    res.crew = Math.max(0, res.crew - 1);
  }));
  controls.appendChild(makeCrewButton("+", () => {
    res.crew = Math.min(res.crewCap, res.crew + 1);
  }));
  ddOverlay.appendChild(controls);

  const note = document.createElement("div");
  note.style.cursor = "default";
  note.style.color = "rgba(210,225,255,0.78)";
  note.style.font = "11px Consolas, monospace";
  note.style.lineHeight = "15px";
  note.style.padding = "4px 6px 2px";
  note.textContent = "Population affects build and repair speed.";
  ddOverlay.appendChild(note);

  ddOverlay.style.left = cx + "px";
  ddOverlay.style.top = cy + "px";
  ddOverlay.style.display = "block";
}

function openTankDropdown(module, cx, cy) {
  const options = TANK_OPTIONS[module.type];
  if (!options) return;

  ddOverlay.innerHTML = `<div class="dd-title">Select tank content</div>`;

  for (const opt of options) {
    const div = document.createElement("div");
    div.textContent = `${opt.label} (cap: ${opt.cap})`;

    if (module.tankContent === opt.key) {
      div.style.color = "#44ffcc";
    }

  div.addEventListener("mousedown", e => {
    e.stopPropagation();
    module.tankContent = opt.key;
    module.tankCap = opt.cap;
    ddOverlay.style.display = "none";
  });

    ddOverlay.appendChild(div);
  }

  ddOverlay.style.left = cx + "px";
  ddOverlay.style.top = cy + "px";
  ddOverlay.style.display = "block";
}

function openFusionModeDropdown(module, cx, cy) {
  ddOverlay.innerHTML = `<div class="dd-title">Fusion fuel mode</div>`;
  ddOverlay.style.left = cx + "px";
  ddOverlay.style.top = cy + "px";
  ddOverlay.style.display = "block";

  const options = [
    { label: "Deuterium + Tritium", mode: "tritium" },
    { label: "Deuterium + Helium-3", mode: "helium3" }
  ];

  for (const option of options) {
    const div = document.createElement("div");
    div.textContent = option.label;
    if ((module.fusionFuelMode || "tritium") === option.mode) div.style.color = "#44ffcc";
    div.addEventListener("mousedown", e => {
      e.stopPropagation();
      module.fusionFuelMode = option.mode;
      ddOverlay.style.display = "none";
      flash(`Fusion mode: ${option.label}`);
    });
    ddOverlay.appendChild(div);
  }
}

document.addEventListener("mousedown", e => {
  if (!ddOverlay.contains(e.target)) {
    ddOverlay.style.display = "none";
  }
});

function openBuildMode() {
  if (commitPending) {
    if (commitSnapshot) {
      blueprints.length = 0;
      blueprints.push(...JSON.parse(JSON.stringify(commitSnapshot.blueprints || [])));
      demolishSet.clear();
      for (const id of commitSnapshot.demolish || []) demolishSet.add(id);
    }
    commitPending = false;
    commitSnapshot = null;
  }

  buildMode = true;
  savedAngle = ship.angle;
  ship.angle = 0;
  camera.scale = Math.max(camera.scale, MIN_BUILD_CAMERA_SCALE);
  buildCamera.x = ship.x;
  buildCamera.y = ship.y;
  notifyTutorialBuildOpened();
  flash("Build mode");
  playSound("toggle", 120);
}

function handlePlayingEscapeKey() {
  if (getComputedStyle(ddOverlay).display !== "none") {
    ddOverlay.style.display = "none";
    playSound("toggle", 120);
    return true;
  }

  if (researchWindowOpen || assemblerWindowModule) {
    researchWindowOpen = false;
    assemblerWindowModule = null;
    hoveredResearchItem = null;
    playSound("toggle", 120);
    return true;
  }

  if (turretControlWindowOpen) {
    turretControlWindowOpen = false;
    playSound("toggle", 120);
    return true;
  }

  if (importedShipGhost) {
    importedShipGhost = null;
    lastBlueprintKey = "";
    flash("Import cancelled");
    playSound("toggle", 120);
    return true;
  }

  if (returnHeldSalvageModule()) {
    playSound("toggle", 120);
    return true;
  }

  if (heldItem !== AIR) {
    heldItem = AIR;
    lastBlueprintKey = "";
    flash("Item released");
    playSound("toggle", 120);
    return true;
  }

  if (mapVisible && mapFocusSystem) {
    mapFocusSystem = null;
    flash("Galaxy map");
    playSound("toggle", 120);
    return true;
  }

  if (mapVisible) {
    mapVisible = false;
    flash("Map closed");
    playSound("toggle", 120);
    return true;
  }

  if (buildMode) {
    flash("Press B to leave build mode");
    return true;
  }

  if (velocityMatchTarget || selectedFlightTarget || lockedApproachTarget) {
    velocityMatchTarget = null;
    selectedFlightTarget = null;
    lockedApproachTarget = null;
    flash("Target cleared");
    playSound("toggle", 120);
    return true;
  }

  return false;
}

function adminJumpForward() {
  const noseAngle = ship.angle - Math.PI / 2 - SHIP_NOSE_OFFSET;
  ship.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, ship.x + Math.cos(noseAngle) * CONFIG.GRID_SIZE * 100));
  ship.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, ship.y + Math.sin(noseAngle) * CONFIG.GRID_SIZE * 100));
  camera.x = ship.x;
  camera.y = ship.y;
  buildCamera.x = ship.x;
  buildCamera.y = ship.y;
  clearAsteroidsNearShip();
  flash("Admin jump");
}

function getDigitFromKeyEvent(e, key) {
  if (/^\d$/.test(key)) return key;
  if (/^digit\d$/.test(e.code.toLowerCase()) || /^numpad\d$/.test(e.code.toLowerCase())) {
    return e.code.slice(-1);
  }
  return "";
}

function handleAdminSecretKey(e, key) {
  const code = (e.code || "").toLowerCase();
  const startsSecret = key === "/"
    || code === "slash"
    || code === "numpaddivide"
    || ((e.shiftKey || keys.shift) && code === "digit7");

  if (startsSecret) {
    adminSecretInput = "/";
    e.preventDefault();
    return true;
  }

  if (!adminSecretInput) return false;

  if (key === "shift" || key === "control" || key === "alt" || key === "meta") {
    e.preventDefault();
    return true;
  }

  const digit = getDigitFromKeyEvent(e, key);
  if (digit) {
    adminSecretInput += digit;
    if (adminSecretInput.length > 7) adminSecretInput = "";
    e.preventDefault();
    return true;
  }

  if (key === "enter") {
    if (adminSecretInput === "/528491") {
      adminInstantBuild = !adminInstantBuild;
      flash(adminInstantBuild ? "Admin mode on" : "Admin mode off");
      playSound("toggle", 120);
    }
    adminSecretInput = "";
    e.preventDefault();
    return true;
  }

  if (key === "escape" || key === "backspace") {
    adminSecretInput = "";
    e.preventDefault();
    return true;
  }

  adminSecretInput = "";
  return false;
}

window.addEventListener("keydown", e => {
  unlockAudio();

  const key = e.key.toLowerCase();
  keys[key] = true;

  if (uiDialog) {
    const field = uiDialog.fields?.[activeDialogField];
    if (key === "tab") {
      activeDialogField = (activeDialogField + 1) % Math.max(1, uiDialog.fields.length);
    } else if (key === "enter") {
      submitUiDialog("ok");
    } else if (key === "escape") {
      submitUiDialog("cancel");
    } else if (key === "backspace" && field) {
      deleteDialogFieldBackward(field);
    } else if (key === "delete" && field) {
      deleteDialogFieldForward(field);
    } else if (key === "arrowleft" && field) {
      setDialogFieldCursor(field, field.cursor - 1, e.shiftKey);
    } else if (key === "arrowright" && field) {
      setDialogFieldCursor(field, field.cursor + 1, e.shiftKey);
    } else if (key === "home" && field) {
      setDialogFieldCursor(field, 0, e.shiftKey);
    } else if (key === "end" && field) {
      setDialogFieldCursor(field, field.value.length, e.shiftKey);
    } else if ((e.ctrlKey || e.metaKey) && key === "a" && field) {
      selectDialogFieldText(field);
    } else if (field) {
      const digit = getDigitFromKeyEvent(e, key);
      if (field.type === "number") {
        const selection = getDialogFieldSelection(field);
        const nextLength = field.value.length - (selection.end - selection.start) + 1;
        if (digit && nextLength <= 16) insertDialogFieldText(field, digit);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        insertDialogFieldText(field, e.key);
      }
    }
    keys[key] = false;
    e.preventDefault();
    return;
  }

  if (seedDialogOpen) {
    const digit = getDigitFromKeyEvent(e, key);
    if (digit && pendingSeedInput.length < 16) {
      pendingSeedInput += digit;
    } else if (key === "backspace") {
      pendingSeedInput = pendingSeedInput.slice(0, -1);
    } else if (key === "enter") {
      startPendingSeedGame();
    } else if (key === "escape") {
      seedDialogOpen = false;
      pendingNewGameSlot = null;
      pendingNewGameName = "";
      pendingSeedInput = "";
    }
    keys[key] = false;
    e.preventDefault();
    return;
  }

  if (handleAdminSecretKey(e, key)) {
    keys[key] = false;
    return;
  }

  if (appState !== "playing") {
    if (key === "escape" && appState === "menu") {
      appState = "start";
      selectedMenuSaveSlot = null;
      saveSelectionMode = null;
      pendingSavePayload = null;
      pendingOverwriteSlot = null;
      playSound("toggle", 120);
    }
    if (key === "escape" && appState === "paused") {
      if (saveSelectionMode !== null || pendingSavePayload !== null || pendingOverwriteSlot !== null) {
        // Only cancel the save flow, stay in pause menu
        saveSelectionMode = null;
        pendingSavePayload = null;
        pendingOverwriteSlot = null;
        playSound("toggle", 120);
      } else {
        appState = "playing";
        playSound("toggle", 120);
      }
    }
    keys[key] = false;
    e.preventDefault();
    return;
  }

  if (key === "escape") {
    if (!handlePlayingEscapeKey()) {
      updateSavePreviewFrame();
      persistCurrentSavePreview();
      appState = "paused";
      saveSelectionMode = null;
      pendingSavePayload = null;
      pendingOverwriteSlot = null;
      playSound("toggle", 120);
    }
    e.preventDefault();
    return;
  }

  if (adminInstantBuild && !buildMode && key === "w" && keys.shift) {
    adminJumpForward();
    e.preventDefault();
    return;
  }

  if (adminInstantBuild && key === "t") {
    openAdminCommandDialog();
    keys[key] = false;
    e.preventDefault();
    return;
  }

  if (key === "b") {
    if (activeSmallShipEdit && buildMode) {
      commitSmallShipEditor();
      playSound("toggle", 120);
      e.preventDefault();
      return;
    }

    if (buildMode) {
      pruneUnreachableBlueprints();
      buildMode = false;
      heldItem = AIR;
      dragging = false;
      lastBlueprintKey = "";

      if (blueprints.length === 0 && demolishSet.size === 0) {
        flash("Build mode closed");
        playSound("toggle", 120);
        ship.angle = savedAngle;
        e.preventDefault();
        return;
      }

      commitPending = true;
      commitStartTime = performance.now();
      commitSnapshot = {
        blueprints: JSON.parse(JSON.stringify(blueprints)),
        demolish: new Set(demolishSet)
      };
      clearAsteroidsNearShip();
      flash("Committing build changes");
      playSound("toggle", 120);

      ship.angle = savedAngle;
    } else {
      openBuildMode();
    }
  }

  if (key === "x" && !buildMode) {
    toggleStatusBadgeAction("shields");
  }

  if (key === "v" && !buildMode) {
    toggleStatusBadgeAction("repair");
  }

  if (key === "c" && !buildMode) {
    toggleStatusBadgeAction("recall");
    e.preventDefault();
  }

  if (key === "g" && !buildMode) {
    toggleStatusBadgeAction("precision");
    e.preventDefault();
  }

  if (key === "o" && !buildMode) {
    toggleStatusBadgeAction("orbit");
    e.preventDefault();
  }

  if (key === "m" && !buildMode) {
    toggleStatusBadgeAction("map");
    e.preventDefault();
  }

  if (key === "l" && !buildMode) {
    toggleStatusBadgeAction("landing");
    e.preventDefault();
  }

  if (key === "n" && !buildMode) {
    toggleStatusBadgeAction("autoBlueprint");
    e.preventDefault();
  }

  if (key === " ") {
    e.preventDefault();
  }

  if (key === "r") {
    if (buildMode) {
      if (importedShipGhost) {
        flash("Imported ship keeps its original direction");
      } else {
        rotation = (rotation + 1) % 4;
      }
    }

    e.preventDefault();
  }

  if (key === "q" && buildMode) {
    e.preventDefault();

    if (returnHeldSalvageModule()) return;
    if (!hoveredGrid) return;

    const bp = blueprints.find(bp =>
      hoveredGrid.x >= bp.x &&
      hoveredGrid.x < bp.x + bp.w &&
      hoveredGrid.y >= bp.y &&
      hoveredGrid.y < bp.y + bp.h
    );

    const type = bp ? bp.type : getModuleAtCell(hoveredGrid.x, hoveredGrid.y)?.module.type;
    const rot = bp ? bp.rot || 0 : getModuleAtCell(hoveredGrid.x, hoveredGrid.y)?.module.rot || 0;

    if (!type) return;

    for (const category of INVENTORY) {
      const found = category.items.find(item => item.name === type);
      if (found) {
        heldItem = found;
        rotation = rot;
        break;
      }
    }
  }
});

window.addEventListener("keyup", e => {
  keys[e.key.toLowerCase()] = false;
});

window.addEventListener("mousedown", e => {
  unlockAudio();
  canvas.focus();
  updateMouseFromEvent(e);
  if (e.button === 0 && handleGlobalVolumeSliderMouseDown(mouse.x, mouse.y)) {
    e.preventDefault();
    return;
  }
  playSound("mouse", 40);

  if (handleTutorialClick(mouse.x, mouse.y)) return;
  if (handleUiDialogClick(mouse.x, mouse.y)) return;
  if (handleTurretControlClick(mouse.x, mouse.y)) return;

  if (appState !== "playing") {
    handleGameInterfaceClick(mouse.x, mouse.y);
    return;
  }

  if (e.button === 0) {
    mouseDown = true;

    if (!buildMode && handleStatusBadgeClick(mouse.x, mouse.y)) {
      return;
    }

    if (!buildMode && handleDysonPanelClick(mouse.x, mouse.y)) {
      return;
    }

    if (!buildMode && handleDysonBuildButtonClick(mouse.x, mouse.y)) {
      return;
    }

    if (mapVisible && !buildMode && handleMapClick(mouse.x, mouse.y)) {
      return;
    }
    if (mapVisible && !buildMode) return;

    const salvageDeleteGroup = getSalvageDeleteGroupAt(mouse.x, mouse.y);
    if (salvageDeleteGroup && deleteSalvageGroup(salvageDeleteGroup)) {
      return;
    }

    const salvageItem = getSalvageItemAt(mouse.x, mouse.y);
    if (salvageItem && selectSalvageModule(salvageItem)) {
      return;
    }

    const assemblerTarget = getAssemblerTargetButtonAt(mouse.x, mouse.y);
    if (assemblerTarget) {
      setAssemblerTarget(assemblerTarget);
      return;
    }
    if (assemblerWindowModule) return;

    if (researchWindowOpen) {
      const researchItem = getResearchItemAt(mouse.x, mouse.y);
      if (researchItem) {
        tryResearch(researchItem);
        return;
      }
      return;
    }

    if (!isMouseOverInventory()) {
      const result = buildMode
        ? (() => {
            const grid = screenToGrid(mouse.x, mouse.y);
            return getModuleAtCell(grid.x, grid.y);
          })()
        : getModuleAtScreen(mouse.x, mouse.y);

      if (result && isTurretType(result.module.type)) {
        openTurretControlWindow();
        return;
      }

      if (!buildMode && handleHangarFindClick(result)) {
        return;
      }

      if (!buildMode) {
        const clickedSmallShip = getSmallShipAtScreen(mouse.x, mouse.y);
        if (clickedSmallShip) {
          openSmallShipEditorForShip(clickedSmallShip);
          playSound("toggle", 120);
          return;
        }
      }

      if (!buildMode && result && result.module.type === "Quarters") {
        openCrewManagement(e.clientX, e.clientY);
        playSound("toggle", 120);
        return;
      }

      if (!buildMode && result && result.module.type === "Laboratory") {
        researchWindowOpen = !researchWindowOpen;
        assemblerWindowModule = null;
        playSound("toggle", 120);
        flash(researchWindowOpen ? "Research open" : "Research closed");
        return;
      }

      if (!buildMode && result && result.module.type === "Assembler") {
        openAssemblerSettings(result.module);
        playSound("toggle", 120);
        return;
      }

      if (!buildMode && result && result.module.type === "Fusion Reactor") {
        openFusionModeDropdown(result.module, e.clientX, e.clientY);
        playSound("toggle", 120);
        return;
      }

      if (!buildMode && result && result.module.type === "Quantum computer") {
        openQuantumComputerStatus();
        playSound("toggle", 120);
        return;
      }

      if (!buildMode && result && isHangarType(result.module.type)) {
        openSmallShipEditor(result.module);
        playSound("toggle", 120);
        return;
      }

      if (result && TANK_OPTIONS[result.module.type]) {
        openTankDropdown(result.module, e.clientX, e.clientY);
        playSound("toggle", 120);
        return;
      }
    }

    // Click-to-select flight target (not in build mode, not over a UI module)
    if (!buildMode && !isMouseOverInventory()) {
      const flightObj = getMouseFlightObject();
      if (flightObj) {
        selectedFlightTarget = flightObj;
        lockedApproachTarget = flightObj;
        velocityMatchTarget = flightObj;
        const label = flightObj.type || "Object";
        flash(`Target locked: ${label}`);
        playSound("toggle", 80);
        return;
      }
    }

    if (buildMode && heldItem === AIR && !importedShipGhost && !isMouseOverInventory()) {
      dragging = true;
      dragStart.x = mouse.x;
      dragStart.y = mouse.y;
    }
  }

  if (e.button === 2) {
    rightMouseDown = true;
    rightMouseDemolishMode = null;

    if (buildMode && !isMouseOverInventory()) {
      const grid = screenToGrid(mouse.x, mouse.y);

      if (removeBlueprintAt(grid)) return;

      const result = getModuleAtCell(grid.x, grid.y);

      if (result && result.module.type !== "Computer") {
        const id = result.module.id;

        rightMouseDemolishMode = demolishSet.has(id) ? "remove" : "add";
        if (rightMouseDemolishMode === "remove") demolishSet.delete(id);
        else demolishSet.add(id);
      }
    }
  }
});

window.addEventListener("mouseup", e => {
  if (e.button === 0) {
    volumeSliderDragging = false;
    mouseDown = false;
    dragging = false;
    lastBlueprintKey = "";
  }

  if (e.button === 2) {
    rightMouseDown = false;
    rightMouseDemolishMode = null;
  }
});

window.addEventListener("contextmenu", e => {
  e.preventDefault();
});

function updateMouseFromEvent(e) {
  const rect = canvas.getBoundingClientRect();

  mouse.x = e.clientX - rect.left;
  mouse.y = e.clientY - rect.top;

  if (volumeSliderDragging) {
    updateGlobalVolumeSlider(mouse.x);
    return;
  }

  hoveredGrid = screenToGrid(mouse.x, mouse.y);
  hoveredInventoryItem = buildMode ? getInventoryButtonAt(mouse.x, mouse.y) : null;
  hoveredResearchItem = researchWindowOpen ? getResearchItemAt(mouse.x, mouse.y) : null;

  if (hoveredInventoryItem) {
    newlyUnlockedResearch.delete(hoveredInventoryItem.name);
  }

  if (rightMouseDown && buildMode && !isMouseOverInventory()) {
    const grid = screenToGrid(mouse.x, mouse.y);

    if (removeBlueprintAt(grid)) return;

    const result = getModuleAtCell(grid.x, grid.y);

    if (result && result.module.type !== "Computer") {
      if (rightMouseDemolishMode === null) {
        rightMouseDemolishMode = demolishSet.has(result.module.id) ? "remove" : "add";
      }

      if (rightMouseDemolishMode === "remove") demolishSet.delete(result.module.id);
      else demolishSet.add(result.module.id);
    }
  }
}

window.addEventListener("mousemove", updateMouseFromEvent);
window.addEventListener("pointermove", updateMouseFromEvent);

function updateAppWindowActive() {
  appWindowActive = !document.hidden && appWindowFocused;
  lastTime = performance.now();
  if (!appWindowActive) stopAllLoopSounds();
}

document.addEventListener("visibilitychange", () => {
  updateAppWindowActive();
});

window.addEventListener("dblclick", e => {
  updateMouseFromEvent(e);
  if (handleUiDialogDoubleClick(mouse.x, mouse.y)) {
    e.preventDefault();
  }
});

window.addEventListener("blur", () => {
  appWindowFocused = false;
  updateAppWindowActive();
});

window.addEventListener("focus", () => {
  appWindowFocused = true;
  updateAppWindowActive();
});

window.addEventListener("wheel", e => {
  if (appState !== "playing") return;

  camera.scale -= e.deltaY * 0.001;
  const minScale = buildMode ? MIN_BUILD_CAMERA_SCALE : MIN_CAMERA_SCALE;
  camera.scale = Math.max(minScale, Math.min(MAX_CAMERA_SCALE, camera.scale));
});

window.addEventListener("click", e => {
  if (!buildMode) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const tool = getBuildToolButtonAt(mx, my);

  if (tool === "export") {
    exportShipToClipboard();
    return;
  }

  if (tool === "import") {
    importShipFromCode();
    return;
  }

  const smallShipAction = getSmallShipConfigButtonAt(mx, my);
  if (handleSmallShipConfigClick(smallShipAction)) return;

  const cargoLimit = getSmallShipCargoLimitAt(mx, my);
  if (cargoLimit) {
    if (cargoLimit.kind === "liquid") {
      setSmallShipLiquidLimit(activeSmallShipEdit.ship, cargoLimit.key);
    } else {
      setSmallShipCargoLimit(activeSmallShipEdit.ship, cargoLimit.key);
    }
    return;
  }

  const tab = getBuildTabAt(mx, my);
  if (tab) {
    activeBuildTabId = tab.id;
    hoveredInventoryItem = null;
    playSound("toggle", 120);
    return;
  }

  const item = getInventoryButtonAt(mx, my);

  if (item) {
    importedShipGhost = null;
    heldItem = item;
    lastBlueprintKey = "";
    return;
  }

  if (importedShipGhost && hoveredGrid) {
    placeImportedShipGhost(hoveredGrid);
  }
});

window.addEventListener("resize", resizeCanvas);
