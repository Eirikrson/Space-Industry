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
  localStorage.setItem(getSaveSlotKey(slot), JSON.stringify(payload));
}

function stripRuntimeState(value) {
  if (Array.isArray(value)) return value.map(stripRuntimeState);
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const key in value) {
    if (key.startsWith("_")) continue;
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
    combatBullets: stripRuntimeState(combatBullets),
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

function resetGeneratedWorld() {
  worldStars.length = 0;
  solarSystems.length = 0;
  planets.length = 0;
  asteroids.length = 0;
  nebulaPatches.length = 0;
  blackHole = null;
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
  blueprints.length = 0;
  demolishSet.clear();
  combatBullets.length = 0;
  for (const key in keys) keys[key] = false;
}

function resetGameToNew(name) {
  resetGameRuntime();

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

function loadSavePayload(payload) {
  if (!payload) return false;

  resetGameRuntime();
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

  const normalizeSavedModule = module => ({ ...module, type: normalizeModuleType(module.type) });
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
    matchRotateNose = !!payload.toggles.matchRotateNose;
    recallSmallShips = !!payload.toggles.recallSmallShips;
    shieldsActive = payload.toggles.shieldsActive !== false;
    repairMode = !!payload.toggles.repairMode;
    adminInstantBuild = (payload.version || 1) >= 2 ? !!payload.toggles.adminInstantBuild : false;
    autoBlueprintRepair = !!payload.toggles.autoBlueprintRepair;
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
  writeSaveSlot(slot, payload);
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
    const overwrite = window.confirm(text("save.overwriteConfirm", { name: existing.name || text("save.thisSavegame") }));
    if (!overwrite) {
      pendingOverwriteSlot = null;
      return;
    }
    pendingOverwriteSlot = slot;
  }

  const name = window.prompt(text("save.namePrompt"), defaultName);
  if (name === null) return;
  saveGameToSlot(slot, name.trim() || defaultName);
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
    window.alert(text("save.emptySlotAlert"));
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
        window.alert(text("save.invalidImportAlert"));
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

    if (module.type === "Turret") {
      drawImageSprite("TurretBase", -drawW / 2, -drawH / 2, drawW, drawH);
      drawImageSprite("TurretGunStraight", -drawW / 2, -drawH / 2, drawW, drawH);
    }

    ctx.restore();
  }

  ctx.restore();
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

function drawSaveSlot(rect, save, active = false) {
  ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.86)";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.65)";
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
  ctx.fillText(save ? formatSaveDate(save.savedAt) : rect.slot === "auto" ? text("menu.lastAutomaticSave") : text("menu.clickToStart"), rect.x + 10, rect.y + 35);
}

function drawGameTitlePanel(subtitle) {
  const layout = getSaveMenuLayout();
  ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
  ctx.fillRect(layout.x, layout.y, layout.panelW, layout.panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.panelW, layout.panelH);

  ctx.fillStyle = "white";
  ctx.font = "bold 34px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text("game.title"), VIEW.w / 2, layout.y + 58);

  ctx.font = "13px Arial";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(subtitle, VIEW.w / 2, layout.y + 94);
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
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text("buttons.delete"), layout.del.x + 5, layout.del.y + layout.del.h / 2);
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

function handleGameInterfaceClick(mx, my) {
  if (appState === "menu") {
    const action = getMenuSaveActionButtonAt(mx, my);
    if (action === "play") {
      const slot = selectedMenuSaveSlot;
      const save = readSaveSlot(slot);
      selectedMenuSaveSlot = null;
      if (save) return loadSaveSlot(slot);

      if (slot === "auto") return true;
      const defaultName = text("menu.newGameDefaultName", { slot });
      const name = window.prompt(text("menu.newGameNamePrompt"), defaultName);
      if (name === null) return true;
      resetGameToNew(name.trim() || defaultName);
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
        window.alert(text("save.emptySlotAlert"));
        return true;
      }
      const ok = window.confirm(text("save.deleteConfirm", { name: save.name || text("save.thisSavegame") }));
      if (ok) {
        localStorage.removeItem(getSaveSlotKey(selectedMenuSaveSlot));
        selectedMenuSaveSlot = null;
      }
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
  const simulationActive = appState === "playing" && appWindowActive;
  const stepDt = simulationActive ? dt : 0;
  if (simulationActive) worldPlayTime += dt;

  ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

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

  if (appState === "paused") {
    drawPauseMenu();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
