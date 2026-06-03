function getSaveSlotKey(slot) {
  return slot === "auto" ? AUTOSAVE_KEY : SAVE_KEY_PREFIX + slot;
}

function readSaveSlot(slot) {
  try {
    const raw = localStorage.getItem(getSaveSlotKey(slot));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeSaveSlot(slot, payload) {
  const key = getSaveSlotKey(slot);
  const serialized = JSON.stringify(payload);
  const previous = localStorage.getItem(key);

  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    try {
      localStorage.removeItem(key);
      localStorage.setItem(key, serialized);
      return true;
    } catch (retryError) {
      if (slot !== "auto") {
        try {
          localStorage.removeItem(getSaveSlotKey("auto"));
          localStorage.setItem(key, serialized);
          return true;
        } catch (autoRetryError) {
          console.warn("Could not write save slot after clearing autosave", autoRetryError);
        }
      }
      try {
        if (previous !== null) localStorage.setItem(key, previous);
      } catch (restoreError) {
        console.warn("Could not restore previous save slot", restoreError);
      }
      console.warn("Could not write save slot", retryError);
      return false;
    }
  }
}

function stripRuntimeState(value) {
  if (Array.isArray(value)) return value.map(stripRuntimeState);
  if (!value || typeof value !== "object") return value;

  const output = {};
  const skippedKeys = new Set([
    "targetAsteroid",
    "targetPlanet",
    "targetStar",
    "targetEnemy",
    "targetModule",
    "target",
    "parent"
  ]);
  for (const key in value) {
    if (key.startsWith("_")) continue;
    if (skippedKeys.has(key)) continue;
    if (typeof value[key] === "function") continue;
    output[key] = stripRuntimeState(value[key]);
  }
  return output;
}

function createSavePayload(name) {
  return {
    version: 2,
    name: name || currentSaveName || text("menu.unnamedSave"),
    savedAt: new Date().toISOString(),
    seed: currentWorldSeed,
    seedLabel: currentWorldSeedLabel,
    seedMode: currentWorldIsEnd ? "End" : "normal",
    ship: stripRuntimeState({
      x: ship.x,
      y: ship.y,
      angle: ship.angle,
      vx: ship.vx,
      vy: ship.vy,
      angularVelocity: ship.angularVelocity
    }),
    camera: stripRuntimeState(camera),
    buildCamera: stripRuntimeState(buildCamera),
    res: stripRuntimeState(res),
    placedModules: stripRuntimeState(placedModules),
    smallShips: stripRuntimeState(smallShips),
    enemyShips: stripRuntimeState(enemyShips),
    combatBullets: [],
    research: Array.from(unlockedResearch),
    nextIds: {
      module: nextModuleId,
      smallShip: nextSmallShipId,
      autoShip: nextAutoShipNumber,
      enemyShip: nextEnemyShipId,
      enemyFleet: nextEnemyFleetId
    },
    toggles: {
      turretsActive,
      precisionThrust,
      matchRotateNose,
      recallSmallShips,
      shieldsActive,
      repairMode,
      adminInstantBuild,
      autoBlueprintRepair
    },
    worldPlayTime,
    nextEnemySpawnAt
  };
}

function normalizeWorldSeed(seed) {
  const numeric = Number(seed);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric) >>> 0;
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function setNormalWorldSeed(seed) {
  currentWorldSeed = normalizeWorldSeed(seed);
  currentWorldSeedLabel = String(currentWorldSeed);
  currentWorldIsEnd = false;
}

function setEndWorldSeed() {
  currentWorldSeed = hashSaveKey("End");
  currentWorldSeedLabel = "End";
  currentWorldIsEnd = true;
}

function resetGeneratedWorld() {
  worldStars.length = 0;
  solarSystems.length = 0;
  planets.length = 0;
  asteroids.length = 0;
  nebulaPatches.length = 0;
  blackHole = null;
  mapFocusSystem = null;
  generateGalaxy();
}

function resetGameRuntime() {
  buildMode = false;
  heldItem = AIR;
  mouseDown = false;
  rightMouseDown = false;
  rightMouseDemolishMode = null;
  dragging = false;
  hoveredGrid = null;
  flashMsg = "";
  flashUntil = 0;
  rotation = 0;
  velocityMatchTarget = null;
  selectedFlightTarget = null;
  lockedApproachTarget = null;
  velocityAssistActive = false;
  matchRotateNose = true;
  repairMode = true;
  autoBlueprintRepair = true;
  importedShipGhost = null;
  commitPending = false;
  commitSnapshot = null;
  researchWindowOpen = false;
  assemblerWindowModule = null;
  hoveredResearchItem = null;
  activeSmallShipEdit = null;
  motherShipModulesBackup = null;
  hangarFindShipId = null;
  highlightedHangarId = null;
  seedDialogOpen = false;
  pendingNewGameSlot = null;
  pendingNewGameName = "";
  pendingSeedInput = "";
  uiDialog = null;
  activeDialogField = 0;
  blueprints.length = 0;
  demolishSet.clear();
  combatBullets.length = 0;
  for (const key in keys) keys[key] = false;
}

function resetGameToNew(name, seed) {
  resetGameRuntime();
  setNormalWorldSeed(seed);

  nextModuleId = 1;
  nextSmallShipId = 1;
  nextAutoShipNumber = 1;
  nextEnemyShipId = 1;
  nextEnemyFleetId = 1;
  nextEnemySpawnAt = performance.now() + 90000;
  worldPlayTime = 0;

  Object.keys(res).forEach(key => delete res[key]);
  Object.assign(res, JSON.parse(JSON.stringify(INITIAL_RESOURCES)));

  unlockedResearch.clear();
  for (const item of BASE_UNLOCKED_BUILDINGS) unlockedResearch.add(item);
  newlyUnlockedResearch.clear();

  smallShips.length = 0;
  enemyShips.length = 0;
  placedModules.length = 0;
  placedModules.push(
    { id: nextModuleId++, x: 0, y: 0, type: "Computer", w: 1, h: 1, rot: 0, hp: 1, buildCostPaid: false },
    ...STARTER_SHIP_MODULES.map(module => ({
      id: nextModuleId++,
      x: module.x,
      y: module.y,
      type: module.type,
      w: module.w,
      h: module.h,
      rot: module.rot || 0,
      tankContent: module.tankContent,
      tankCap: module.tankCap,
      buildCostPaid: false,
      hp: 1
    }))
  );

  ship.x = CONFIG.GALAXY_CENTER_X;
  ship.y = CONFIG.GALAXY_CENTER_Y - 55000;
  ship.angle = 0;
  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;

  resetGeneratedWorld();
  camera.x = ship.x;
  camera.y = ship.y;
  camera.scale = 1;
  buildCamera.x = ship.x;
  buildCamera.y = ship.y;
  currentSaveName = name || text("menu.unnamedSave");
  appState = "playing";
  lastAutosaveAt = performance.now();
}

function startPendingSeedGame() {
  const seedText = pendingSeedInput.trim();
  const seed = seedText === "" ? undefined : Number(seedText);
  resetGameToNew(pendingNewGameName || text("menu.unnamedSave"), seed);
  seedDialogOpen = false;
  pendingNewGameSlot = null;
  pendingNewGameName = "";
  pendingSeedInput = "";
}

function openNewWorldDialog(slot) {
  uiDialog = {
    title: "New world",
    fields: [
      { id: "name", label: "World title", value: text("menu.newGameDefaultName", { slot }), placeholder: "World title", type: "text" },
      { id: "seed", label: "Seed", value: "", placeholder: "Leer lassen fuer zufaelligen Seed", type: "number" }
    ],
    buttons: [
      { id: "cancel", text: "Cancel" },
      { id: "ok", text: "Ok", primary: true }
    ],
    onSubmit(values) {
      resetGameToNew((values.name || "").trim() || text("menu.newGameDefaultName", { slot }), values.seed === "" ? undefined : Number(values.seed));
      resetTutorialForNewWorld();
    }
  };
  activeDialogField = 0;
  canvas.focus();
}

function openInfoDialog(title, body) {
  uiDialog = {
    title,
    body,
    fields: [],
    buttons: [{ id: "ok", text: "Ok", primary: true }]
  };
}

function openConfirmDialog(title, body, onOk) {
  uiDialog = {
    title,
    body,
    fields: [],
    buttons: [
      { id: "cancel", text: "Cancel" },
      { id: "ok", text: "Ok", primary: true }
    ],
    onSubmit: onOk
  };
}

function openSaveNameDialog(slot, defaultName) {
  uiDialog = {
    title: text("save.namePrompt"),
    fields: [{ id: "name", label: "Savegame name", value: defaultName, placeholder: "Savegame name", type: "text" }],
    buttons: [
      { id: "cancel", text: "Cancel" },
      { id: "ok", text: "Ok", primary: true }
    ],
    onSubmit(values) {
      saveGameToSlot(slot, (values.name || "").trim() || defaultName);
    }
  };
  activeDialogField = 0;
  canvas.focus();
}

function openInputDialog(title, label, defaultValue, type, onSubmit) {
  uiDialog = {
    title,
    fields: [{ id: "value", label, value: String(defaultValue ?? ""), placeholder: label, type: type || "text" }],
    buttons: [
      { id: "cancel", text: "Cancel" },
      { id: "ok", text: "Ok", primary: true }
    ],
    onSubmit(values) {
      if (typeof onSubmit === "function") onSubmit(values.value || "");
    }
  };
  activeDialogField = 0;
  canvas.focus();
}

function normalizeCommandItemName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAdminGiveResourceKey(name) {
  const normalized = normalizeCommandItemName(name);
  if (!normalized) return null;

  const aliases = {
    cannonball: "cannonBalls",
    cannonballs: "cannonBalls",
    railgunrod: "railgunRods",
    railgunrods: "railgunRods",
    rocketammo: "rocketAmmunition",
    rocketammunition: "rocketAmmunition",
    rocket: "rocketAmmunition",
    rockets: "rocketAmmunition"
  };

  if (aliases[normalized]) return aliases[normalized];

  const keys = Object.keys(INITIAL_RESOURCES).filter(key =>
    !key.endsWith("Cap") &&
    key !== "energyNet" &&
    key !== "itemUsed"
  );

  return keys.find(key => normalizeCommandItemName(key) === normalized) || null;
}

function runAdminCommand(command) {
  const textValue = String(command || "").trim();
  const giveMatch = textValue.match(/^\/give\s+(.+?)\s+(-?\d+(?:\.\d+)?)$/i);

  if (!giveMatch) {
    flash("Unknown admin command");
    return;
  }

  const key = getAdminGiveResourceKey(giveMatch[1]);
  const amount = Math.floor(Number(giveMatch[2]));

  if (!key || !Number.isFinite(amount) || amount <= 0) {
    flash("Usage: /give item amount");
    return;
  }

  if (res[key] === undefined) res[key] = 0;
  res[key] += amount;
  flash(`Gave ${amount} ${formatResourceName(key)}`);
}

function openAdminCommandDialog() {
  if (!adminInstantBuild) return;

  uiDialog = {
    title: "Admin command",
    fields: [{ id: "command", label: "Command", value: "/", placeholder: "/give cannonballs 30", type: "text" }],
    buttons: [
      { id: "cancel", text: "Cancel" },
      { id: "ok", text: "Enter", primary: true }
    ],
    onSubmit(values) {
      runAdminCommand(values.command || "");
    }
  };
  activeDialogField = 0;
  const field = ensureDialogFieldState(uiDialog.fields[0]);
  field.cursor = field.value.length;
  field.selectionStart = field.cursor;
  field.selectionEnd = field.cursor;
  canvas.focus();
}

function startEndWorldFromBlackHole() {
  setEndWorldSeed();
  enemyShips.length = 0;
  combatBullets.length = 0;
  nextEnemySpawnAt = performance.now() + 12000;
  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;
  resetGeneratedWorld();
  appState = "playing";
  buildMode = false;
  flash("Unknown galaxy");
  stopAllLoopSounds();
}

function loadSavePayload(payload) {
  if (!payload) return false;

  resetGameRuntime();
  if (payload.seedMode === "End") {
    setEndWorldSeed();
  } else {
    setNormalWorldSeed(payload.seed ?? payload.seedLabel ?? 42);
  }
  resetGeneratedWorld();

  Object.keys(res).forEach(key => delete res[key]);
  Object.assign(res, JSON.parse(JSON.stringify(INITIAL_RESOURCES)), payload.res || {});
  if (res.iron !== undefined) {
    res.ironPlate = (res.ironPlate || 0) + (res.iron || 0);
    delete res.iron;
  }
  if (res.copper !== undefined) {
    res.copperPlate = (res.copperPlate || 0) + (res.copper || 0);
    delete res.copper;
  }

  const normalizeSavedModule = module => normalizeModuleShape({ ...module, type: normalizeModuleType(module.type) });
  placedModules.length = 0;
  placedModules.push(...(payload.placedModules || []).map(normalizeSavedModule));
  smallShips.length = 0;
  smallShips.push(...(payload.smallShips || []).map(smallShip => ({
    ...smallShip,
    modules: (smallShip.modules || []).map(normalizeSavedModule)
  })));
  enemyShips.length = 0;
  enemyShips.push(...(payload.enemyShips || []).map(enemy => ({
    ...enemy,
    modules: (enemy.modules || []).map(normalizeSavedModule)
  })));
  combatBullets.length = 0;
  combatBullets.push(...(payload.combatBullets || []).map(bullet => ({ ...bullet })));

  Object.assign(ship, payload.ship || {});
  Object.assign(camera, payload.camera || { x: ship.x, y: ship.y, scale: 1 });
  Object.assign(buildCamera, payload.buildCamera || { x: ship.x, y: ship.y });

  unlockedResearch.clear();
  for (const item of payload.research || BASE_UNLOCKED_BUILDINGS) unlockedResearch.add(item);
  newlyUnlockedResearch.clear();

  const ids = payload.nextIds || {};
  nextModuleId = ids.module || 1;
  nextSmallShipId = ids.smallShip || 1;
  nextAutoShipNumber = ids.autoShip || 1;
  nextEnemyShipId = ids.enemyShip || 1;
  nextEnemyFleetId = ids.enemyFleet || 1;
  nextEnemySpawnAt = payload.nextEnemySpawnAt || performance.now() + 90000;
  worldPlayTime = payload.worldPlayTime || 0;

  if (payload.toggles) {
    turretsActive = !!payload.toggles.turretsActive;
    precisionThrust = !!payload.toggles.precisionThrust;
    matchRotateNose = true;
    recallSmallShips = !!payload.toggles.recallSmallShips;
    shieldsActive = payload.toggles.shieldsActive !== false;
    repairMode = payload.toggles.repairMode !== false;
    adminInstantBuild = (payload.version || 1) >= 2 ? !!payload.toggles.adminInstantBuild : false;
    autoBlueprintRepair = payload.toggles.autoBlueprintRepair !== false;
  }

  currentSaveName = payload.name || text("save.loadedSaveFallback");
  appState = "playing";
  lastAutosaveAt = performance.now();
  flash(text("save.loadedFlash", { name: currentSaveName }));
  return true;
}

function saveGameToSlot(slot, name) {
  const payload = pendingSavePayload || createSavePayload(name || currentSaveName);
  payload.name = name || payload.name || currentSaveName || text("menu.unnamedSave");
  payload.savedAt = new Date().toISOString();
  if (!writeSaveSlot(slot, payload)) {
    flash("Savegame could not be saved");
    return false;
  }
  currentSaveName = payload.name;
  pendingSavePayload = null;
  pendingSaveName = "";
  saveSelectionMode = null;
  pendingOverwriteSlot = null;
  if (slot !== "auto") {
    appState = "menu";
    selectedMenuSaveSlot = null;
    stopAllLoopSounds();
  }
  flash(slot === "auto" ? text("save.autosavedFlash") : text("save.savedFlash", { name: payload.name }));
}

function requestSaveToSlot(slot) {
  const existing = readSaveSlot(slot);
  const defaultName = pendingSaveName || currentSaveName || text("menu.unnamedSave");

  if (existing && pendingOverwriteSlot !== slot) {
    openConfirmDialog("Overwrite savegame", text("save.overwriteConfirm", { name: existing.name || text("save.thisSavegame") }), () => {
      pendingOverwriteSlot = slot;
      openSaveNameDialog(slot, defaultName);
    });
    return;
  }

  openSaveNameDialog(slot, defaultName);
}

function loadSaveSlot(slot) {
  const payload = readSaveSlot(slot);
  if (!payload) return false;
  return loadSavePayload(payload);
}

function formatSaveDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch (error) {
    return "";
  }
}

function autosaveIfNeeded() {
  if (appState !== "playing") return;
  const now = performance.now();
  if (now - lastAutosaveAt < 10000) return;
  lastAutosaveAt = now;
  writeSaveSlot("auto", createSavePayload(currentSaveName || "Autosave"));
}

function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function base64ToText(base64) {
  return decodeURIComponent(escape(atob(base64)));
}

function hashSaveKey(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSaveCipherByte(state) {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return (state.value >>> 16) & 255;
}

function encryptSavePayload(payload) {
  const text = JSON.stringify(payload);
  const state = { value: hashSaveKey(SAVE_EXPORT_KEY + ":" + (payload.savedAt || "")) };
  let encrypted = "";

  for (let i = 0; i < text.length; i++) {
    encrypted += String.fromCharCode(text.charCodeAt(i) ^ nextSaveCipherByte(state));
  }

  return {
    format: SAVE_EXPORT_FORMAT,
    savedAt: payload.savedAt || new Date().toISOString(),
    name: payload.name || text("menu.unnamedSave"),
    data: textToBase64(encrypted)
  };
}

function decryptSaveExport(container) {
  if (!container || container.format !== SAVE_EXPORT_FORMAT || !container.data) return container;

  const encrypted = base64ToText(container.data);
  const state = { value: hashSaveKey(SAVE_EXPORT_KEY + ":" + (container.savedAt || "")) };
  let text = "";

  for (let i = 0; i < encrypted.length; i++) {
    text += String.fromCharCode(encrypted.charCodeAt(i) ^ nextSaveCipherByte(state));
  }

  return JSON.parse(text);
}
function makeSaveFileName(save, slot) {
  const raw = save?.name || `space-industry-save-${slot}`;
  return raw.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || `space-industry-save-${slot}`;
}

function exportSaveSlot(slot) {
  const save = readSaveSlot(slot);
  if (!save) {
    openInfoDialog("Empty save slot", text("save.emptySlotAlert"));
    return true;
  }

  const encryptedSave = encryptSavePayload(save);
  const blob = new Blob([JSON.stringify(encryptedSave, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = makeSaveFileName(save, slot) + ".json";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

function importSaveIntoSlot(slot) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const payload = decryptSaveExport(parsed);
        if (!payload || typeof payload !== "object" || !payload.ship || !Array.isArray(payload.placedModules)) {
          throw new Error("Invalid savegame");
        }

        payload.name = payload.name || file.name.replace(/\.json$/i, "") || `Imported save ${slot}`;
        payload.savedAt = new Date().toISOString();
        writeSaveSlot(slot, payload);
        selectedMenuSaveSlot = null;
        loadSavePayload(payload);
      } catch (error) {
        openInfoDialog("Invalid savegame", text("save.invalidImportAlert"));
      }
    };
    reader.readAsText(file);
  });

  input.click();
  return true;
}

function getSaveMenuLayout() {
  const panelW = 620;
  const panelH = 520;
  const x = VIEW.w / 2 - panelW / 2;
  const y = VIEW.h / 2 - panelH / 2;
  const cellW = 270;
  const cellH = 48;
  const gapX = 24;
  const gapY = 12;
  const startX = x + 35;
  const startY = y + 145;

  return { x, y, panelW, panelH, cellW, cellH, gapX, gapY, startX, startY };
}

function rebuildSaveSlotRects() {
  saveSlotRects.length = 0;
  const layout = getSaveMenuLayout();

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    saveSlotRects.push({
      slot: i + 1,
      x: layout.startX + col * (layout.cellW + layout.gapX),
      y: layout.startY + row * (layout.cellH + layout.gapY),
      w: layout.cellW,
      h: layout.cellH
    });
  }

  saveSlotRects.push({
    slot: "auto",
    x: layout.startX,
    y: layout.startY + 5 * (layout.cellH + layout.gapY) + 6,
    w: layout.cellW * 2 + layout.gapX,
    h: layout.cellH
  });
}

function getSaveSlotAt(mx, my) {
  rebuildSaveSlotRects();
  return saveSlotRects.find(rect => mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) || null;
}

function drawMenuEnemyShip() {
  const design = getEnemyDesign(3);
  const modules = design.modules.map((module, index) => ({
    ...module,
    id: index + 1,
    _thrustActive: module.type === "Main Thruster" || module.type === "RCS Thruster"
  }));
  const com = getCenterOfMass(modules);
  const t = performance.now() * 0.001;
  const cycle = 18000;
  const progress = (performance.now() % cycle) / cycle;
  const x = -180 + progress * (VIEW.w + 360);
  const y = VIEW.h * 0.29;
  const grid = 16;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 2);

  for (const module of modules) {
    const w = module.w || 1;
    const h = module.h || 1;
    const center = getModuleCenter(module);
    const relX = (center.x - com.x) * grid;
    const relY = (center.y - com.y) * grid;
    const rot = module.rot || 0;
    const isThruster = module.type === "Main Thruster" || module.type === "RCS Thruster";
    const spriteName = isThruster ? module.type + " On" : module.type;
    const drawW = w * grid;
    const drawH = h * grid;

    ctx.save();
    ctx.translate(relX, relY);
    ctx.rotate(rot * Math.PI / 2);
    ctx.globalAlpha = 0.92;
    ctx.imageSmoothingEnabled = false;

    if (!drawImageSprite(spriteName, -drawW / 2, -drawH / 2, drawW, drawH)) {
      ctx.fillStyle = "rgba(32,54,92,0.95)";
      ctx.fillRect(-drawW / 2, -drawH / 2, drawW, drawH);
      ctx.strokeStyle = "rgba(120,170,255,0.7)";
      ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
    }

    if (isTurretType(module.type)) {
      drawImageSprite(getTurretBaseSpriteName(module.type), -drawW / 2, -drawH / 2, drawW, drawH);
      const topSprite = getTurretTopSpriteName(module.type);
      if (topSprite) drawImageSprite(topSprite, -drawW / 2, -drawH / 2, drawW, drawH);
    }

    ctx.restore();
  }

  ctx.restore();
}

function drawLogoCentered(centerX, y, maxW, maxH) {
  if (logoImage.complete && logoImage.naturalWidth > 0) {
    const scale = Math.min(maxW / logoImage.naturalWidth, maxH / logoImage.naturalHeight);
    const w = logoImage.naturalWidth * scale;
    const h = logoImage.naturalHeight * scale;
    ctx.drawImage(logoImage, centerX - w / 2, y, w, h);
    return y + h;
  }

  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text("game.title"), centerX, y + maxH / 2);
  return y + maxH;
}

function drawStarMenuBackground() {
  ctx.fillStyle = "#14162a";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  const nebulaA = ctx.createRadialGradient(VIEW.w * 0.72, VIEW.h * 0.22, 0, VIEW.w * 0.72, VIEW.h * 0.22, Math.max(VIEW.w, VIEW.h) * 0.42);
  nebulaA.addColorStop(0, "rgba(75,120,255,0.18)");
  nebulaA.addColorStop(0.42, "rgba(45,75,170,0.08)");
  nebulaA.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebulaA;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  const nebulaB = ctx.createRadialGradient(VIEW.w * 0.18, VIEW.h * 0.76, 0, VIEW.w * 0.18, VIEW.h * 0.76, Math.max(VIEW.w, VIEW.h) * 0.34);
  nebulaB.addColorStop(0, "rgba(85,175,255,0.12)");
  nebulaB.addColorStop(0.55, "rgba(30,80,150,0.06)");
  nebulaB.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebulaB;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  for (let i = 0; i < 260; i++) {
    const sx = (Math.sin(i * 137.5) * 0.5 + 0.5) * VIEW.w;
    const sy = (Math.cos(i * 97.3) * 0.5 + 0.5) * VIEW.h;
    ctx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }

  const t = performance.now() * 0.00008;
  const planetX = VIEW.w * 0.18 + Math.cos(t) * 36;
  const planetY = VIEW.h * 0.72 + Math.sin(t * 1.4) * 24;
  const radius = Math.max(52, Math.min(VIEW.w, VIEW.h) * 0.075);
  const gradient = ctx.createRadialGradient(planetX - radius * 0.35, planetY - radius * 0.35, 0, planetX, planetY, radius);
  gradient.addColorStop(0, "rgba(120,190,255,0.9)");
  gradient.addColorStop(0.55, "rgba(34,93,178,0.85)");
  gradient.addColorStop(1, "rgba(6,18,56,0.25)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(planetX, planetY, radius, 0, Math.PI * 2);
  ctx.fill();

  drawMenuEnemyShip();
}

function getStartMenuLayout() {
  const panelW = 620;
  const panelH = 360;
  const x = VIEW.w / 2 - panelW / 2;
  const y = VIEW.h / 2 - panelH / 2;
  return {
    x, y, panelW, panelH,
    play: { x: VIEW.w / 2 - 135, y: y + 230, w: 270, h: 38 }
  };
}

function drawStartMenu() {
  drawStarMenuBackground();
  const layout = getStartMenuLayout();

  ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
  ctx.fillRect(layout.x, layout.y, layout.panelW, layout.panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.panelW, layout.panelH);

  drawLogoCentered(VIEW.w / 2, layout.y + 46, 420, 132);
  drawBtn("Play", layout.play.x, layout.play.y, layout.play.w, layout.play.h, true);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "12px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text("game.version"), VIEW.w - 16, VIEW.h - 36);
  ctx.fillText(text("game.credits"), VIEW.w - 16, VIEW.h - 17);
}

function getStartButtonAt(mx, my) {
  const { play } = getStartMenuLayout();
  return mx >= play.x && mx <= play.x + play.w && my >= play.y && my <= play.y + play.h ? "play" : null;
}

function drawSaveSlot(rect, save, active = false) {
  const adminSave = !!save?.toggles?.adminInstantBuild;
  ctx.fillStyle = adminSave
    ? "rgba(150, 24, 34, 0.9)"
    : active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.86)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = adminSave ? "rgba(255,80,80,0.9)" : active ? "#ccf6ff" : "rgba(100,150,255,0.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  ctx.fillStyle = "white";
  ctx.font = "13px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const title = save ? save.name || text("menu.unnamedSave") : rect.slot === "auto" ? text("menu.autosaveEmpty") : text("menu.emptySlot");
  ctx.fillText(title, rect.x + 10, rect.y + 17);

  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "10px Arial";
  const detail = save
    ? `${formatSaveDate(save.savedAt)}${adminSave ? "  ADMIN" : ""}`
    : rect.slot === "auto" ? text("menu.lastAutomaticSave") : text("menu.clickToStart");
  ctx.fillText(detail, rect.x + 10, rect.y + 35);
}

function drawGameTitlePanel(subtitle) {
  const layout = getSaveMenuLayout();
  ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
  ctx.fillRect(layout.x, layout.y, layout.panelW, layout.panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.panelW, layout.panelH);

  const logoBottom = drawLogoCentered(VIEW.w / 2, layout.y + 24, 330, 78);

  ctx.font = "13px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(subtitle, VIEW.w / 2, Math.max(layout.y + 108, logoBottom + 14));
  return layout;
}

function drawMainMenu() {
  drawStarMenuBackground();
  drawGameTitlePanel(text("menu.selectSaveSlot"));
  rebuildSaveSlotRects();

  for (const rect of saveSlotRects) {
    drawSaveSlot(rect, readSaveSlot(rect.slot));
  }

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "12px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text("game.version"), VIEW.w - 16, VIEW.h - 36);
  ctx.fillText(text("game.credits"), VIEW.w - 16, VIEW.h - 17);

  drawMenuSaveActionDialog();
  drawSeedDialog();
  drawUiDialog();
}

function getSeedDialogLayout() {
  const w = 360;
  const h = 190;
  const x = VIEW.w / 2 - w / 2;
  const y = VIEW.h / 2 - h / 2;
  return {
    x, y, w, h,
    input: { x: x + 35, y: y + 74, w: w - 70, h: 34 },
    play: { x: x + 35, y: y + 126, w: 135, h: 34 },
    cancel: { x: x + w - 170, y: y + 126, w: 135, h: 34 }
  };
}

function drawSeedDialog() {
  if (!seedDialogOpen) return;
  const layout = getSeedDialogLayout();

  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = "rgba(4, 10, 30, 0.97)";
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
  ctx.strokeStyle = "rgba(100,150,255,0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.w, layout.h);

  ctx.fillStyle = "white";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("World seed", VIEW.w / 2, layout.y + 28);

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(layout.input.x, layout.input.y, layout.input.w, layout.input.h);
  ctx.strokeStyle = "#66aaff";
  ctx.strokeRect(layout.input.x, layout.input.y, layout.input.w, layout.input.h);

  ctx.font = "13px Arial";
  ctx.textAlign = "left";
  ctx.fillStyle = pendingSeedInput ? "white" : "rgba(255,255,255,0.42)";
  ctx.fillText(pendingSeedInput || "Leer lassen fuer zufaelligen Seed", layout.input.x + 10, layout.input.y + layout.input.h / 2);

  drawBtn("Play", layout.play.x, layout.play.y, layout.play.w, layout.play.h, true);
  drawBtn("Cancel", layout.cancel.x, layout.cancel.y, layout.cancel.w, layout.cancel.h, false);
}

function getSeedDialogButtonAt(mx, my) {
  if (!seedDialogOpen) return null;
  const layout = getSeedDialogLayout();
  if (mx >= layout.play.x && mx <= layout.play.x + layout.play.w && my >= layout.play.y && my <= layout.play.y + layout.play.h) return "play";
  if (mx >= layout.cancel.x && mx <= layout.cancel.x + layout.cancel.w && my >= layout.cancel.y && my <= layout.cancel.y + layout.cancel.h) return "cancel";
  if (mx >= layout.x && mx <= layout.x + layout.w && my >= layout.y && my <= layout.y + layout.h) return "dialog";
  return "outside";
}

function getUiDialogLayout() {
  const w = Math.min(420, VIEW.w - 48);
  const fieldCount = uiDialog?.fields?.length || 0;
  const bodyLines = uiDialog?.body ? Math.ceil(String(uiDialog.body).length / 48) : 0;
  const h = Math.max(180, 120 + fieldCount * 58 + bodyLines * 22);
  const x = VIEW.w / 2 - w / 2;
  const y = VIEW.h / 2 - h / 2;
  const buttons = uiDialog?.buttons || [];
  return {
    x, y, w, h,
    fields: (uiDialog?.fields || []).map((field, index) => ({ x: x + 35, y: y + 66 + index * 58, w: w - 70, h: 34 })),
    buttons: buttons.map((button, index) => {
      const bw = buttons.length === 1 ? 120 : 135;
      const gap = 18;
      const total = buttons.length * bw + (buttons.length - 1) * gap;
      return { id: button.id, x: x + w / 2 - total / 2 + index * (bw + gap), y: y + h - 50, w: bw, h: 34 };
    })
  };
}

function drawWrappedDialogText(body, x, y, maxWidth) {
  if (!body) return y;
  ctx.font = "13px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  const words = String(body).split(/\s+/);
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += 20;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += 20;
  }
  return y;
}

function ensureDialogFieldState(field) {
  field.value = String(field.value ?? "");
  if (field.cursor === undefined) field.cursor = field.value.length;
  field.cursor = Math.max(0, Math.min(field.value.length, field.cursor));
  if (field.selectionStart === undefined) field.selectionStart = field.cursor;
  if (field.selectionEnd === undefined) field.selectionEnd = field.cursor;
  field.selectionStart = Math.max(0, Math.min(field.value.length, field.selectionStart));
  field.selectionEnd = Math.max(0, Math.min(field.value.length, field.selectionEnd));
  return field;
}

function getDialogFieldSelection(field) {
  ensureDialogFieldState(field);
  return {
    start: Math.min(field.selectionStart, field.selectionEnd),
    end: Math.max(field.selectionStart, field.selectionEnd)
  };
}

function clearDialogFieldSelection(field) {
  field.selectionStart = field.cursor;
  field.selectionEnd = field.cursor;
}

function setDialogFieldCursor(field, cursor, selecting = false) {
  ensureDialogFieldState(field);
  const next = Math.max(0, Math.min(field.value.length, cursor));
  if (selecting) {
    field.selectionEnd = next;
  } else {
    field.selectionStart = next;
    field.selectionEnd = next;
  }
  field.cursor = next;
}

function selectDialogFieldText(field) {
  ensureDialogFieldState(field);
  field.cursor = field.value.length;
  field.selectionStart = 0;
  field.selectionEnd = field.value.length;
}

function insertDialogFieldText(field, textValue) {
  ensureDialogFieldState(field);
  const selection = getDialogFieldSelection(field);
  const before = field.value.slice(0, selection.start);
  const after = field.value.slice(selection.end);
  const nextText = String(textValue || "");
  field.value = before + nextText + after;
  setDialogFieldCursor(field, before.length + nextText.length);
}

function deleteDialogFieldBackward(field) {
  ensureDialogFieldState(field);
  const selection = getDialogFieldSelection(field);
  if (selection.start !== selection.end) {
    insertDialogFieldText(field, "");
    return;
  }
  if (field.cursor <= 0) return;
  field.value = field.value.slice(0, field.cursor - 1) + field.value.slice(field.cursor);
  setDialogFieldCursor(field, field.cursor - 1);
}

function deleteDialogFieldForward(field) {
  ensureDialogFieldState(field);
  const selection = getDialogFieldSelection(field);
  if (selection.start !== selection.end) {
    insertDialogFieldText(field, "");
    return;
  }
  if (field.cursor >= field.value.length) return;
  field.value = field.value.slice(0, field.cursor) + field.value.slice(field.cursor + 1);
  setDialogFieldCursor(field, field.cursor);
}

function getDialogCursorFromMouse(field, rect, mx) {
  ensureDialogFieldState(field);
  ctx.font = "13px Arial";
  const textX = rect.x + 10;
  const localX = Math.max(0, mx - textX);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= field.value.length; i++) {
    const width = ctx.measureText(field.value.slice(0, i)).width;
    const dist = Math.abs(width - localX);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

function drawUiDialog() {
  if (!uiDialog) return;
  const layout = getUiDialogLayout();

  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = "rgba(4, 10, 30, 0.97)";
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
  ctx.strokeStyle = "rgba(100,150,255,0.82)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.w, layout.h);

  ctx.fillStyle = "white";
  ctx.font = "bold 15px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(uiDialog.title || "", VIEW.w / 2, layout.y + 28);

  let bodyY = layout.y + 58;
  if (uiDialog.body) bodyY = drawWrappedDialogText(uiDialog.body, layout.x + 35, bodyY, layout.w - 70);

  for (let i = 0; i < (uiDialog.fields || []).length; i++) {
    const field = ensureDialogFieldState(uiDialog.fields[i]);
    const rect = layout.fields[i];
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = i === activeDialogField ? "#ccf6ff" : "#66aaff";
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText(field.label, rect.x, rect.y - 8);
    ctx.font = "13px Arial";
    const textX = rect.x + 10;
    const textY = rect.y + rect.h / 2;
    const displayText = field.value || field.placeholder || "";
    const selection = getDialogFieldSelection(field);

    if (field.value && selection.start !== selection.end) {
      const selX = textX + ctx.measureText(field.value.slice(0, selection.start)).width;
      const selW = ctx.measureText(field.value.slice(selection.start, selection.end)).width;
      ctx.fillStyle = "rgba(80, 190, 255, 0.42)";
      ctx.fillRect(selX, rect.y + 7, selW, rect.h - 14);
    }

    ctx.fillStyle = field.value ? "white" : "rgba(255,255,255,0.42)";
    ctx.fillText(displayText, textX, textY);

    if (i === activeDialogField && field.value) {
      const caretX = textX + ctx.measureText(field.value.slice(0, field.cursor)).width;
      const blink = Math.floor(performance.now() / 480) % 2 === 0;
      if (blink || selection.start !== selection.end) {
        ctx.strokeStyle = "#ccf6ff";
        ctx.beginPath();
        ctx.moveTo(caretX, rect.y + 7);
        ctx.lineTo(caretX, rect.y + rect.h - 7);
        ctx.stroke();
      }
    } else if (i === activeDialogField && !field.value) {
      const blink = Math.floor(performance.now() / 480) % 2 === 0;
      if (blink) {
        ctx.strokeStyle = "#ccf6ff";
        ctx.beginPath();
        ctx.moveTo(textX, rect.y + 7);
        ctx.lineTo(textX, rect.y + rect.h - 7);
        ctx.stroke();
      }
    }
  }

  for (const button of layout.buttons) {
    const config = uiDialog.buttons.find(item => item.id === button.id);
    drawBtn(config.text, button.x, button.y, button.w, button.h, !!config.primary);
  }
}

function submitUiDialog(buttonId = "ok") {
  if (!uiDialog) return;
  const dialog = uiDialog;
  if (buttonId === "cancel") {
    uiDialog = null;
    return;
  }
  const values = Object.fromEntries((dialog.fields || []).map(field => [field.id, field.value || ""]));
  uiDialog = null;
  if (typeof dialog.onSubmit === "function") dialog.onSubmit(values);
}

function handleUiDialogClick(mx, my) {
  if (!uiDialog) return false;
  const layout = getUiDialogLayout();

  for (let i = 0; i < layout.fields.length; i++) {
    const rect = layout.fields[i];
    if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
      activeDialogField = i;
      setDialogFieldCursor(uiDialog.fields[i], getDialogCursorFromMouse(uiDialog.fields[i], rect, mx));
      canvas.focus();
      return true;
    }
  }

  for (const button of layout.buttons) {
    if (mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h) {
      submitUiDialog(button.id);
      return true;
    }
  }
  return true;
}

function handleUiDialogDoubleClick(mx, my) {
  if (!uiDialog) return false;
  const layout = getUiDialogLayout();
  for (let i = 0; i < layout.fields.length; i++) {
    const rect = layout.fields[i];
    if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
      activeDialogField = i;
      selectDialogFieldText(uiDialog.fields[i]);
      canvas.focus();
      return true;
    }
  }
  return false;
}

function getMenuSaveActionLayout() {
  const w = 320;
  const h = 310;
  const x = VIEW.w / 2 - w / 2;
  const y = VIEW.h / 2 - h / 2;
  const bx = x + 35;
  const bw = w - 70;
  const bh = 34;
  const gap = 12;
  const by = y + 74;

  return {
    x, y, w, h,
    play: { x: bx, y: by, w: bw, h: bh },
    exportSave: { x: bx, y: by + (bh + gap), w: bw, h: bh },
    importSave: { x: bx, y: by + (bh + gap) * 2, w: bw, h: bh },
    exit: { x: bx, y: by + (bh + gap) * 3, w: bw, h: bh },
    del: { x: bx, y: by + (bh + gap) * 4, w: bw, h: bh }
  };
}

function drawMenuSaveActionDialog() {
  if (!selectedMenuSaveSlot) return;

  const save = readSaveSlot(selectedMenuSaveSlot);
  const layout = getMenuSaveActionLayout();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.fillStyle = "rgba(4, 10, 30, 0.96)";
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
  ctx.strokeStyle = "rgba(100,150,255,0.75)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.w, layout.h);

  ctx.fillStyle = "white";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(save ? save.name || text("menu.unnamedSave") : text("menu.emptySaveSlot"), layout.x + layout.w / 2, layout.y + 25);

  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "10px Arial";
  ctx.fillText(save ? formatSaveDate(save.savedAt) : text("menu.importOrStart"), layout.x + layout.w / 2, layout.y + 43);

  drawBtn(text("buttons.play"), layout.play.x, layout.play.y, layout.play.w, layout.play.h, true);
  drawBtn(text("buttons.exportSavegame"), layout.exportSave.x, layout.exportSave.y, layout.exportSave.w, layout.exportSave.h, false);
  drawBtn(text("buttons.importSavegame"), layout.importSave.x, layout.importSave.y, layout.importSave.w, layout.importSave.h, false);
  drawBtn(text("buttons.exit"), layout.exit.x, layout.exit.y, layout.exit.w, layout.exit.h, false);
  ctx.fillStyle = "rgba(150, 24, 34, 0.9)";
  ctx.fillRect(layout.del.x, layout.del.y, layout.del.w, layout.del.h);
  ctx.fillStyle = "white";
  ctx.font = "11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text("buttons.delete"), layout.del.x + layout.del.w / 2, layout.del.y + layout.del.h / 2);
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.strokeRect(layout.del.x, layout.del.y, layout.del.w, layout.del.h);
}

function getMenuSaveActionButtonAt(mx, my) {
  if (!selectedMenuSaveSlot) return null;
  const layout = getMenuSaveActionLayout();

  if (mx >= layout.play.x && mx <= layout.play.x + layout.play.w && my >= layout.play.y && my <= layout.play.y + layout.play.h) return "play";
  if (mx >= layout.exportSave.x && mx <= layout.exportSave.x + layout.exportSave.w && my >= layout.exportSave.y && my <= layout.exportSave.y + layout.exportSave.h) return "export";
  if (mx >= layout.importSave.x && mx <= layout.importSave.x + layout.importSave.w && my >= layout.importSave.y && my <= layout.importSave.y + layout.importSave.h) return "import";
  if (mx >= layout.exit.x && mx <= layout.exit.x + layout.exit.w && my >= layout.exit.y && my <= layout.exit.y + layout.exit.h) return "exit";
  if (mx >= layout.del.x && mx <= layout.del.x + layout.del.w && my >= layout.del.y && my <= layout.del.y + layout.del.h) return "delete";
  if (mx >= layout.x && mx <= layout.x + layout.w && my >= layout.y && my <= layout.y + layout.h) return "dialog";
  return "outside";
}

function drawPauseMenu() {
  const layout = getSaveMenuLayout();
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  ctx.fillStyle = "rgba(4, 10, 30, 0.94)";
  ctx.fillRect(layout.x, layout.y, layout.panelW, layout.panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.panelW, layout.panelH);

  ctx.fillStyle = "white";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText(text("pause.title"), VIEW.w / 2, layout.y + 52);

  const saveButton = { x: VIEW.w / 2 - 135, y: layout.y + 88, w: 270, h: 34 };
  const closeButton = { x: VIEW.w / 2 - 135, y: layout.y + layout.panelH - 70, w: 270, h: 34 };
  drawBtn(saveSelectionMode ? text("buttons.selectSaveSlot") : text("buttons.saveGame"), saveButton.x, saveButton.y, saveButton.w, saveButton.h, !!saveSelectionMode);
  drawBtn(text("buttons.closeGame"), closeButton.x, closeButton.y, closeButton.w, closeButton.h, false);
  ctx.strokeStyle = "rgba(255,80,80,0.9)";
  ctx.strokeRect(closeButton.x, closeButton.y, closeButton.w, closeButton.h);

  if (saveSelectionMode) {
    rebuildSaveSlotRects();
    for (const rect of saveSlotRects.filter(rect => rect.slot !== "auto")) {
      drawSaveSlot(rect, readSaveSlot(rect.slot), pendingOverwriteSlot === rect.slot);
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.font = "13px Arial";
    ctx.textAlign = "center";
    ctx.fillText(text("pause.resumeHint"), VIEW.w / 2, layout.y + 150);
  }
}

function getPauseButtonAt(mx, my) {
  const layout = getSaveMenuLayout();
  const saveButton = { x: VIEW.w / 2 - 135, y: layout.y + 88, w: 270, h: 34 };
  const closeButton = { x: VIEW.w / 2 - 135, y: layout.y + layout.panelH - 70, w: 270, h: 34 };

  if (mx >= saveButton.x && mx <= saveButton.x + saveButton.w && my >= saveButton.y && my <= saveButton.y + saveButton.h) return "save";
  if (mx >= closeButton.x && mx <= closeButton.x + closeButton.w && my >= closeButton.y && my <= closeButton.y + closeButton.h) return "close";
  return null;
}

let inactiveOverlayDrawn = false;

function drawInactiveWindowOverlay() {
  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("PAUSED", VIEW.w / 2, VIEW.h / 2);
}

function handleGameInterfaceClick(mx, my) {
  if (handleUiDialogClick(mx, my)) return true;

  if (appState === "start") {
    if (getStartButtonAt(mx, my) === "play") {
      appState = "menu";
      playSound("toggle", 120);
      return true;
    }
    return false;
  }

  if (appState === "menu") {
    if (seedDialogOpen) {
      const seedAction = getSeedDialogButtonAt(mx, my);
      if (seedAction === "play") {
        startPendingSeedGame();
        return true;
      }
      if (seedAction === "cancel" || seedAction === "outside") {
        seedDialogOpen = false;
        pendingNewGameSlot = null;
        pendingNewGameName = "";
        pendingSeedInput = "";
        return true;
      }
      return seedAction === "dialog";
    }

    const action = getMenuSaveActionButtonAt(mx, my);
    if (action === "play") {
      const slot = selectedMenuSaveSlot;
      const save = readSaveSlot(slot);
      selectedMenuSaveSlot = null;
      if (save) return loadSaveSlot(slot);

      if (slot === "auto") return true;
      openNewWorldDialog(slot);
      return true;
    }
    if (action === "export") {
      return exportSaveSlot(selectedMenuSaveSlot);
    }
    if (action === "import") {
      return importSaveIntoSlot(selectedMenuSaveSlot);
    }
    if (action === "exit") {
      selectedMenuSaveSlot = null;
      return true;
    }
    if (action === "delete") {
      const save = readSaveSlot(selectedMenuSaveSlot);
      if (!save) {
        openInfoDialog("Empty save slot", text("save.emptySlotAlert"));
        return true;
      }
      openConfirmDialog("Delete savegame", text("save.deleteConfirm", { name: save.name || text("save.thisSavegame") }), () => {
        localStorage.removeItem(getSaveSlotKey(selectedMenuSaveSlot));
        selectedMenuSaveSlot = null;
      });
      return true;
    }
    if (action === "dialog") return true;
    if (action === "outside") {
      selectedMenuSaveSlot = null;
      return true;
    }

    const rect = getSaveSlotAt(mx, my);
    if (!rect) return false;

    selectedMenuSaveSlot = rect.slot;
    return true;
  }

  if (appState === "paused") {
    const button = getPauseButtonAt(mx, my);
    if (button === "save") {
      saveSelectionMode = "manual";
      pendingSavePayload = createSavePayload(currentSaveName || text("menu.unnamedSave"));
      pendingSaveName = pendingSavePayload.name;
      return true;
    }
    if (button === "close") {
      appState = "menu";
      saveSelectionMode = null;
      pendingSavePayload = null;
      pendingOverwriteSlot = null;
      stopAllLoopSounds();
      return true;
    }

    if (saveSelectionMode) {
      const rect = getSaveSlotAt(mx, my);
      if (rect && rect.slot !== "auto") {
        requestSaveToSlot(rect.slot);
        return true;
      }
    }
  }

  return false;
}

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (!appWindowActive) {
    stopAllLoopSounds();
    if (!inactiveOverlayDrawn) {
      drawInactiveWindowOverlay();
      inactiveOverlayDrawn = true;
    }
    requestAnimationFrame(loop);
    return;
  }

  inactiveOverlayDrawn = false;

  const simulationActive = appState === "playing" && appWindowActive && !shouldBlockSimulationForOverlay();
  const stepDt = simulationActive ? dt : 0;
  if (simulationActive) worldPlayTime += dt;
  if (appState === "playing" && appWindowActive && !shouldBlockSimulationForOverlay()) updateTutorial(dt);

  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  if (appState === "start") {
    updateMenuThrusterSound(true);
    drawStartMenu();
    requestAnimationFrame(loop);
    return;
  }

  if (appState === "menu") {
    updateMenuThrusterSound(true);
    drawMainMenu();
    requestAnimationFrame(loop);
    return;
  }

  updateMenuThrusterSound(false);

  ctx.fillStyle = buildMode ? "#0e2a5f" : "#14162a";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  if (!buildMode) {
    // Galaxy background (nebula, dust)
    drawGalaxyBackground();

    // Parallax background stars (screen-space wrapped, moves with camera)
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    for (let i = 0; i < 200; i++) {
      const layer = 0.012 + (i % 5) * 0.006;
      const baseX = (Math.sin(i * 137.5) * 0.5 + 0.5) * VIEW.w;
      const baseY = (Math.cos(i * 97.3) * 0.5 + 0.5) * VIEW.h;
      const sx = ((baseX - camera.x * layer) % VIEW.w + VIEW.w) % VIEW.w;
      const sy = ((baseY - camera.y * layer) % VIEW.h + VIEW.h) % VIEW.h;
      ctx.fillRect(sx, sy, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
    }

    // Black hole
    if (blackHole) { blackHole.update(stepDt); blackHole.draw(); }

    // Stars
    for (const star of worldStars) {
      star.update(stepDt);
      drawStar(star);
    }

    // Asteroid belts
    for (const sys of solarSystems) {
      sys.innerBelt.update(stepDt);
      sys.innerBelt.draw();
      sys.outerBelt.update(stepDt);
      sys.outerBelt.draw();
    }

    if (simulationActive) updateDynamicBeltAsteroids();

    // Planets
    for (const planet of planets) {
      planet.update(stepDt);
      planet.draw();
    }

    // Free asteroids
    for (const asteroid of asteroids) {
      asteroid.update(stepDt);
      asteroid.draw();
    }
  } else {
    drawGrid();
  }

  if (simulationActive) {
    ship.update(dt);
    updateSpaceHazards(dt);
    updateBuildCamera();
    updateBuildMode();
    processCommit();
  }

  if (simulationActive && !buildMode) {
    updateRepairs(dt);
    updateHangarDroneRepairs(dt);
    updateResources(dt);
    camera.x += (ship.x - camera.x) * 0.08;
    camera.y += (ship.y - camera.y) * 0.08;
  }

  if (simulationActive) {
    updateTurretGuns(dt);
    updatePlayerTurrets(dt);
    updateLaserTurretBeams(dt);
    updateEnemyShips(dt);
    updateCombatBullets(dt);
    cleanupPlayerShipDamage();
    updateSmallShips(dt);
    autosaveIfNeeded();
    updateGameSounds();
  } else {
    stopAllLoopSounds();
  }

  drawModules();
  drawEnemyShips();
  drawSmallShips();
  drawBlueprints();
  drawGhost();
  drawTrajectory();
  drawCombatBullets();
  drawUI();
  drawResourceUI();
  drawOrbitIndicator();
  drawMapOverlay();
  drawTooltip();
  drawPlanetResourceTooltip();
  drawTutorialOverlay();
  drawUiDialog();

  if (appState === "paused") {
    drawPauseMenu();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
