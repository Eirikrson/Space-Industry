const PARALLAX_STAR_PATTERN = Array.from({ length: 140 }, (_, i) => ({
  x: (Math.sin(i * 137.5) * 0.5 + 0.5),
  y: (Math.cos(i * 97.3) * 0.5 + 0.5),
  layer: 0.012 + (i % 5) * 0.006,
  size: i % 3 === 0 ? 2 : 1,
  alpha: 0.46 + (i % 4) * 0.08
}));

let mapFrameCache = null;
let mapFrameCacheKey = "";
let mapHitCache = { key: "", value: null };
let resourceTooltipCache = { key: "", frame: -1, value: null };
let uiFrameCounter = 0;

function drawParallaxStarfield() {
  for (const star of PARALLAX_STAR_PATTERN) {
    const sx = ((star.x * VIEW.w - camera.x * star.layer) % VIEW.w + VIEW.w) % VIEW.w;
    const sy = ((star.y * VIEW.h - camera.y * star.layer) % VIEW.h + VIEW.h) % VIEW.h;
    ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
    ctx.fillRect(sx, sy, star.size, star.size);
  }
}

function getCachedMapLayout() {
  if (mapVisible) syncMapWorldPositionsIfNeeded(worldPlayTime);
  const focusKey = mapFocusSystem ? solarSystems.indexOf(mapFocusSystem) : -1;
  const key = `${VIEW.w}:${VIEW.h}:${focusKey}:${worldPlayTime.toFixed(3)}`;
  if (!mapFrameCache || mapFrameCacheKey !== key) {
    mapFrameCache = getMapLayout();
    mapFrameCacheKey = key;
    mapHitCache.key = "";
  }
  return mapFrameCache;
}

function drawGrid() {
  const grid = CONFIG.GRID_SIZE;
  const size = grid * camera.scale;
  const center = worldToScreen(ship.x, ship.y);
  const ox = (center.x - size / 2) % size;
  const oy = (center.y - size / 2) % size;

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;

  for (let x = ox; x < VIEW.w; x += size) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, VIEW.h);
    ctx.stroke();
  }

  for (let y = oy; y < VIEW.h; y += size) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW.w, y);
    ctx.stroke();
  }
}

function drawStar(star = STAR) {
  // GalaxyStar has its own draw method
  if (star && typeof star.draw === "function") { star.draw(); return; }
  // Legacy fallback
  const p = worldToScreen(star.x, star.y);
  const r = star.radius * camera.scale;
  const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  gradient.addColorStop(0, "rgba(255,255,200,1)");
  gradient.addColorStop(0.3, "rgba(255,200,50,0.8)");
  gradient.addColorStop(1, "rgba(255,100,0,0)");
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawTurretRangeAt(x, y, active = true, type = "Gun Turret", forwardAngle = -Math.PI / 2) {
  const config = getTurretConfig(type);
  const rangeTiles = config.rangeTiles || 12;
  const range = rangeTiles * CONFIG.GRID_SIZE * camera.scale;

  ctx.beginPath();
  if (config.arc) {
    ctx.moveTo(x, y);
    ctx.arc(x, y, range, forwardAngle - config.arc / 2, forwardAngle + config.arc / 2);
    ctx.closePath();
    ctx.fillStyle = active ? "rgba(255,60,60,0.08)" : "rgba(255,60,60,0.045)";
    ctx.fill();
  } else {
    ctx.arc(x, y, range, 0, Math.PI * 2);
    ctx.fillStyle = active ? "rgba(255,60,60,0.055)" : "rgba(255,60,60,0.03)";
    ctx.fill();
  }
  ctx.strokeStyle = active ? "rgba(255,80,80,0.75)" : "rgba(255,80,80,0.45)";
  ctx.lineWidth = active ? 2 : 1.5;
  ctx.stroke();
}

function drawTurretModuleSprite(type, sw, sh, gunAngle = 0, module = null) {
  drawImageSprite(getTurretBodySpriteName(type, module), -sw / 2, -sh / 2, sw, sh);
  const topSprite = getTurretTopSpriteNameForModule(type, module);
  if (topSprite) {
    ctx.save();
    ctx.rotate(getTurretTopDrawAngle(type, gunAngle || 0));
    drawImageSprite(topSprite, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
}

function drawTurretIconSprite(type, x, y, w, h, module = null) {
  const baseDrawn = drawImageSprite(getTurretBodySpriteName(type, module, { preview: true }), x, y, w, h);
  const topSprite = getTurretTopSpriteNameForModule(type, module, { preview: true });
  if (topSprite) drawImageSprite(topSprite, x, y, w, h);
  return baseDrawn || !!topSprite;
}

function drawShieldArcAt(x, y, outDir, active = true) {
  const r = 4 * CONFIG.GRID_SIZE * camera.scale;

  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, outDir - Math.PI / 2, outDir + Math.PI / 2);
  ctx.closePath();
  ctx.strokeStyle = active ? "rgba(80,160,255,0.85)" : "rgba(80,160,255,0.5)";
  ctx.lineWidth = active ? 2.5 : 2;
  ctx.stroke();
  ctx.fillStyle = active ? "rgba(80,160,255,0.12)" : "rgba(80,160,255,0.07)";
  ctx.fill();
}

function drawDistantMotherShip() {
  const p = worldToScreen(ship.x, ship.y);
  const size = Math.max(7, Math.min(26, getShipCollisionRadius() * camera.scale));

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ship.angle);
  ctx.fillStyle = "rgba(90,190,255,0.92)";
  ctx.strokeStyle = "rgba(220,245,255,0.95)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.75);
  ctx.lineTo(0, size * 0.45);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawModules() {
  if (!buildMode && camera.scale <= 0.06) {
    drawDistantMotherShip();
    return;
  }

  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();

  if (buildMode || shieldsActive) {
    for (const m of placedModules) {
      if (m.type !== "Shield Generator") continue;
      const world = moduleWorldCenter(m);
      const p = worldToScreen(world.x, world.y);
      const rangePad = 4 * CONFIG.GRID_SIZE * camera.scale;
      if (p.x < -rangePad || p.x > VIEW.w + rangePad || p.y < -rangePad || p.y > VIEW.h + rangePad) continue;
      const outDir = ship.angle + (m.rot || 0) * Math.PI / 2 + Math.PI / 2;
      drawShieldArcAt(p.x, p.y, outDir, buildMode);
    }
  }

  for (const m of placedModules) {
    const isDemolish = demolishSet.has(m.id);
    const w = m.w || 1;
    const h = m.h || 1;
    const center = getModuleCenter(m);
    const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, ship.angle);
    const wx = ship.x + com.x * grid + rel.x;
    const wy = ship.y + com.y * grid + rel.y;
    const p = worldToScreen(wx, wy);
    const rot = m.rot || 0;
    const drawSize = getDrawSize(w, h, rot);
    const sw = drawSize.w * grid * camera.scale;
    const sh = drawSize.h * grid * camera.scale;
    const pad = Math.max(sw, sh) * 1.5;
    if (p.x < -pad || p.x > VIEW.w + pad || p.y < -pad || p.y > VIEW.h + pad) continue;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ship.angle + rot * Math.PI / 2);

    const isThruster = m.type === "Main Thruster" || m.type === "RCS Thruster";
    const spriteName = isThruster
      ? (m._thrustActive ? m.type + " On" : m.type + " Off")
      : m.type;

    // Tank liquid/gas color: draw it BEFORE the tank sprite.
    // If Tank.png has a transparent window, the color appears only behind that window.
    if (TANK_OPTIONS[m.type] && m.tankContent && TANK_COLORS[m.tankContent]) {
      ctx.fillStyle = TANK_COLORS[m.tankContent];
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    }

    if (isTurretType(m.type)) {
      drawTurretModuleSprite(m.type, sw, sh, m._gunAngle || 0, m);
      drawModuleHealthOverlay(m, sw, sh);
    } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
      ctx.fillStyle = m.type === "Computer" ? "cyan" : "rgba(40,50,70,0.85)";
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      ctx.strokeStyle = "rgba(150,180,255,0.4)";
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.fillStyle = "rgba(200,220,255,0.8)";
      ctx.font = `${Math.max(8, Math.min(12, sw / 6))}px Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.type, 0, 0);
    }

    if (!isTurretType(m.type)) drawModuleHealthOverlay(m, sw, sh);
    ctx.restore();

    if (isDemolish) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ship.angle + rot * Math.PI / 2);
      ctx.strokeStyle = "red";
      ctx.lineWidth = 3;
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.beginPath();
      ctx.moveTo(-sw / 2, -sh / 2);
      ctx.lineTo(sw / 2, sh / 2);
      ctx.moveTo(sw / 2, -sh / 2);
      ctx.lineTo(-sw / 2, sh / 2);
      ctx.stroke();
      ctx.restore();
    }

    if (m.tankContent && buildMode) {
      ctx.fillStyle = "rgba(0,200,255,0.9)";
      ctx.font = "10px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.tankContent, p.x, p.y);
    }

    if (isHangarType(m.type)) {
      const findShip = getSmallShipById(hangarFindShipId);
      const showAssigned = highlightedHangarId === m.id && performance.now() < hangarHighlightUntil;
      const showFree = findShip && isHangarFreeForShip(m, findShip);

      if (showAssigned || showFree) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ship.angle + rot * Math.PI / 2);
        ctx.strokeStyle = showAssigned ? "#66ff88" : "#66aaff";
        ctx.lineWidth = 4;
        ctx.strokeRect(-sw / 2 - 3, -sh / 2 - 3, sw + 6, sh + 6);
        ctx.restore();
      }
    }
  }
}

function drawSmallShipModule(smallShip, module, com) {
  const grid = CONFIG.GRID_SIZE;
  const center = getModuleCenter(module);
  const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, smallShip.angle || 0);
  const p = worldToScreen(smallShip.x + rel.x, smallShip.y + rel.y);
  const rot = module.rot || 0;
  const drawSize = getDrawSize(module.w || 1, module.h || 1, rot);
  const sw = drawSize.w * grid * camera.scale;
  const sh = drawSize.h * grid * camera.scale;
  const isThruster = module.type === "Main Thruster" || module.type === "RCS Thruster";
  const spriteName = isThruster
    ? (smallShip._thrusting ? module.type + " On" : module.type + " Off")
    : module.type;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate((smallShip.angle || 0) + rot * Math.PI / 2);

  if (TANK_OPTIONS[module.type] && module.tankContent && TANK_COLORS[module.tankContent]) {
    ctx.fillStyle = TANK_COLORS[module.tankContent];
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  }

  if (isTurretType(module.type)) {
    drawTurretModuleSprite(module.type, sw, sh, module._gunAngle || 0, module);
    drawModuleHealthOverlay(module, sw, sh);
  } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
    ctx.fillStyle = module.type === "Computer" ? "cyan" : "rgba(40,50,70,0.9)";
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    ctx.strokeStyle = "rgba(150,180,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
  }

  if (!isTurretType(module.type)) drawModuleHealthOverlay(module, sw, sh);
  ctx.restore();
}

function getHoveredTurretRangeSource() {
  if (heldItem !== AIR || importedShipGhost || isMouseOverInventory()) return null;

  if (buildMode) {
    if (!hoveredGrid) return null;
    const blueprint = blueprints.find(bp =>
      hoveredGrid.x >= bp.x &&
      hoveredGrid.x < bp.x + bp.w &&
      hoveredGrid.y >= bp.y &&
      hoveredGrid.y < bp.y + bp.h
    );
    if (blueprint && isTurretType(blueprint.type)) return blueprint;
    const result = getModuleAtCell(hoveredGrid.x, hoveredGrid.y);
    return result && isTurretType(result.module.type) ? result.module : null;
  }

  const result = getModuleAtScreen(mouse.x, mouse.y);
  return result && isTurretType(result.module.type) ? result.module : null;
}

function drawHoveredTurretRange() {
  const turret = getHoveredTurretRangeSource();
  if (!turret) return;
  const world = moduleWorldCenter(turret);
  const p = worldToScreen(world.x, world.y);
  drawTurretRangeAt(
    p.x,
    p.y,
    true,
    turret.type,
    ship.angle + (turret.rot || 0) * Math.PI / 2 - Math.PI / 2
  );
}

function drawSmallShipNameBadge(smallShip, p) {
  const cargoUsed = getSmallShipCargoUsed(smallShip);
  const cargoCap = Math.max(1, getSmallShipCargoCap(smallShip));
  const label = `${smallShip.name}  ${cargoUsed}/${cargoCap}`;

  ctx.font = "11px Consolas, monospace";
  ctx.textBaseline = "middle";
  const width = Math.max(86, ctx.measureText(label).width + 18);
  const height = 22;
  const x = p.x - width / 2;
  const y = p.y - Math.max(46, 44 * camera.scale);

  ctx.fillStyle = "rgba(4, 10, 30, 0.88)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(100,180,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText(label, p.x, y + height / 2);
}
function drawSmallShips() {
  if (buildMode) return;

  for (const smallShip of smallShips) {
    if (smallShip.status === "hangar" || smallShip.status === "building" || smallShip.status === "docking") continue;

    const p = worldToScreen(smallShip.x, smallShip.y);
    const margin = Math.max(120, getSmallShipClickRadius(smallShip) * camera.scale + 40);
    if (p.x < -margin || p.x > VIEW.w + margin || p.y < -margin || p.y > VIEW.h + margin) {
      continue;
    }

    const com = getCenterOfMass(smallShip.modules);

    for (const module of smallShip.modules) {
      drawSmallShipModule(smallShip, module, com);
    }

    drawSmallShipNameBadge(smallShip, p);
  }
}

function drawBlueprints() {
  if (!buildMode && !commitPending && blueprints.length === 0) return;

  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();

  for (const bp of blueprints) {
    const center = getModuleCenter(bp);
    const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, ship.angle);
    const p = worldToScreen(ship.x + com.x * grid + rel.x, ship.y + com.y * grid + rel.y);
    const drawSize = getDrawSize(bp.w, bp.h, bp.rot || 0);
    const sw = drawSize.w * grid * camera.scale;
    const sh = drawSize.h * grid * camera.scale;

    if (bp.type === "Shield Generator") {
      const outDir = ship.angle + (bp.rot || 0) * Math.PI / 2 + Math.PI / 2;
      drawShieldArcAt(p.x, p.y, outDir, true);
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ship.angle + (bp.rot || 0) * Math.PI / 2);
    ctx.globalAlpha = commitPending ? 0.35 : 0.55;

    const spriteName = bp.type === "Main Thruster" || bp.type === "RCS Thruster"
      ? bp.type + " On"
      : bp.type;

    if (isTurretType(bp.type)) {
      drawTurretModuleSprite(bp.type, sw, sh, 0);
    } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
      ctx.fillStyle = "rgba(0,150,255,0.35)";
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(100,180,255,0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
}

function drawImportedShipGhost() {
  if (!buildMode || !importedShipGhost || !hoveredGrid) return;
  if (isMouseOverInventory()) return;

  const modules = importedShipGhost.modules;
  const offset = getImportedShipOffset(hoveredGrid, modules);
  const canPlace = canPlaceImportedShip(hoveredGrid, modules);
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();

  let turretRangeDrawn = false;
  for (const module of modules) {
    const ghost = {
      x: module.x + offset.x,
      y: module.y + offset.y,
      w: module.w,
      h: module.h
    };
    const center = getModuleCenter(ghost);
    const rel = rotVec((center.x - com.x) * grid, (center.y - com.y) * grid, ship.angle);
    const p = worldToScreen(ship.x + com.x * grid + rel.x, ship.y + com.y * grid + rel.y);
    const drawSize = getDrawSize(module.w, module.h, module.rot || 0);
    const sw = drawSize.w * grid * camera.scale;
    const sh = drawSize.h * grid * camera.scale;

    if (module.type === "Shield Generator") {
      const outDir = ship.angle + (module.rot || 0) * Math.PI / 2 + Math.PI / 2;
      drawShieldArcAt(p.x, p.y, outDir, canPlace);
    }

    if (isTurretType(module.type) && !turretRangeDrawn) {
      drawTurretRangeAt(p.x, p.y, canPlace, module.type, ship.angle + (module.rot || 0) * Math.PI / 2 - Math.PI / 2);
      turretRangeDrawn = true;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ship.angle + (module.rot || 0) * Math.PI / 2);
    ctx.globalAlpha = canPlace ? 0.55 : 0.25;

    const spriteName = module.type === "Main Thruster" || module.type === "RCS Thruster"
      ? module.type + " On"
      : module.type;

    if (isTurretType(module.type)) {
      drawTurretModuleSprite(module.type, sw, sh, 0);
    } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
      ctx.fillStyle = canPlace ? "rgba(0,150,255,0.45)" : "rgba(255,80,80,0.45)";
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
    }

    ctx.strokeStyle = canPlace ? "rgba(100,210,255,0.9)" : "rgba(255,80,80,0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

function drawGhost() {
  if (importedShipGhost) {
    drawImportedShipGhost();
    return;
  }

  if (!buildMode || heldItem === AIR || !hoveredGrid) return;
  if (isMouseOverInventory()) return;

  const [w, h] = getRotatedSize(heldItem);
  const anchor = getAnchorForItem(hoveredGrid, heldItem);
  const canPlace = canPlaceBlueprint(anchor.x, anchor.y, w, h);
  const ghost = { x: anchor.x, y: anchor.y, w, h };
  const center = getModuleCenter(ghost);
  const com = getCenterOfMass();
  const rel = rotVec((center.x - com.x) * CONFIG.GRID_SIZE, (center.y - com.y) * CONFIG.GRID_SIZE, ship.angle);
  const p = worldToScreen(ship.x + com.x * CONFIG.GRID_SIZE + rel.x, ship.y + com.y * CONFIG.GRID_SIZE + rel.y);
  const drawSize = getDrawSize(w, h, rotation);
  const sw = drawSize.w * CONFIG.GRID_SIZE * camera.scale;
  const sh = drawSize.h * CONFIG.GRID_SIZE * camera.scale;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ship.angle + rotation * Math.PI / 2);

  ctx.globalAlpha = canPlace ? 0.7 : 0.35;

  const spriteName = heldItem.name === "Main Thruster" || heldItem.name === "RCS Thruster"
    ? heldItem.name + " On"
    : heldItem.name;

  if (isTurretType(heldItem.name)) {
    drawTurretModuleSprite(heldItem.name, sw, sh, 0);
  } else if (!drawImageSprite(spriteName, -sw / 2, -sh / 2, sw, sh)) {
    ctx.fillStyle = canPlace ? "rgba(255,255,255,0.4)" : "rgba(255,80,80,0.4)";
    ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
  }

  ctx.globalAlpha = 1;
  ctx.restore();

  if (isTurretType(heldItem.name)) {
    drawTurretRangeAt(p.x, p.y, true, heldItem.name, ship.angle + rotation * Math.PI / 2 - Math.PI / 2);
  }

  if (heldItem.name === "Shield Generator") {
    const outDir = ship.angle + rotation * Math.PI / 2 + Math.PI / 2;
    drawShieldArcAt(p.x, p.y, outDir, true);
  }
}

function drawMapTriangle(x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.7, size * 0.8);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(-size * 0.7, size * 0.8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function getSystemForBody(body) {
  if (!body) return null;
  if (body instanceof GalaxyStar) {
    return solarSystems.find(system => system.star === body) || null;
  }
  if (body instanceof GalaxyPlanet) {
    return solarSystems.find(system => system.planets.includes(body)) || null;
  }
  return null;
}

function getMapLayout() {
  const size = Math.min(980, VIEW.w - 80, VIEW.h - 80);
  const w = size;
  const h = size;
  const x = (VIEW.w - w) / 2;
  const y = (VIEW.h - h) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const focused = mapFocusSystem && solarSystems.includes(mapFocusSystem);
  const centerX = focused ? mapFocusSystem.star.x : CONFIG.GALAXY_CENTER_X;
  const centerY = focused ? mapFocusSystem.star.y : CONFIG.GALAXY_CENTER_Y;
  const worldRadius = focused
    ? Math.max(1, ...getSystemBelts(mapFocusSystem).map(belt => belt.outerR || 0), ...mapFocusSystem.planets.map(planet => planet.orbitRadius + planet.radius)) * 1.18
    : Math.max(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT) / 2;
  const scale = Math.min(w, h) / (worldRadius * 2);

  return { x, y, w, h, cx, cy, centerX, centerY, scale, focused };
}

function worldToMap(map, worldX, worldY) {
  return {
    x: map.cx + (worldX - map.centerX) * map.scale,
    y: map.cy + (worldY - map.centerY) * map.scale
  };
}

function mapToWorld(map, screenX, screenY) {
  return {
    x: map.centerX + (screenX - map.cx) / map.scale,
    y: map.centerY + (screenY - map.cy) / map.scale
  };
}

function getMapSystemForPoint(worldX, worldY) {
  let best = null;
  let bestDist = Infinity;

  for (const system of solarSystems) {
    const radius = Math.max(
      ...getSystemBelts(system).map(belt => belt.outerR || 0),
      ...system.planets.map(planet => planet.orbitRadius + planet.radius)
    );
    const dx = worldX - system.star.x;
    const dy = worldY - system.star.y;
    const distSq = dx * dx + dy * dy;
    const hitRadius = radius * 1.15;
    if (distSq <= hitRadius * hitRadius && distSq < bestDist) {
      best = system;
      bestDist = distSq;
    }
  }

  return best;
}

function drawMapPoint(map, worldX, worldY, radius, color) {
  const p = worldToMap(map, worldX, worldY);

  if (p.x < map.x || p.x > map.x + map.w || p.y < map.y || p.y > map.y + map.h) return;

  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawMapBody(map, body, color, minRadius = 3) {
  const p = worldToMap(map, body.x, body.y);
  if (p.x < map.x || p.x > map.x + map.w || p.y < map.y || p.y > map.y + map.h) return;

  const radius = Math.max(minRadius, body.radius * map.scale);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function getPlanetMapColor(planet) {
  const colors = {
    water: "#44aaff",
    lava: "#ff4400",
    ice: "#9ee8ff",
    desert: "#ffaa44",
    gas: "#ffdd66",
    metal: "#aaaaaa",
    jungle: "#44cc44",
    radioactive: "#88ff00"
  };

  return colors[planet.typeKey] || "#cccccc";
}

function drawGalaxySystemOnMap(map, system) {
  const star = system.star;
  const starP = worldToMap(map, star.x, star.y);

  const systemRadius = Math.max(
    ...getSystemBelts(system).map(belt => belt.outerR || 0),
    ...system.planets.map(planet => planet.orbitRadius + planet.radius)
  ) * map.scale;

  if (starP.x + systemRadius < map.x || starP.x - systemRadius > map.x + map.w || starP.y + systemRadius < map.y || starP.y - systemRadius > map.y + map.h) return;

  for (const planet of system.planets) {
    drawMapCircle(map, star.x, star.y, planet.orbitRadius, "rgba(120,170,255,0.14)", 1, 1);
  }

  for (const belt of getSystemBelts(system)) {
    drawMapBelt(belt, map, belt.kind === "outer" ? "rgba(120,200,255,0.18)" : "rgba(150,150,150,0.22)");
  }

  for (let i = 0; i < system.planets.length; i++) {
    const planet = system.planets[i];
    drawMapBody(map, planet, getPlanetMapColor(planet), 2);
  }

  drawMapBody(map, star, "#ffe066", 3);
}

function drawMapBodyLabel(map, body, label) {
  if (!map.focused || !label) return;

  const p = worldToMap(map, body.x, body.y);
  if (p.x < map.x || p.x > map.x + map.w || p.y < map.y || p.y > map.y + map.h) return;

  const radius = Math.max(3, body.radius * map.scale);
  ctx.font = "10px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(235,245,255,0.82)";
  ctx.fillText(label, p.x, p.y + radius + 4);
}

function drawMapCircle(map, worldX, worldY, worldRadius, color, alpha = 1, width = 1) {
  const p = worldToMap(map, worldX, worldY);
  const r = worldRadius * map.scale;
  if (p.x + r < map.x || p.x - r > map.x + map.w || p.y + r < map.y || p.y - r > map.y + map.h) return;

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawMapBelt(belt, map, fillColor) {
  if (!belt) return;

  drawMapCircle(map, belt.star.x, belt.star.y, (belt.innerR + belt.outerR) / 2, fillColor, 1, Math.min(18, Math.max(1, (belt.outerR - belt.innerR) * map.scale)));
}

function getMapBodyAt(mx, my) {
  if (!mapVisible || buildMode) return null;

  const cacheKey = `${Math.round(mx)}:${Math.round(my)}:${mapFocusSystem ? solarSystems.indexOf(mapFocusSystem) : -1}:${Math.floor(worldPlayTime)}`;
  if (mapHitCache.key === cacheKey) return mapHitCache.value;

  const map = getCachedMapLayout();
  if (mx < map.x || mx > map.x + map.w || my < map.y || my > map.y + map.h) return null;

  let best = null;
  let bestDist = Infinity;
  const stars = map.focused ? [mapFocusSystem.star] : worldStars;
  const systemPlanets = map.focused
    ? mapFocusSystem.planets
    : currentWorldIsEnd
      ? planets.filter(planet => planet instanceof EndTwinPlanet)
      : [];

  for (const star of stars) {
    const p = worldToMap(map, star.x, star.y);
    const dx = mx - p.x;
    const dy = my - p.y;
    const d = dx * dx + dy * dy;
    const system = getSystemForBody(star);
    const systemRadius = !map.focused && system
      ? Math.max(
          ...getSystemBelts(system).map(belt => belt.outerR || 0),
          ...system.planets.map(planet => planet.orbitRadius + planet.radius)
        ) * map.scale
      : 0;
    const hitRadius = map.focused
      ? Math.max(18, star.radius * map.scale + 6)
      : Math.max(36, systemRadius);
    if (d < hitRadius * hitRadius && d < bestDist) {
      best = { star, system };
      bestDist = d;
    }
  }

  for (const planet of systemPlanets) {
    const p = worldToMap(map, planet.x, planet.y);
    const dx = mx - p.x;
    const dy = my - p.y;
    const d = dx * dx + dy * dy;
    const hitRadius = Math.max(12, planet.radius * map.scale + 8);
    if (d < hitRadius * hitRadius && d < bestDist) {
      best = { planet, system: getSystemForBody(planet) };
      bestDist = d;
    }
  }

  if (!best && map.focused && mapFocusSystem) {
    const world = mapToWorld(map, mx, my);
    for (const belt of getSystemBelts(mapFocusSystem)) {
      const d = Math.hypot(world.x - belt.star.x, world.y - belt.star.y);
      if (d >= belt.innerR && d <= belt.outerR) {
        best = { belt, system: mapFocusSystem };
        break;
      }
    }
  }

  mapHitCache = { key: cacheKey, value: best };
  return best;
}

function handleMapClick(mx, my) {
  const hit = getMapBodyAt(mx, my);
  if (!hit) return false;

  if (hit.system) {
    mapFocusSystem = hit.system;
    notifyTutorialMapSystemClicked();
    if (hit.planet || hit.star) {
      selectedFlightTarget = hit.planet ? { planet: hit.planet } : { star: hit.star };
      velocityMatchTarget = selectedFlightTarget;
      flash("System map");
      playSound("toggle", 120);
    }
    return true;
  }

  return false;
}

function drawMapOverlay() {
  if (!mapVisible || buildMode) return;

  const map = getCachedMapLayout();
  const { x, y, w, h } = map;

  ctx.save();
  ctx.fillStyle = "rgba(0, 5, 18, 1)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(100,180,255,0.95)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  if (!map.focused && blackHole) {
    drawMapBody(map, blackHole, "#8800ff", 3);
  }

  const systemsToDraw = map.focused ? [mapFocusSystem] : solarSystems;

  if (!map.focused) {
    for (const star of worldStars) {
      drawMapCircle(map, CONFIG.GALAXY_CENTER_X, CONFIG.GALAXY_CENTER_Y, star.orbitRadius, "rgba(180,120,255,0.24)", 1, 1);
    }
  }

  // Planet orbits and asteroid belts are only useful in the focused system view.
  if (map.focused) {
    for (const system of systemsToDraw) {
      for (const planet of system.planets) {
        drawMapCircle(map, system.star.x, system.star.y, planet.orbitRadius, "rgba(120,170,255,0.18)", 1, 1);
      }

      for (const belt of getSystemBelts(system)) {
        const color = belt.kind === "outer" ? "rgba(120,200,255,0.28)" : "rgba(150,150,150,0.32)";
        drawMapBelt(belt, map, color);
      }
    }
  }

  if (map.focused) {
    drawMapBody(map, mapFocusSystem.star, "#ffe066", 5);
    drawMapBodyLabel(map, mapFocusSystem.star, mapFocusSystem.star.starType?.name || "Star");

    for (const planet of mapFocusSystem.planets) {
      drawMapBody(map, planet, getPlanetMapColor(planet), 3);
      drawMapBodyLabel(map, planet, planet.def?.name || planet.typeKey || "Planet");
    }
  } else {
    for (const system of solarSystems) {
      drawGalaxySystemOnMap(map, system);
    }

    if (currentWorldIsEnd) {
      for (const planet of planets) {
        if (!(planet instanceof EndTwinPlanet)) continue;
        drawMapBody(map, planet, planet.colors?.[1] || getPlanetMapColor(planet), 4);
      }
    }
  }

  for (const enemy of enemyShips) {
    const p = worldToMap(map, enemy.x, enemy.y);
    const px = p.x;
    const py = p.y;
    if (px < x || px > x + w || py < y || py > y + h) continue;
    drawMapTriangle(px, py, enemy.angle || 0, 7, currentWorldIsEnd ? "#c96cff" : "#ff3333");
  }

  const player = worldToMap(map, ship.x, ship.y);
  if (player.x >= x && player.x <= x + w && player.y >= y && player.y <= y + h) {
    drawMapTriangle(player.x, player.y, ship.angle || 0, 9, "#55aaff");
  }

  ctx.restore();

  ctx.font = "13px Consolas, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "white";
  ctx.fillText(map.focused ? "SYSTEM MAP  [ESC] galaxy" : "GALAXY MAP  [M]", x + 14, y + 18);
}

function drawDysonSpheres(activeSystems = solarSystems) {
  if (buildMode) return;

  for (const system of activeSystems) {
    const systemIndex = solarSystems.indexOf(system);
    if (systemIndex < 0) continue;
    if (!dysonSpheres[systemIndex]) continue;
    const progress = getDysonSphereProgress(systemIndex);
    if (progress <= 0) continue;

    const star = system.star;
    const p = worldToScreen(star.x, star.y);
    const radius = getDysonSphereWorldRadius(star) * camera.scale;
    if (p.x + radius < -40 || p.x - radius > VIEW.w + 40 || p.y + radius < -40 || p.y - radius > VIEW.h + 40) continue;

    ctx.save();
    ctx.translate(p.x, p.y);
    const complete = isDysonSphereComplete(systemIndex);

    if (complete) {
      const shell = ctx.createRadialGradient(
        -radius * 0.32, -radius * 0.36, radius * 0.05,
        0, 0, radius
      );
      shell.addColorStop(0, "#d5dbe0");
      shell.addColorStop(0.42, "#89939c");
      shell.addColorStop(0.78, "#4d565e");
      shell.addColorStop(1, "#252b30");
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = shell;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.lineWidth = Math.max(1, radius * 0.018);
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.ellipse(0, i * radius * 0.22, radius * 1.05, radius * 0.12, 0, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 === 0 ? "rgba(30,35,40,0.5)" : "rgba(220,230,235,0.16)";
        ctx.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        ctx.strokeStyle = "rgba(25,30,34,0.38)";
        ctx.stroke();
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(210,225,235,0.8)";
      ctx.lineWidth = Math.max(1.5, radius * 0.025);
      ctx.stroke();
    } else {
      ctx.rotate(performance.now() * 0.00012);
      ctx.globalAlpha = 0.35 + progress * 0.45;
      ctx.strokeStyle = "rgba(155,170,180,0.9)";
      ctx.lineWidth = Math.max(1.5, radius * 0.035);
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.stroke();

      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI;
        ctx.strokeStyle = `rgba(120,135,145,${0.12 + progress * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius * (0.2 + i * 0.12), angle, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function getDysonBuildButtonRect() {
  return { x: VIEW.w - 235, y: VIEW.h - 86, w: 220, h: 34 };
}

function drawDysonBuildButton() {
  if (buildMode || mapVisible) return;
  const star = getOrbitStarForDysonBuild();
  if (!star) {
    if (dysonPanelOpen) dysonPanelOpen = false;
    return;
  }

  const systemIndex = getSystemIndexForStar(star);
  const progress = Math.round(getDysonSphereProgress(systemIndex) * 100);
  const rect = getDysonBuildButtonRect();
  drawBtn(isDysonSphereComplete(systemIndex) ? "Dyson sphere complete" : `Build Dyson sphere ${progress}%`, rect.x, rect.y, rect.w, rect.h, dysonPanelOpen);
}

function handleDysonBuildButtonClick(mx, my) {
  if (buildMode || mapVisible) return false;
  const star = getOrbitStarForDysonBuild();
  if (!star) return false;
  const rect = getDysonBuildButtonRect();
  if (mx < rect.x || mx > rect.x + rect.w || my < rect.y || my > rect.y + rect.h) return false;

  const systemIndex = getSystemIndexForStar(star);
  dysonPanelOpen = !dysonPanelOpen || dysonPanelSystemIndex !== systemIndex;
  dysonPanelSystemIndex = systemIndex;
  playSound("toggle", 120);
  return true;
}

function getDysonPanelLayout() {
  const w = 340;
  const h = 284;
  const x = VIEW.w - w - 15;
  const y = Math.max(15, VIEW.h - h - 130);
  return {
    x, y, w, h,
    close: { x: x + w - 34, y: y + 10, w: 22, h: 22 },
    rowX: x + 16,
    rowY: y + 58,
    rowH: 31
  };
}

function drawDysonPanel() {
  if (!dysonPanelOpen || dysonPanelSystemIndex < 0 || !solarSystems[dysonPanelSystemIndex]) return;
  const layout = getDysonPanelLayout();
  const cost = getDysonSphereCost();
  const sphere = getDysonSphere(dysonPanelSystemIndex);
  const progress = getDysonSphereProgress(dysonPanelSystemIndex);

  ctx.fillStyle = "rgba(4, 10, 30, 0.96)";
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
  ctx.strokeStyle = "rgba(255,210,105,0.78)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.w, layout.h);

  ctx.fillStyle = "#ffd978";
  ctx.font = "bold 14px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DYSON SPHERE", layout.x + 16, layout.y + 22);
  drawBtn("X", layout.close.x, layout.close.y, layout.close.w, layout.close.h, false);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "12px Consolas, monospace";
  ctx.fillText(`Construction ${Math.round(progress * 100)}%`, layout.x + 16, layout.y + 44);

  let i = 0;
  for (const [key, needed] of Object.entries(cost)) {
    const y = layout.rowY + i * layout.rowH;
    const supplied = Math.floor(sphere.resources[key] || 0);
    const available = Math.floor(res[key] || 0);
    const done = supplied >= needed;
    const canAdd = !done && available > 0;

    ctx.fillStyle = done ? "rgba(80,190,120,0.28)" : "rgba(255,255,255,0.045)";
    ctx.fillRect(layout.rowX, y, layout.w - 32, layout.rowH - 5);
    ctx.strokeStyle = canAdd ? "rgba(255,210,105,0.62)" : "rgba(255,255,255,0.12)";
    ctx.strokeRect(layout.rowX, y, layout.w - 32, layout.rowH - 5);

    drawResourceIcon(key, layout.rowX + 10, y + 13, 14);
    ctx.fillStyle = "white";
    ctx.font = "12px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(formatResourceName(key), layout.rowX + 32, y + 13);
    ctx.textAlign = "right";
    ctx.fillText(`${supplied}/${needed}  inv ${available}`, layout.x + layout.w - 24, y + 13);
    i++;
  }

  ctx.fillStyle = isDysonSphereComplete(dysonPanelSystemIndex) ? "#77ffaa" : "rgba(255,255,255,0.64)";
  ctx.font = "12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(isDysonSphereComplete(dysonPanelSystemIndex) ? "Charging ship in star orbit" : "Click a resource row to add what you have", layout.x + 16, layout.y + layout.h - 20);
}

function handleDysonPanelClick(mx, my) {
  if (!dysonPanelOpen) return false;
  const layout = getDysonPanelLayout();
  if (mx < layout.x || mx > layout.x + layout.w || my < layout.y || my > layout.y + layout.h) return false;

  if (mx >= layout.close.x && mx <= layout.close.x + layout.close.w && my >= layout.close.y && my <= layout.close.y + layout.close.h) {
    dysonPanelOpen = false;
    playSound("toggle", 120);
    return true;
  }

  const entries = Object.keys(getDysonSphereCost());
  const index = Math.floor((my - layout.rowY) / layout.rowH);
  const key = entries[index];
  if (key && contributeToDysonSphere(dysonPanelSystemIndex, key)) return true;
  return true;
}

function formatWorldPlayTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getSeedDisplayText() {
  if (!currentWorldIsEnd) return currentWorldSeedLabel || String(currentWorldSeed || 0);

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const now = Math.floor(performance.now() / 22);
  let output = "";
  for (let i = 0; i < 18; i++) {
    const idx = (now + i * 17 + Math.floor(Math.sin(now * 0.37 + i) * 31)) % chars.length;
    output += chars[(idx + chars.length) % chars.length];
  }
  return output;
}

function toggleStatusBadgeAction(action) {
  if (buildMode) return false;

  if (action === "precision") {
    precisionThrust = !precisionThrust;
    flash(precisionThrust ? "Precision thrust: 20%" : "Full thrust");
  } else if (action === "recall") {
    recallSmallShips = !recallSmallShips;
    flash(recallSmallShips ? "Drones recall" : "Drones resume");
  } else if (action === "shields") {
    shieldsActive = !shieldsActive;
    flash(shieldsActive ? "Shields on" : "Shields off");
  } else if (action === "repair") {
    repairMode = !repairMode;
    flash(repairMode ? "Repair mode on" : "Repair mode off");
  } else if (action === "map") {
    mapVisible = !mapVisible;
    if (mapVisible) notifyTutorialActionDone("mapOpened");
    flash(mapVisible ? "Map open" : "Map closed");
  } else if (action === "orbit") {
    if (getComputerLevel() < 3) {
      flash("Computer MK3 required for orbit mode");
      return true;
    }
    if (landingModeActive) {
      flash("Landed – depart first before entering orbit");
      return true;
    }
    orbitModeActive = !orbitModeActive;
    if (orbitModeActive) {
      notifyTutorialActionDone("orbit");
      tutorialEvent("landing");
      orbitTarget  = getBestOrbitTarget();
      orbitPhase   = "approach";
      orbitApproachPoint = null;
      orbitLockedSpeed = 0;
      orbitEllipse = null;
      flash(orbitTarget
        ? `Entering orbit around ${orbitTarget.def?.name || orbitTarget.type || "body"}`
        : "No orbit target found");
    } else {
      ship._orbitExitCoast = orbitPhase === "free";
      orbitApproachPoint = null;
      orbitLockedSpeed = 0;
      orbitEllipse = null;
      flash("Orbit disengaged");
    }
  } else if (action === "landing") {
    notifyTutorialActionDone("landing");
    if (landingModeActive) {
      departLandingToOrbit();
      return true;
    }
    if (!orbitModeActive) {
      flash("Enter orbit first (O), then press L to land");
      return true;
    }
    if (orbitPhase !== "free") {
      flash("Wait for stable orbit, then press L to land");
      return true;
    }
    const lt = getBestLandingTarget();
    if (!lt) {
      flash("No landable body – select a planet or asteroid");
      return true;
    }
    landingTarget     = lt;
    landingModeActive = true;
    landingPhase      = "none";
    orbitModeActive   = false;
    orbitApproachPoint = null;
    orbitEllipse      = null;
    flash("Initiating landing sequence …");
  } else if (action === "autoBlueprint") {
    notifyTutorialActionDone("autoBlueprint");
    autoBlueprintRepair = !autoBlueprintRepair;
    flash(autoBlueprintRepair ? "Auto blueprint repair on" : "Auto blueprint repair off");
  } else {
    return false;
  }

  if (action === "precision") notifyTutorialActionDone("precision");
  if (action === "recall") notifyTutorialActionDone("recall");
  if (action === "shields") notifyTutorialActionDone("shields");
  if (action === "repair") notifyTutorialActionDone("repair");

  playSound("toggle", 120);
  return true;
}

function handleStatusBadgeClick(mx, my) {
  for (const rect of statusBadgeRects) {
    if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
      return toggleStatusBadgeAction(rect.action);
    }
  }
  return false;
}

function drawUI() {
  statusBadgeRects.length = 0;
  ctx.font = "15px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";

  const modeText = commitPending ? "Committing..." : "[B] Build mode";

  ctx.fillText(modeText, VIEW.w - 15, VIEW.h - 36);
  ctx.fillText(`Seed: ${getSeedDisplayText()}`, VIEW.w - 15, VIEW.h - 18);

  function drawStatusBadge(text, y, active, action) {
    const width = 235;
    const height = 24;
    const x = VIEW.w - width - 15;

    ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(x, y - height / 2, width, height);
    ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - height / 2, width, height);
    ctx.fillStyle = "white";
    ctx.font = "13px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 8, y);
    if (action) statusBadgeRects.push({ x, y: y - height / 2, w: width, h: height, action });
  }

  function drawInfoBadge(text, x, y, width) {
    const height = 24;
    ctx.fillStyle = "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(x, y - height / 2, width, height);
    ctx.strokeStyle = "rgba(100,150,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y - height / 2, width, height);
    ctx.fillStyle = "white";
    ctx.font = "13px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 8, y);
  }

  function drawBalanceBotGoals() {
    const goals = Array.isArray(window.__balanceBotGoals) ? window.__balanceBotGoals.slice(0, 8) : [];
    if (goals.length === 0) return;
    const shorten = (value, maxLength) => {
      const text = String(value || "");
      return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
    };

    const width = 235;
    const x = VIEW.w - width - 15;
    const y = 245;
    const headerH = 28;
    const rowH = 44;
    const height = headerH + goals.length * rowH + 8;

    ctx.fillStyle = "rgba(4, 10, 30, 0.9)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(100,150,255,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);

    ctx.fillStyle = "#88aaff";
    ctx.font = "bold 12px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText("BALANCE BOT PLAN", x + 9, y + 15);

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i] || {};
      const rowY = y + headerH + i * rowH;
      ctx.fillStyle = i === 0 ? "rgba(80,190,255,0.16)" : "rgba(255,255,255,0.035)";
      ctx.fillRect(x + 6, rowY, width - 12, rowH - 4);

      ctx.fillStyle = i === 0 ? "#ccf6ff" : "rgba(255,255,255,0.86)";
      ctx.font = `${i === 0 ? "bold " : ""}12px Consolas, monospace`;
      ctx.fillText(`${i + 1}. ${shorten(goal.action || "Planning", 27)}`, x + 12, rowY + 14);

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(shorten(goal.reason || "", 31), x + 27, rowY + 31);
    }
  }

  drawInfoBadge(`Time ${formatWorldPlayTime(worldPlayTime)}`, 15, VIEW.h - 18, 132);
  drawInfoBadge(`FPS ${performanceHudFps}  TPS ${performanceHudTps}`, 15, VIEW.h - 49, 132);

  if (!buildMode) {
    drawStatusBadge("[G] Precision thrust", 25, precisionThrust, "precision");
    drawStatusBadge("[C] Recall drones", 53, recallSmallShips, "recall");
    drawStatusBadge("[X] Shields", 81, shieldsActive, "shields");
    drawStatusBadge("[V] Repair", 109, repairMode, "repair");
    drawStatusBadge("[M] Map", 137, mapVisible, "map");
    drawStatusBadge("[O] Orbit", 165, orbitModeActive, "orbit");
    drawStatusBadge("[L] Landing", 193, landingModeActive, "landing");
    drawStatusBadge("[N] Automatic blueprint", 221, autoBlueprintRepair, "autoBlueprint");
    drawBalanceBotGoals();
  }
  drawSmallShipConfigUI();
  drawResearchWindow();
  drawAssemblerWindow();
  drawSmelterWindow();
  drawTurretControlWindow();

  if (flashMessages.length > 0) {
    const flashNow = performance.now();
    for (let i = flashMessages.length - 1; i >= 0; i--) {
      if (!flashMessages[i].persistent && flashNow >= flashMessages[i].until) {
        flashMessages.splice(i, 1);
      }
    }
    ctx.font = "bold 16px Consolas, monospace";
    ctx.textAlign = "center";
    for (let i = 0; i < flashMessages.length; i++) {
      const message = flashMessages[i];
      const width = Math.min(VIEW.w - 30, Math.max(260, ctx.measureText(message.text).width + 38));
      const height = 34;
      const x = VIEW.w / 2 - width / 2;
      const y = 43 + i * 40;

      ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
      ctx.fillRect(x, y, width, height);
      ctx.strokeStyle = "#2255aa";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = "white";
      ctx.fillText(message.text, VIEW.w / 2, y + height / 2);
    }
  }
  if (!buildMode) return;

  const layout = getBuildInventoryLayout();
  const { sx, rows, menuX, menuY, menuW, menuH, tabRects, activeTab, titleY } = layout;

  ctx.fillStyle = "rgba(0,5,20,0.82)";
  ctx.fillRect(menuX, menuY, menuW, menuH);
  ctx.strokeStyle = "rgba(100,150,255,0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(menuX, menuY, menuW, menuH);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(activeSmallShipEdit ? "DRONE BUILD MENU" : "BUILD MENU", sx, menuY + 18);

  for (const rect of tabRects) {
    const active = rect.tab.id === activeTab.id;
    ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

    ctx.save();
    ctx.globalAlpha = 1;
    const tabIconDrawn = isTurretType(rect.tab.icon)
      ? drawTurretIconSprite(rect.tab.icon, rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14)
      : drawImageSprite(rect.tab.icon, rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14);
    if (!tabIconDrawn) {
      drawResourceIcon("energy", rect.x + 12, rect.y + rect.h / 2, rect.w - 24);
    }
    ctx.restore();
  }

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 13px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText(activeTab.name.toUpperCase(), sx, titleY);

  for (const row of rows) {
    const item = row.item;
    const y = row.y;
    const active = heldItem !== AIR && heldItem.id === item.id;
    const buttonW = menuW - 20;
    const iconSize = 42;
    const rowH = row.h - 6;

    ctx.fillStyle = active || newlyUnlockedResearch.has(item.name)
      ? "rgba(80, 190, 255, 0.72)"
      : "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(sx, y, buttonW, rowH);
    ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, y, buttonW, rowH);

    ctx.fillStyle = "white";
    ctx.font = "12px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(item.name, sx + 8, y + rowH / 2 - 7);

    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "10px Consolas, monospace";
    ctx.fillText(`${item.size[0]}x${item.size[1]}`, sx + 8, y + rowH / 2 + 9);

    const iconName = getBuildMenuIconName(item.name);
    const iconX = sx + buttonW - iconSize - 8;
    const iconY = y + rowH / 2 - iconSize / 2;

    const iconDrawn = isTurretType(item.name)
      ? drawTurretIconSprite(item.name, iconX, iconY, iconSize, iconSize)
      : drawImageSprite(iconName, iconX, iconY, iconSize, iconSize);
    if (!iconDrawn) {
      drawResourceIcon("energy", iconX, y + rowH / 2, iconSize);
    }
  }

  ctx.fillStyle = "#ccddff";
  ctx.font = "13px Consolas, monospace";
  ctx.textAlign = "left";

  const selected = importedShipGhost
    ? "imported ship ghost"
    : heldItem === AIR ? "none" : `${heldItem.name} [rot ${rotation * 90} deg]`;
  ctx.fillText(`Selected: ${selected}`, sx, menuY + 40);
  if (!activeSmallShipEdit) {
    ctx.textAlign = "left";
    ctx.fillText(`Computer MK${getComputerLevel()}: ${countModuleTiles(placedModules) + countModuleTiles(blueprints)}/${getMotherShipTileLimit()} tiles`, sx, menuY + 58);
  }

  const toolY = VIEW.h - 58;
  drawBtn("Export Ship", VIEW.w / 2 - 170, toolY, 160, 28, false);
  drawBtn("Import Ship", VIEW.w / 2 + 10, toolY, 160, 28, importedShipGhost !== null);
}


function drawSmallShipConfigUI() {
  if (!activeSmallShipEdit) return;

  const smallShip = activeSmallShipEdit.ship;
  const { x, y, width, rowH, height } = getSmallShipConfigLayout();

  ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(100,150,255,0.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, width, height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DRONE", x + 10, y + 16);

  ctx.fillStyle = "white";
  ctx.font = "12px Consolas, monospace";
  ctx.fillText(`${smallShip.name}`, x + 10, y + 34);
  ctx.fillText(`${countModuleTiles(placedModules) + countModuleTiles(blueprints)}/${activeSmallShipEdit.capacityTiles} tiles`, x + 145, y + 34);

  function panelButton(label, by, active) {
    ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(x + 10, by, width - 20, rowH);
    ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
    ctx.strokeRect(x + 10, by, width - 20, rowH);
    ctx.fillStyle = "white";
    ctx.font = "13px Consolas, monospace";
    ctx.fillText(label, x + 18, by + rowH / 2);
  }

  panelButton("Name", y + 46, false);
  panelButton("Mining Ship", y + 82, smallShip.modeMining);
  panelButton("Battleship", y + 116, smallShip.modeBattle);
  panelButton("Gas Scooper", y + 150, smallShip.modeGas);
  panelButton("Solar Wind", y + 184, smallShip.modeSolarWind);
  panelButton("Find Hangar", y + 218, hangarFindShipId === smallShip.id);
}

function drawTurretControlWindow() {
  if (!turretControlWindowOpen) return;

  const layout = getTurretControlLayout();
  turretControlRects.length = 0;

  ctx.fillStyle = "rgba(4, 10, 30, 0.95)";
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 13px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("TURRET CONTROL", layout.x + 16, layout.y + 22);

  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText("[ESC] close", layout.x + layout.width - 16, layout.y + 22);

  for (let i = 0; i < TURRET_CONTROL_TYPES.length; i++) {
    const type = TURRET_CONTROL_TYPES[i];
    const rowY = layout.y + 48 + i * layout.rowH;
    const enabled = isTurretTypeEnabled(type);
    const ammo = getTurretAmmoInfo(type);

    ctx.fillStyle = enabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)";
    ctx.fillRect(layout.x + 12, rowY, layout.width - 24, layout.rowH - 8);
    ctx.strokeStyle = enabled ? "rgba(100,150,255,0.48)" : "rgba(100,150,255,0.22)";
    ctx.strokeRect(layout.x + 12, rowY, layout.width - 24, layout.rowH - 8);

    drawTurretIconSprite(type, layout.x + 22, rowY + 6, 24, 24);

    ctx.fillStyle = "white";
    ctx.font = "bold 12px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`[${countBuiltTurrets(type)}x] ${type}`, layout.x + 56, rowY + 17);

    if (ammo) {
      const ammoX = layout.x + 292;
      ctx.fillStyle = "rgba(255,255,255,0.76)";
      ctx.font = "11px Consolas, monospace";
      ctx.fillText(String(ammo.amount), ammoX, rowY + 17);
      drawResourceIcon(ammo.key, ammoX + 34, rowY + 17, 13);
      ctx.fillText(ammo.name, ammoX + 52, rowY + 17);
    }

    const cb = { x: layout.x + layout.width - 46, y: rowY + 7, w: 20, h: 20, type };
    turretControlRects.push(cb);
    ctx.fillStyle = enabled ? "rgba(80,190,255,0.35)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
    ctx.strokeStyle = enabled ? "#ccf6ff" : "rgba(255,255,255,0.35)";
    ctx.strokeRect(cb.x, cb.y, cb.w, cb.h);
    if (enabled) {
      ctx.strokeStyle = "#ccf6ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cb.x + 4, cb.y + 10);
      ctx.lineTo(cb.x + 8, cb.y + 15);
      ctx.lineTo(cb.x + 16, cb.y + 5);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
}

function drawResearchWindow() {
  if (!researchWindowOpen) return;

  const layout = getResearchWindowLayout();

  ctx.fillStyle = "rgba(4, 10, 30, 0.94)";
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  ctx.strokeStyle = "rgba(100,150,255,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("LABORATORY RESEARCH", layout.x + 14, layout.y + 18);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText("[ESC] close", layout.x + layout.width - 14, layout.y + 18);

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x + 8, layout.y + 36, layout.width - 16, layout.height - 44);
  ctx.clip();

  for (const row of getResearchRows()) {
    if (row.type === "title") {
      ctx.fillStyle = "#88aaff";
      ctx.font = "bold 11px Consolas, monospace";
      ctx.textAlign = "left";
      ctx.fillText(row.text, row.x, row.y);
    } else {
      const item = row.item;
      const unlocked = unlockedResearch.has(item.name);
      const hovered = hoveredResearchItem && hoveredResearchItem.name === item.name;

      ctx.fillStyle = unlocked ? "rgba(80, 190, 255, 0.72)" : "rgba(255,255,255,0.08)";
      ctx.fillRect(row.x, row.y, row.w, row.h);
      ctx.strokeStyle = hovered ? "#ccf6ff" : "rgba(100,150,255,0.5)";
      ctx.strokeRect(row.x, row.y, row.w, row.h);

      const researchIconName = item.name.startsWith("Computer MK") ? "Computer" : item.name;
      const iconDrawn = isTurretType(item.name)
        ? drawTurretIconSprite(item.name, row.x + 6, row.y + 5, 18, 18)
        : drawImageSprite(researchIconName, row.x + 6, row.y + 5, 18, 18);
      if (!iconDrawn) {
        drawResourceIcon("energy", row.x + 8, row.y + row.h / 2, 14);
      }

      ctx.fillStyle = "white";
      ctx.font = "12px Consolas, monospace";
      ctx.textAlign = "left";
      const titleY = row.costLines === 1 ? row.y + row.h / 2 : row.y + 16;
      ctx.fillText(item.name, row.x + 32, titleY);

      if (unlocked) {
        ctx.fillStyle = "#ccf6ff";
        ctx.textAlign = "right";
        ctx.fillText("researched", row.x + row.w - 8, row.y + row.h / 2);
      } else {
        drawResearchCost(item.cost, row, row.costX, titleY);
      }
    }
  }

  ctx.restore();
}

function drawResearchCost(cost, row, firstLineX, firstLineY) {
  if (!cost) {
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "11px Consolas, monospace";
    ctx.textAlign = "right";
    ctx.fillText("Unlocked", row.x + row.w - 8, row.y + row.h / 2);
    return;
  }

  const entries = getOrderedCostEntries(cost);
  ctx.font = entries.length > 5 ? "10px Consolas, monospace" : "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  let lineIndex = 0;
  let x = firstLineX;
  let y = firstLineY;
  const maxX = row.x + row.w - 10;
  const continuationX = row.costX;

  for (const [key, amount] of entries) {
    const label = `${amount}`;
    const name = formatResourceName(key);
    const labelW = ctx.measureText(label).width;
    const nameW = ctx.measureText(name).width;
    const tokenW = labelW + 4 + 12 + 3 + nameW + 12;

    if (x + tokenW > maxX && lineIndex < row.costLines - 1) {
      lineIndex += 1;
      x = continuationX;
      y = row.y + 16 + lineIndex * 18;
    }

    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(label, x, y);
    x += labelW + 4;

    drawResourceIcon(key, x, y, 12);
    x += 15;

    ctx.fillStyle = "rgba(255,255,255,0.68)";
    ctx.fillText(name, x, y);
    x += nameW + 12;
  }
}

function drawAssemblerWindow() {
  if (!assemblerWindowModule) return;

  ensureAssemblerTargets(assemblerWindowModule);

  const layout = getAssemblerWindowLayout();
  const rows = getAssemblerRecipeKeys().map(key => ({ key, label: formatResourceName(key) }));

  ctx.fillStyle = "rgba(4, 10, 30, 0.94)";
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  ctx.strokeStyle = "rgba(100,150,255,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("ASSEMBLER TARGETS", layout.x + 14, layout.y + 18);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText("[ESC] close", layout.x + layout.width - 14, layout.y + 18);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = layout.y + 56 + i * 42;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(layout.x + 14, y, layout.width - 28, layout.rowH);
    ctx.strokeStyle = "rgba(100,150,255,0.65)";
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.x + 14, y, layout.width - 28, layout.rowH);

    drawResourceIcon(row.key, layout.x + 24, y + layout.rowH / 2, 14);

    ctx.fillStyle = "white";
    ctx.font = "13px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(row.label, layout.x + 48, y + layout.rowH / 2);

    ctx.textAlign = "right";
    ctx.fillText(String(assemblerWindowModule.assemblerTargets[row.key] || 0), layout.x + layout.width - 28, y + layout.rowH / 2);
  }

  const hoveredKey = getAssemblerTargetButtonAt(mouse.x, mouse.y);
  if (hoveredKey) {
    drawMachineRecipeTooltip(
      formatResourceName(hoveredKey),
      BUILDING_STATS.Assembler?.recipes?.[hoveredKey]
    );
  }
}

function drawSmelterWindow() {
  if (!smelterWindowModule) return;

  ensureSmelterTargets(smelterWindowModule);

  const layout = getSmelterWindowLayout();
  const rows = getSmelterRecipeKeys().map(key => ({ key, label: formatResourceName(key) }));

  ctx.fillStyle = "rgba(4, 10, 30, 0.94)";
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  ctx.strokeStyle = "rgba(100,150,255,0.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("SMELTER TARGETS", layout.x + 14, layout.y + 18);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText("[ESC] close", layout.x + layout.width - 14, layout.y + 18);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = layout.y + 56 + i * 42;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(layout.x + 14, y, layout.width - 28, layout.rowH);
    ctx.strokeStyle = "rgba(100,150,255,0.65)";
    ctx.strokeRect(layout.x + 14, y, layout.width - 28, layout.rowH);

    drawResourceIcon(row.key, layout.x + 24, y + layout.rowH / 2, 14);
    ctx.fillStyle = "white";
    ctx.font = "13px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(row.label, layout.x + 48, y + layout.rowH / 2);

    ctx.textAlign = "right";
    ctx.fillText(String(smelterWindowModule.smelterTargets[row.key] || 0), layout.x + layout.width - 28, y + layout.rowH / 2);
  }

  const hoveredKey = getSmelterTargetButtonAt(mouse.x, mouse.y);
  if (hoveredKey) {
    drawMachineRecipeTooltip(
      formatResourceName(hoveredKey),
      getSmelterRecipes()[hoveredKey]
    );
  }
}

function drawMachineRecipeTooltip(title, recipe) {
  if (!recipe) return;
  const inputs = Object.entries(recipe.inputs || {});
  const outputs = Object.entries(recipe.outputs || {});
  ctx.font = "11px Consolas, monospace";
  const iconSize = 14;
  const amountIconGap = 6;
  const iconLabelGap = 6;
  const tokenWidth = ([key, amount]) =>
    ctx.measureText(String(amount)).width +
    amountIconGap +
    iconSize +
    iconLabelGap +
    ctx.measureText(formatResourceName(key)).width;
  const recipeWidth = inputs.reduce((sum, entry) => sum + tokenWidth(entry) + 8, 0) +
    outputs.reduce((sum, entry) => sum + tokenWidth(entry) + 8, 0) +
    28;
  const width = Math.max(250, Math.min(440, recipeWidth + 24));
  const height = 64;
  let x = mouse.x + 18;
  let y = mouse.y + 18;
  if (x + width > VIEW.w - 8) x = mouse.x - width - 14;
  if (y + height > VIEW.h - 8) y = mouse.y - height - 14;

  ctx.fillStyle = "rgba(4, 10, 30, 0.97)";
  roundRect(x, y, width, height, 7);
  ctx.fill();
  ctx.strokeStyle = "#2255aa";
  ctx.lineWidth = 2;
  roundRect(x, y, width, height, 7);
  ctx.stroke();

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + 12, y + 17);

  let cursorX = x + 12;
  const recipeY = y + 43;
  const drawRecipeEntries = entries => {
    for (let i = 0; i < entries.length; i++) {
      const [key, amount] = entries[i];
      if (i > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillText("+", cursorX, recipeY);
        cursorX += 14;
      }
      ctx.fillStyle = "white";
      ctx.fillText(String(amount), cursorX, recipeY);
      cursorX += ctx.measureText(String(amount)).width + amountIconGap;
      drawResourceIcon(key, cursorX, recipeY, iconSize);
      cursorX += iconSize + iconLabelGap;
      ctx.fillText(formatResourceName(key), cursorX, recipeY);
      cursorX += ctx.measureText(formatResourceName(key)).width + 10;
    }
  };

  drawRecipeEntries(inputs);
  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.fillText("=", cursorX, recipeY);
  cursorX += 18;
  ctx.font = "11px Consolas, monospace";
  drawRecipeEntries(outputs);
}
function drawBtn(text, x, y, w, h, active) {
  ctx.font = "11px Consolas, monospace";
  ctx.textBaseline = "middle";
  ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.82)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + h / 2);
}

function getBuildMenuIconName(itemName) {
  if (isTurretType(itemName)) return getTurretBodySpriteName(itemName, null, { preview: true });
  if (itemName === "Main Thruster" || itemName === "RCS Thruster") return itemName + " On";
  return itemName;
}

function getResourceIconName(resource) {
  let key = String(resource || "energy").toLowerCase().replace(/\s+/g, "");
  key = key.replace(/m3$/, "").replace(/servings$/, "").replace(/t$/, "");

  const map = {
    ammo: "Ammo",
    cannonballs: "CannonBalls",
    cables: "Cables",
    carbon: "Carbon",
    circuits: "Circuits",
    copper: "CopperPlate",
    copperplate: "CopperPlate",
    copperore: "CopperOre",
    crew: "Crew",
    deuterium: "Deuterium",
    energy: "Energy",
    food: "Food",
    fuel: "Fuel",
    gears: "Gears",
    "helium-3": "Helium3",
    helium3: "Helium3",
    hydrogen: "Hydrogen",
    iron: "IronPlate",
    ironplate: "IronPlate",
    ironore: "IronOre",
    nickel: "Nickel",
    oxygen: "Oxygen",
    railgunrods: "RailgunRods",
    rocketammunition: "RocketAmmunition",
    silicon: "Silicon",
    siliconore: "SiliconOre",
    steam: "Steam",
    tritium: "Tritium",
    uranium: "Uranium",
    water: "Water"
  };

  return map[key] || null;
}

function drawResourceIcon(resourceOrX, xOrY, yOrSize, maybeSize) {
  const legacyCall = typeof resourceOrX === "number";
  const resource = legacyCall ? "energy" : resourceOrX;
  const x = legacyCall ? resourceOrX : xOrY;
  const y = legacyCall ? xOrY : yOrSize;
  const size = legacyCall ? (yOrSize || 12) : (maybeSize || 12);
  const iconName = getResourceIconName(resource);
  if (!iconName) return false;

  ctx.save();
  ctx.globalAlpha = 0.95;
  const drawn = drawImageSprite(iconName, x, y - size / 2, size, size);
  ctx.restore();
  return drawn;
}

function drawInventoryBox(x, y, w, h, title) {
  ctx.fillStyle = "rgba(4, 10, 30, 0.55)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(100,150,255,0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, x + 8, y + 14);
}

function drawInventoryNet(net, x, y) {
  if (net === null || net === undefined) return;
  ctx.fillStyle = net > 0.001 ? "#44ff88" : net < -0.001 ? "#ff6644" : "#888888";
  ctx.textAlign = "right";
  ctx.fillText(`${net > 0.001 ? "+" : ""}${net.toFixed(1)}`, x, y);
}

function drawInventoryBarRow(label, value, cap, color, net, x, y, w) {
  const resourceKey = label.toLowerCase().replace(/\s+/g, "");
  const iconSize = 12;
  const barW = 64;
  const barH = 7;
  const barX = x + w - 136;

  drawResourceIcon(resourceKey, x + 8, y, iconSize);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 26, y);

  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(barX, y - 4, barW, barH);
  if (cap > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(barX, y - 4, barW * Math.min(value / cap, 1), barH);
  }

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "right";
  ctx.fillText(cap > 0 ? `${Math.floor(value)}/${Math.floor(cap)}` : `${Math.floor(value)}`, x + w - 44, y);
  drawInventoryNet(net, x + w - 8, y);
}

function drawInventoryAmountRow(label, value, net, x, y, w) {
  const resourceKey = label.toLowerCase().replace(/\s+/g, "");
  drawResourceIcon(resourceKey, x + 8, y, 12);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 26, y);

  ctx.fillStyle = "white";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.floor(value)}`, x + w - 58, y);
  drawInventoryNet(net, x + w - 8, y);
}
function formatResourceName(key) {
  const names = {
    cannonBalls: "Cannon Balls",
    ironOre: "Iron Ore",
    copperOre: "Copper Ore",
    siliconOre: "Silicon Ore",
    ironPlate: "Iron Plate",
    copperPlate: "Copper Plate",
    helium3: "Helium-3",
    railgunRods: "Railgun Rods",
    rocketAmmunition: "Rocket Ammunition",
    food: "Food"
  };

  return names[key] || String(key).charAt(0).toUpperCase() + String(key).slice(1);
}

function drawSmallShipResourceUI() {
  if (!activeSmallShipEdit) return;
  smallShipCargoLimitRects = [];

  const smallShip = activeSmallShipEdit.ship;
  const draftModules = placedModules.concat(blueprints);
  const draftShip = { ...smallShip, modules: draftModules };
  const cargoCap = getSmallShipCargoCap(draftShip);
  const cargoUsed = getSmallShipCargoUsed(smallShip);
  const fuelCap = getSmallShipFuelCap(draftShip);
  const energyCap = getSmallShipEnergyCap(draftShip);
  const panelX = 10;
  const panelY = 10;
  const panelW = 280;
  const fluidRows = [
    ["Steam m3", "steam", "#aaddff"],
    ["Water m3", "water", "#44aaff"],
    ["Hydrogen m3", "hydrogen", "#88ff88"],
    ["Oxygen m3", "oxygen", "#ff8888"],
    ["Fuel m3", "fuel", "#ff8800"],
    ["Deuterium m3", "deuterium", "#cc88ff"],
    ["Tritium m3", "tritium", "#ff88cc"],
    ["Helium-3 m3", "helium3", "#66ffee"]
  ];
  const cargoKeys = Array.from(SOLID_RESOURCES);
  const rowH = 16;
  const panelH = Math.min(
    VIEW.h - panelY - 16,
    Math.max(634, 346 + fluidRows.length * 18 + cargoKeys.length * rowH)
  );

  ctx.fillStyle = "rgba(0,5,20,0.82)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.font = "bold 12px Consolas, monospace";
  ctx.fillStyle = "#88aaff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DRONE", panelX + 10, panelY + 16);

  let y = panelY + 38;

  function textLine(label, value) {
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "11px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillText(label, panelX + 10, y);
    ctx.fillStyle = "white";
    ctx.textAlign = "right";
    ctx.fillText(value, panelX + 265, y);
    y += 18;
  }

  textLine("Name", smallShip.name);
  textLine("Status", smallShip.status);
  textLine("Mission", smallShip.modeMining ? "Mining" : smallShip.modeBattle ? "Battle" : smallShip.modeGas ? "Gas" : smallShip.modeSolarWind ? "Solar wind" : "Idle");
  textLine("Tiles", `${countModuleTiles(draftModules)}/${activeSmallShipEdit.capacityTiles}`);

  y += 8;
  const boxX = panelX + 8;
  const boxW = panelW - 16;

  drawInventoryBox(boxX, y, boxW, 50, "ENERGY");
  drawInventoryBarRow("Energy", smallShip.energy || 0, energyCap, "#ffff44", null, boxX, y + 34, boxW);
  y += 58;

  drawInventoryBox(boxX, y, boxW, 32 + fluidRows.length * 18, "LIQUIDS & GASES");
  let rowY = y + 34;
  for (const row of fluidRows) {
    const [label, key, color] = row;
    const amount = getSmallShipLiquidAmount(smallShip, key);
    const cap = key === "fuel" ? fuelCap : getSmallShipLiquidCap(draftShip, key);
    drawInventoryBarRow(label, amount, cap, color, null, boxX, rowY, boxW - 48);

    const limitX = boxX + boxW - 50;
    const limitW = 42;
    ctx.fillStyle = "rgba(40,120,255,0.22)";
    ctx.fillRect(limitX, rowY - 7, limitW, 14);
    ctx.strokeStyle = "rgba(100,180,255,0.65)";
    ctx.strokeRect(limitX, rowY - 7, limitW, 14);
    ctx.fillStyle = "white";
    ctx.font = "10px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(getSmallShipLiquidLimit(smallShip, key)), limitX + limitW / 2, rowY);
    smallShipCargoLimitRects.push({ kind: "liquid", key, x: limitX, y: rowY - 7, w: limitW, h: 14 });
    rowY += 18;
  }
  y += 40 + fluidRows.length * 18;

  const cargoBoxH = 32 + cargoKeys.length * rowH;
  drawInventoryBox(boxX, y, boxW, cargoBoxH, "CARGO");
  ctx.fillStyle = "white";
  ctx.font = "bold 11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.floor(cargoUsed)}/${Math.floor(cargoCap)} slots`, boxX + boxW - 8, y + 14);

  rowY = y + 34;
  for (const key of cargoKeys) {
    const amount = (smallShip.cargo && smallShip.cargo[key]) || 0;
    const net = resourceRates[key] || 0;
    drawInventoryAmountRow(`${formatResourceName(key)}${key === "food" ? " servings" : " t"}`, amount, net, boxX, rowY, boxW - 48);
    const limitX = boxX + boxW - 50;
    const limitW = 42;
    ctx.fillStyle = "rgba(40,120,255,0.22)";
    ctx.fillRect(limitX, rowY - 7, limitW, 14);
    ctx.strokeStyle = "rgba(100,180,255,0.65)";
    ctx.strokeRect(limitX, rowY - 7, limitW, 14);
    ctx.fillStyle = "white";
    ctx.font = "10px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(String(getSmallShipCargoLimit(smallShip, key)), limitX + limitW / 2, rowY);
    smallShipCargoLimitRects.push({ kind: "cargo", key, x: limitX, y: rowY - 7, w: limitW, h: 14 });
    rowY += rowH;
  }
}
function drawResourceUI() {
  if (buildMode) {
    if (activeSmallShipEdit) {
      drawSmallShipResourceUI();
    } else {
      drawMotherShipResourceUI(10, 10);
      drawSalvagePanel();
    }
    return;
  }

  drawMotherShipResourceUI(10, 10);
}

function drawSalvagePanel() {
  if (!buildMode || activeSmallShipEdit || salvageModules.length === 0) return;

  const layout = getSalvagePanelLayout();
  const visible = getGroupedSalvageItems().slice(0, 8);

  ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  ctx.strokeStyle = "rgba(100,150,255,0.72)";
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x, layout.y, layout.width, layout.height);

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 12px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("SALVAGE", layout.x + 10, layout.y + 17);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "10px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText("click or drag", layout.x + layout.width - 10, layout.y + 17);

  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    const rowY = layout.y + 34 + i * layout.rowH;
    const rowX = layout.x + 8;
    const rowW = layout.width - 16;
    const rowH = layout.rowH - 6;

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(rowX, rowY, rowW, rowH);
    ctx.strokeStyle = "rgba(100,150,255,0.5)";
    ctx.strokeRect(rowX, rowY, rowW, rowH);

    const iconSize = 30;
    const iconX = rowX + 16;
    const iconY = rowY + rowH / 2 - iconSize / 2;
    const iconDrawn = isTurretType(item.type)
      ? drawTurretIconSprite(item.type, iconX, iconY, iconSize, iconSize)
      : drawImageSprite(item.type, iconX, iconY, iconSize, iconSize);
    if (!iconDrawn) {
      ctx.fillStyle = "rgba(80,120,190,0.42)";
      ctx.fillRect(iconX, iconY, iconSize, iconSize);
    }

    ctx.fillStyle = "white";
    ctx.font = "bold 11px Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const titleX = iconX + iconSize + 10;
    const deleteButtonX = layout.x + layout.width - 70;
    ctx.save();
    ctx.beginPath();
    ctx.rect(titleX, rowY, Math.max(20, deleteButtonX - titleX - 6), rowH);
    ctx.clip();
    ctx.fillText(`[${item.count}x] ${item.type}`, iconX + iconSize + 12, rowY + rowH / 2);
    ctx.restore();

    const deleteY = rowY + 6;
    const deleteW = 52;
    const deleteH = rowH - 12;
    ctx.fillStyle = "rgba(150, 24, 34, 0.18)";
    ctx.fillRect(deleteButtonX, deleteY, deleteW, deleteH);
    ctx.strokeStyle = "rgba(255,80,80,0.95)";
    ctx.lineWidth = 1;
    ctx.strokeRect(deleteButtonX, deleteY, deleteW, deleteH);

    ctx.fillStyle = "#ff6666";
    ctx.font = "bold 10px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("delete", deleteButtonX + deleteW / 2, deleteY + deleteH / 2);
  }
}

function drawMotherShipResourceUI(panelX, panelY) {
  const panelW = 280;
  const cargoRows = Array.from(SOLID_RESOURCES).length;
  const panelH = Math.min(VIEW.h - panelY - 16, Math.max(634, 382 + cargoRows * 16));

  ctx.fillStyle = "rgba(0,5,20,0.82)";
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = "rgba(100,150,255,0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.font = "bold 12px Consolas, monospace";
  ctx.fillStyle = "#88aaff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("SHIP RESOURCES", panelX + 10, panelY + 16);

  let y = panelY + 34;
  const boxX = panelX + 8;
  const boxW = panelW - 16;

  drawInventoryBox(boxX, y, boxW, 50, "ENERGY");
  drawInventoryBarRow("Energy", res.energy, res.energyCap, "#ffff44", resourceRates.energy, boxX, y + 34, boxW);
  y += 58;

  const fluidRows = [
    ["Steam m3", res.steam, res.steamCap, "#aaddff", resourceRates.steam],
    ["Water m3", res.water, res.waterCap, "#44aaff", resourceRates.water],
    ["Hydrogen m3", res.hydrogen, res.hydrogenCap, "#88ff88", resourceRates.hydrogen],
    ["Oxygen m3", res.oxygen, res.oxygenCap, "#ff8888", resourceRates.oxygen],
    ["Fuel m3", res.fuel, res.fuelCap, "#ff8800", resourceRates.fuel],
    ["Deuterium m3", res.deuterium, res.deuteriumCap, "#cc88ff", resourceRates.deuterium],
    ["Tritium m3", res.tritium, res.tritiumCap, "#ff88cc", resourceRates.tritium],
    ["Helium-3 m3", res.helium3, res.helium3Cap, "#66ffee", resourceRates.helium3]
  ];

  drawInventoryBox(boxX, y, boxW, 32 + fluidRows.length * 18, "LIQUIDS & GASES");
  let rowY = y + 34;
  for (const row of fluidRows) {
    drawInventoryBarRow(row[0], row[1], row[2], row[3], row[4], boxX, rowY, boxW);
    rowY += 18;
  }
  y += 40 + fluidRows.length * 18;

  const cargoKeys = Array.from(SOLID_RESOURCES);
  const rowH = 16;
  const cargoBoxH = 32 + cargoKeys.length * rowH;
  drawInventoryBox(boxX, y, boxW, cargoBoxH, "CARGO");
  ctx.fillStyle = "white";
  ctx.font = "bold 11px Consolas, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.floor(res.itemUsed || 0)}/${Math.floor(res.itemCap || 0)} slots`, boxX + boxW - 8, y + 14);

  rowY = y + 34;
  for (const key of cargoKeys) {
    drawInventoryAmountRow(`${formatResourceName(key)}${key === "food" ? " servings" : " t"}`, res[key] || 0, resourceRates[key] || 0, boxX, rowY, boxW);
    rowY += rowH;
  }
  y += cargoBoxH + 8;

  drawInventoryBox(boxX, y, boxW, 50, "CREW");
  drawResourceIcon("crew", boxX + 8, y + 34, 12);
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText("Crew", boxX + 26, y + 34);
  ctx.fillStyle = "white";
  ctx.textAlign = "right";
  ctx.fillText(`${res.crew}/${res.crewCap}`, boxX + boxW - 8, y + 34);
}

function drawTooltip() {
  const researchHover = researchWindowOpen && hoveredResearchItem;
  let placedModuleHover = null;
  if (buildMode &&
      !hoveredInventoryItem &&
      heldItem === AIR &&
      !importedShipGhost &&
      !isMouseOverInventory() &&
      hoveredGrid) {
    const blueprint = blueprints.find(bp =>
      hoveredGrid.x >= bp.x &&
      hoveredGrid.x < bp.x + bp.w &&
      hoveredGrid.y >= bp.y &&
      hoveredGrid.y < bp.y + bp.h
    );
    const module = blueprint || getModuleAtCell(hoveredGrid.x, hoveredGrid.y)?.module;
    if (module) {
      placedModuleHover = getInventoryItemByName(module.type) || {
        name: module.type,
        size: [module.w || 1, module.h || 1]
      };
    }
  }
  if ((!buildMode || (!hoveredInventoryItem && !placedModuleHover)) && !researchHover) return;

  const item = researchHover
    ? (getInventoryItemByName(hoveredResearchItem.name) || { name: hoveredResearchItem.name, size: [1, 1] })
    : hoveredInventoryItem || placedModuleHover;
  if (!item) return;
  const lines = getBuildingDescription(item.name);
  const cost = researchHover ? hoveredResearchItem.cost : BUILD_COSTS[item.name];
  const costTitle = researchHover ? "RESEARCH COST" : "BUILD COST";

  if (researchHover && hoveredResearchItem.cost) {
    lines.push("");
    lines.push(costTitle);
  } else if (!researchHover && BUILD_COSTS[item.name]) {
    lines.push("");
    lines.push(costTitle);
  }

  const tw = 280;
  const padding = 12;
  const lineH = 17;
  const imageBox = 72;
  const costEntries = cost ? getOrderedCostEntries(cost) : [];
  const maxTextWidth = tw - padding * 2 - imageBox - 12;
  const titleText = `${item.name}  ${item.size[0]}x${item.size[1]}`;
  const titleLines = [];
  ctx.font = "bold 14px Consolas, monospace";
  if (ctx.measureText(titleText).width <= maxTextWidth) {
    titleLines.push(titleText);
  } else {
    const words = String(item.name).split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width > maxTextWidth && current) {
        titleLines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) titleLines.push(current);
    titleLines.push(`${item.size[0]}x${item.size[1]}`);
  }
  const titleH = titleLines.length * 17;
  const wrappedLines = [];
  for (const line of lines) {
    const isTitle = line === costTitle;
    if (line === "" || isTitle) {
      wrappedLines.push(line);
      continue;
    }
    const words = String(line).split(/\s+/);
    let current = "";
    ctx.font = "11px Consolas, monospace";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width > maxTextWidth && current) {
        wrappedLines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) wrappedLines.push(current);
  }
  const th = 78 + titleH + wrappedLines.length * lineH + costEntries.length * 18;

  let tx = mouse.x + 18;
  let ty = mouse.y - th / 2;

  if (tx + tw > VIEW.w - 8) tx = mouse.x - tw - 14;
  if (ty < 8) ty = 8;
  if (ty + th > VIEW.h - 8) ty = VIEW.h - th - 8;

  ctx.fillStyle = "rgba(4, 10, 30, 0.96)";
  roundRect(tx, ty, tw, th, 8);
  ctx.fill();

  ctx.strokeStyle = "#2255aa";
  ctx.lineWidth = 2;
  roundRect(tx, ty, tw, th, 8);
  ctx.stroke();

  // Blue bold title, with size directly after it.
  ctx.font = "bold 14px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#44aaff";
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], tx + padding, ty + padding + 10 + i * 17);
  }

  // Item preview.
  const previewX = tx + tw - padding - imageBox;
  const previewY = ty + padding;

  ctx.strokeStyle = "rgba(80,160,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(previewX, previewY, imageBox, imageBox);

  const previewName = item.name.startsWith("Computer MK")
    ? "Computer"
    : item.name === "Main Thruster" || item.name === "RCS Thruster"
    ? item.name + " On"
    : item.name;

  // Helper to draw one sprite into the preview box
  function drawPreviewSprite(name) {
    const sprite = getImageSprite(name);
    if (!sprite) return false;
    const img = sprite.image;
    const frames = sprite.frames || 1;
    const speed = sprite.speed || 200;
    const frameIndex = frames === 1 ? 0 : Math.floor(performance.now() / speed) % frames;
    const frameWidth = img.width;
    const frameHeight = img.height / frames;
    const scale = Math.min(imageBox / frameWidth, imageBox / frameHeight);
    const drawW = frameWidth * scale;
    const drawH = frameHeight * scale;
    const drawX = previewX + imageBox / 2 - drawW / 2;
    const drawY = previewY + imageBox / 2 - drawH / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, frameIndex * frameHeight, frameWidth, frameHeight, drawX, drawY, drawW, drawH);
    return true;
  }

  if (isTurretType(item.name)) {
    drawPreviewSprite(getTurretBodySpriteName(item.name, null, { preview: true }));
    const topSprite = getTurretTopSpriteNameForModule(item.name, null, { preview: true });
    if (topSprite) drawPreviewSprite(topSprite);
  } else {
    drawPreviewSprite(previewName);
  }

  // Description text.
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "white";

  const descX = tx + padding;
  const descY = ty + 26 + titleH;
  let y = descY;

  for (let i = 0; i < wrappedLines.length; i++) {
    const isCostTitle = wrappedLines[i] === costTitle;
    ctx.fillStyle = isCostTitle ? "#88aaff" : "white";
    ctx.font = isCostTitle ? "bold 11px Consolas, monospace" : "11px Consolas, monospace";
    ctx.fillText(wrappedLines[i], descX, y, maxTextWidth);
    y += lineH;
  }

  if (costEntries.length > 0) {
    ctx.font = "11px Consolas, monospace";
    ctx.textBaseline = "middle";
    for (const [key, amount] of costEntries) {
      const iconY = y + 7;
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.textAlign = "left";
      ctx.fillText(String(amount), descX, iconY);
      const labelW = ctx.measureText(String(amount)).width;
      const iconX = descX + labelW + 4;
      drawResourceIcon(key, iconX, iconY, 12);
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.fillText(formatResourceName(key), iconX + 15, iconY);
      y += 18;
    }
  }
}

function getHoveredPlanetForTooltip() {
  if (!canShowResourceSurveyTooltip()) return null;

  if (mapVisible) {
    const hit = getMapBodyAt(mouse.x, mouse.y);
    return hit?.planet || null;
  }

  let best = null;
  let bestDist = Infinity;
  for (const planet of planets) {
    const p = worldToScreen(planet.x, planet.y);
    const r = Math.max(24, planet.radius * camera.scale);
    const d = Math.hypot(mouse.x - p.x, mouse.y - p.y);
    if (d <= r + 14 && d < bestDist) {
      best = planet;
      bestDist = d;
    }
  }

  return best;
}

function getHoveredAsteroidForTooltip() {
  if (!canShowResourceSurveyTooltip() || mapVisible) return null;

  let best = null;
  let bestDist = Infinity;
  for (const asteroid of asteroids) {
    if (asteroid.totalItems <= 0) continue;
    const p = worldToScreen(asteroid.x, asteroid.y);
    const r = Math.max(14, asteroid.size * camera.scale);
    const d = Math.hypot(mouse.x - p.x, mouse.y - p.y);
    if (d <= r + 10 && d < bestDist) {
      best = asteroid;
      bestDist = d;
    }
  }

  return best;
}

function getHoveredStarForTooltip() {
  if (!canShowResourceSurveyTooltip()) return null;

  if (mapVisible) {
    const hit = getMapBodyAt(mouse.x, mouse.y);
    return hit?.star || null;
  }

  let best = null;
  let bestDist = Infinity;
  for (const star of worldStars) {
    const p = worldToScreen(star.x, star.y);
    const r = Math.max(28, star.radius * camera.scale);
    const d = Math.hypot(mouse.x - p.x, mouse.y - p.y);
    if (d <= r + 18 && d < bestDist) {
      best = star;
      bestDist = d;
    }
  }

  return best;
}

function getHoveredBeltForTooltip() {
  if (!canShowResourceSurveyTooltip() || !mapVisible || !mapFocusSystem) return null;
  const hit = getMapBodyAt(mouse.x, mouse.y);
  return hit?.belt || null;
}

function canShowResourceSurveyTooltip() {
  return getComputerLevel() >= 2 && !buildMode && !uiDialog && !tutorialOverlay;
}

function getAsteroidSurveyEntries(asteroid) {
  return Object.entries(asteroid.contents || {}).filter(([, amount]) => amount > 0);
}

function getBeltSurveyEntries(belt) {
  if (!belt) return [];
  const resources = new Map();
  for (const rock of belt.rocks || []) {
    if ((rock.kind || belt.kind) === "ice") {
      resources.set("water", 1);
    } else {
      for (const def of ASTEROID_RESOURCE_TABLE || []) resources.set(def.key, 1);
    }
  }
  if (belt.kind === "outer") resources.set("water", 1);
  return Array.from(resources.entries()).sort(([a], [b]) => formatResourceName(a).localeCompare(formatResourceName(b)));
}

function drawResourceSurveyTooltip(title, entries) {
  if (entries.length === 0) return;

  const tw = 250;
  const padding = 12;
  const rowH = 20;
  const th = 48 + entries.length * rowH;
  let tx = mouse.x + 18;
  let ty = mouse.y - th / 2;

  if (tx + tw > VIEW.w - 8) tx = mouse.x - tw - 14;
  if (ty < 8) ty = 8;
  if (ty + th > VIEW.h - 8) ty = VIEW.h - th - 8;

  ctx.fillStyle = "rgba(4, 10, 30, 0.96)";
  roundRect(tx, ty, tw, th, 8);
  ctx.fill();

  ctx.strokeStyle = "#2255aa";
  ctx.lineWidth = 2;
  roundRect(tx, ty, tw, th, 8);
  ctx.stroke();

  ctx.fillStyle = "#44aaff";
  ctx.font = "bold 13px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, tx + padding, ty + 18);

  let y = ty + 44;
  for (const [key] of entries) {
    drawResourceIcon(key, tx + padding, y, 14);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "12px Consolas, monospace";
    ctx.fillText(formatResourceName(key), tx + padding + 22, y);
    y += rowH;
  }
}

function drawPlanetResourceTooltip() {
  uiFrameCounter++;
  const tooltipKey = `${Math.round(mouse.x)}:${Math.round(mouse.y)}:${mapVisible ? 1 : 0}:${buildMode ? 1 : 0}:${getComputerLevel()}:${Math.floor(worldPlayTime)}`;
  let cached = resourceTooltipCache.key === tooltipKey ? resourceTooltipCache.value : null;

  if (!cached) {
    const planet = getHoveredPlanetForTooltip();
    if (planet) {
      const rates = getPlanetMiningRates(planet);
      cached = {
        title: planet.def?.name || planet.typeKey || "Planet",
        entries: Object.entries(rates).filter(([, amount]) => amount > 0)
      };
    }

    if (!cached) {
      const star = getHoveredStarForTooltip();
      if (star) {
        cached = {
          title: star.starType?.name || "Star",
          entries: [["helium3", 1]]
        };
      }
    }

    if (!cached) {
      const asteroid = getHoveredAsteroidForTooltip();
      if (asteroid) {
        cached = {
          title: "Asteroid",
          entries: getAsteroidSurveyEntries(asteroid)
        };
      }
    }

    if (!cached) {
      const belt = getHoveredBeltForTooltip();
      if (belt) {
        cached = {
          title: belt.kind === "outer" ? "Outer asteroid belt" : "Inner asteroid belt",
          entries: getBeltSurveyEntries(belt)
        };
      }
    }

    resourceTooltipCache = { key: tooltipKey, frame: uiFrameCounter, value: cached || false };
  }

  if (!cached || cached === false) return;
  drawResourceSurveyTooltip(cached.title, cached.entries);
}

function getGlobalVolumeSliderLayout() {
  return {
    x: 15,
    y: VIEW.h - 92,
    w: 132,
    h: 26,
    trackX: 48,
    trackY: VIEW.h - 79,
    trackW: 86
  };
}

function drawGlobalVolumeControl() {
  const slider = getGlobalVolumeSliderLayout();
  ctx.save();
  ctx.fillStyle = "rgba(4, 10, 30, 0.9)";
  ctx.fillRect(slider.x, slider.y, slider.w, slider.h);
  ctx.strokeStyle = "rgba(100,150,255,0.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(slider.x, slider.y, slider.w, slider.h);

  ctx.fillStyle = "white";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("VOL", slider.x + 8, slider.trackY);

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(slider.trackX, slider.trackY - 3, slider.trackW, 6);
  ctx.fillStyle = "#55bfff";
  ctx.fillRect(slider.trackX, slider.trackY - 3, slider.trackW * userMasterVolume, 6);

  const knobX = slider.trackX + slider.trackW * userMasterVolume;
  ctx.fillStyle = "#e8f7ff";
  ctx.fillRect(knobX - 3, slider.trackY - 7, 6, 14);
  ctx.restore();
}

function updateGlobalVolumeSlider(mx) {
  const slider = getGlobalVolumeSliderLayout();
  setUserMasterVolume((mx - slider.trackX) / slider.trackW);
}

function handleGlobalVolumeSliderMouseDown(mx, my) {
  const slider = getGlobalVolumeSliderLayout();
  if (mx < slider.x || mx > slider.x + slider.w || my < slider.y || my > slider.y + slider.h) return false;
  volumeSliderDragging = true;
  updateGlobalVolumeSlider(mx);
  return true;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
