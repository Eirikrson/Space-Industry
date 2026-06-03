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
  const rangeTiles = getTurretConfig(type).rangeTiles || 12;
  const range = rangeTiles * CONFIG.GRID_SIZE * camera.scale;

  ctx.beginPath();
  if (type === "Laser turret") {
    ctx.moveTo(x, y);
    ctx.arc(x, y, range, forwardAngle - Math.PI / 2, forwardAngle + Math.PI / 2);
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
  drawImageSprite(getTurretBaseSpriteName(type, module), -sw / 2, -sh / 2, sw, sh);
  const topSprite = getTurretTopSpriteName(type);
  if (topSprite) {
    ctx.save();
    ctx.rotate(getTurretTopDrawAngle(type, gunAngle || 0));
    drawImageSprite(topSprite, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }
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

function drawModules() {
  const grid = CONFIG.GRID_SIZE;
  const com = getCenterOfMass();

  for (const m of placedModules) {
    const world = moduleWorldCenter(m);
    const p = worldToScreen(world.x, world.y);

    if (m.type === "Shield Generator" && (buildMode || shieldsActive)) {
      const outDir = ship.angle + (m.rot || 0) * Math.PI / 2 + Math.PI / 2;
      drawShieldArcAt(p.x, p.y, outDir, buildMode);
    }

    if (isTurretType(m.type) && (buildMode || !mapVisible)) {
      drawTurretRangeAt(p.x, p.y, true, m.type, ship.angle + (m.rot || 0) * Math.PI / 2 - Math.PI / 2);
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
      ctx.font = `${Math.max(8, Math.min(12, sw / 6))}px Arial`;
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
      ctx.font = "10px Arial";
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

function drawSmallShipNameBadge(smallShip, p) {
  const cargoUsed = getSmallShipCargoUsed(smallShip);
  const cargoCap = Math.max(1, getSmallShipCargoCap(smallShip));
  const label = `${smallShip.name}  ${cargoUsed}/${cargoCap}`;

  ctx.font = "11px Arial";
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

    const com = getCenterOfMass(smallShip.modules);
    const cargoUsed = getSmallShipCargoUsed(smallShip);
    const cargoCap = Math.max(1, getSmallShipCargoCap(smallShip));

    for (const module of smallShip.modules) {
      drawSmallShipModule(smallShip, module, com);
    }

    const p = worldToScreen(smallShip.x, smallShip.y);
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

    if (isTurretType(bp.type)) {
      drawTurretRangeAt(p.x, p.y, true, bp.type, ship.angle + (bp.rot || 0) * Math.PI / 2 - Math.PI / 2);
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

    if (isTurretType(module.type)) {
      drawTurretRangeAt(p.x, p.y, canPlace, module.type, ship.angle + (module.rot || 0) * Math.PI / 2 - Math.PI / 2);
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
    ? Math.max(mapFocusSystem.outerBelt?.outerR || 1, ...mapFocusSystem.planets.map(planet => planet.orbitRadius + planet.radius)) * 1.18
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

function getMapSystemForPoint(worldX, worldY) {
  let best = null;
  let bestDist = Infinity;

  for (const system of solarSystems) {
    const radius = Math.max(
      system.outerBelt?.outerR || 0,
      system.innerBelt?.outerR || 0,
      ...system.planets.map(planet => planet.orbitRadius + planet.radius)
    );
    const dist = Math.hypot(worldX - system.star.x, worldY - system.star.y);
    if (dist <= radius * 1.15 && dist < bestDist) {
      best = system;
      bestDist = dist;
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
    system.outerBelt?.outerR || 0,
    ...system.planets.map(planet => planet.orbitRadius + planet.radius)
  ) * map.scale;

  if (starP.x + systemRadius < map.x || starP.x - systemRadius > map.x + map.w || starP.y + systemRadius < map.y || starP.y - systemRadius > map.y + map.h) return;

  for (const planet of system.planets) {
    drawMapCircle(map, star.x, star.y, planet.orbitRadius, "rgba(120,170,255,0.14)", 1, 1);
  }

  drawMapBelt(system.innerBelt, map, "rgba(150,150,150,0.22)");
  drawMapBelt(system.outerBelt, map, "rgba(120,200,255,0.18)");

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
  ctx.font = "10px Arial";
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

  const map = getMapLayout();
  if (mx < map.x || mx > map.x + map.w || my < map.y || my > map.y + map.h) return null;

  let best = null;
  let bestDist = Infinity;
  const stars = map.focused ? [mapFocusSystem.star] : worldStars;
  const systemPlanets = map.focused ? mapFocusSystem.planets : [];

  for (const star of stars) {
    const p = worldToMap(map, star.x, star.y);
    const d = Math.hypot(mx - p.x, my - p.y);
    const system = getSystemForBody(star);
    const systemRadius = !map.focused && system
      ? Math.max(
          system.outerBelt?.outerR || 0,
          system.innerBelt?.outerR || 0,
          ...system.planets.map(planet => planet.orbitRadius + planet.radius)
        ) * map.scale
      : 0;
    const hitRadius = map.focused
      ? Math.max(18, star.radius * map.scale + 6)
      : Math.max(36, systemRadius);
    if (d < hitRadius && d < bestDist) {
      best = { star, system };
      bestDist = d;
    }
  }

  for (const planet of systemPlanets) {
    const p = worldToMap(map, planet.x, planet.y);
    const d = Math.hypot(mx - p.x, my - p.y);
    if (d < Math.max(12, planet.radius * map.scale + 8) && d < bestDist) {
      best = { planet, system: getSystemForBody(planet) };
      bestDist = d;
    }
  }

  return best;
}

function handleMapClick(mx, my) {
  const hit = getMapBodyAt(mx, my);
  if (!hit) return false;

  if (hit.system) {
    mapFocusSystem = hit.system;
    selectedFlightTarget = hit.planet ? { planet: hit.planet } : { star: hit.star };
    velocityMatchTarget = selectedFlightTarget;
    flash("System map");
    playSound("toggle", 120);
    return true;
  }

  return false;
}

function drawMapOverlay() {
  if (!mapVisible || buildMode) return;

  const map = getMapLayout();
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

      drawMapBelt(system.innerBelt, map, "rgba(150,150,150,0.32)");
      drawMapBelt(system.outerBelt, map, "rgba(120,200,255,0.28)");
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
  }

  for (const enemy of enemyShips) {
    const p = worldToMap(map, enemy.x, enemy.y);
    const px = p.x;
    const py = p.y;
    if (px < x || px > x + w || py < y || py > y + h) continue;
    drawMapTriangle(px, py, enemy.angle || 0, 7, "#ff3333");
  }

  const player = worldToMap(map, ship.x, ship.y);
  if (player.x >= x && player.x <= x + w && player.y >= y && player.y <= y + h) {
    drawMapTriangle(player.x, player.y, ship.angle || 0, 9, "#55aaff");
  }

  ctx.restore();

  ctx.font = "13px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "white";
  ctx.fillText(map.focused ? "SYSTEM MAP  [ESC] galaxy" : "GALAXY MAP  [M]", x + 14, y + 18);
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
    flash(mapVisible ? "Map open" : "Map closed");
  } else if (action === "trajectory") {
    trajectoryVisible = !trajectoryVisible;
    flash(trajectoryVisible ? "Trajectory on" : "Trajectory off");
  } else if (action === "orbit") {
    orbitModeActive = !orbitModeActive;
    orbitTarget = orbitModeActive ? getBestOrbitTarget() : null;
    orbitDesiredRadius = 0;
    flash(orbitModeActive ? "Orbit Mode ON" : "Orbit Mode OFF");
  } else if (action === "landing") {
    landingModeActive = !landingModeActive;
    landingTarget = landingModeActive ? getBestLandingTarget() : null;
    if (landingModeActive) {
      orbitModeActive = false;
      orbitTarget = null;
    }
    flash(landingModeActive ? "Landing mode ON" : "Landing mode OFF");
  } else if (action === "autoBlueprint") {
    autoBlueprintRepair = !autoBlueprintRepair;
    flash(autoBlueprintRepair ? "Auto blueprint repair on" : "Auto blueprint repair off");
  } else {
    return false;
  }

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
  ctx.font = "15px Arial";
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
    ctx.font = "13px Arial";
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
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.fillText(text, x + 8, y);
  }

  drawInfoBadge(`Time ${formatWorldPlayTime(worldPlayTime)}`, 15, VIEW.h - 18, 132);

  if (!buildMode) {
    drawStatusBadge("[G] Precision thrust", 25, precisionThrust, "precision");
    drawStatusBadge("[C] Recall drones", 53, recallSmallShips, "recall");
    drawStatusBadge("[X] Shields", 81, shieldsActive, "shields");
    drawStatusBadge("[V] Repair", 109, repairMode, "repair");
    drawStatusBadge("[M] Map", 137, mapVisible, "map");
    drawStatusBadge("[H] Trajectory", 165, trajectoryVisible, "trajectory");
    drawStatusBadge("[O] Orbit", 193, orbitModeActive, "orbit");
    drawStatusBadge("[L] Landing", 221, landingModeActive, "landing");
    drawStatusBadge("[N] Automatic blueprint", 249, autoBlueprintRepair, "autoBlueprint");
  }
  drawSmallShipConfigUI();
  drawResearchWindow();
  drawAssemblerWindow();

  if (performance.now() < flashUntil) {
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    const width = Math.max(260, ctx.measureText(flashMsg).width + 38);
    const height = 34;
    const x = VIEW.w / 2 - width / 2;
    const y = 43;

    ctx.fillStyle = "rgba(4, 10, 30, 0.92)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#2255aa";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = "white";
    ctx.fillText(flashMsg, VIEW.w / 2, y + height / 2);
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
  ctx.font = "bold 12px Arial";
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
    ctx.globalAlpha = rect.tab.items.length > 0 ? 1 : 0.35;
    if (!drawImageSprite(rect.tab.icon, rect.x + 7, rect.y + 7, rect.w - 14, rect.h - 14)) {
      drawResourceIcon("energy", rect.x + 12, rect.y + rect.h / 2, rect.w - 24);
    }
    ctx.restore();
  }

  ctx.fillStyle = "#88aaff";
  ctx.font = "bold 13px Arial";
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
    ctx.font = "12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(item.name, sx + 8, y + rowH / 2 - 7);

    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "10px Arial";
    ctx.fillText(`${item.size[0]}x${item.size[1]}`, sx + 8, y + rowH / 2 + 9);

    const iconName = getBuildMenuIconName(item.name);
    const iconX = sx + buttonW - iconSize - 8;
    const iconY = y + rowH / 2 - iconSize / 2;

    if (!drawImageSprite(iconName, iconX, iconY, iconSize, iconSize)) {
      drawResourceIcon("energy", iconX, y + rowH / 2, iconSize);
    }
  }

  ctx.fillStyle = "#ccddff";
  ctx.font = "13px Arial";
  ctx.textAlign = "left";

  const selected = importedShipGhost
    ? "imported ship ghost"
    : heldItem === AIR ? "none" : `${heldItem.name} [rot ${rotation * 90} deg]`;
  ctx.fillText(`Selected: ${selected}`, sx + 134, menuY + 18);

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
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DRONE", x + 10, y + 16);

  ctx.fillStyle = "white";
  ctx.font = "12px Arial";
  ctx.fillText(`${smallShip.name}`, x + 10, y + 34);
  ctx.fillText(`${countModuleTiles(placedModules) + countModuleTiles(blueprints)}/${activeSmallShipEdit.capacityTiles} tiles`, x + 145, y + 34);

  function panelButton(label, by, active) {
    ctx.fillStyle = active ? "rgba(80, 190, 255, 0.72)" : "rgba(4, 10, 30, 0.82)";
    ctx.fillRect(x + 10, by, width - 20, rowH);
    ctx.strokeStyle = active ? "#ccf6ff" : "rgba(100,150,255,0.5)";
    ctx.strokeRect(x + 10, by, width - 20, rowH);
    ctx.fillStyle = "white";
    ctx.font = "13px Arial";
    ctx.fillText(label, x + 18, by + rowH / 2);
  }

  panelButton("Name", y + 46, false);
  panelButton("Mining Ship", y + 82, smallShip.modeMining);
  panelButton("Battleship", y + 116, smallShip.modeBattle);
  panelButton("Gas Scooper", y + 150, smallShip.modeGas);
  panelButton("Solar Wind", y + 184, smallShip.modeSolarWind);
  panelButton("Find Hangar", y + 218, hangarFindShipId === smallShip.id);
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
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("LABORATORY RESEARCH", layout.x + 14, layout.y + 18);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Arial";
  ctx.textAlign = "right";
  ctx.fillText("[ESC] close", layout.x + layout.width - 14, layout.y + 18);

  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.x + 8, layout.y + 36, layout.width - 16, layout.height - 44);
  ctx.clip();

  for (const row of getResearchRows()) {
    if (row.type === "title") {
      ctx.fillStyle = "#88aaff";
      ctx.font = "bold 11px Arial";
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

      const iconName = isTurretType(item.name) ? getTurretBaseSpriteName(item.name) : item.name;
      if (!drawImageSprite(iconName, row.x + 6, row.y + 5, 18, 18)) {
        drawResourceIcon("energy", row.x + 8, row.y + row.h / 2, 14);
      }

      ctx.fillStyle = "white";
      ctx.font = "12px Arial";
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
    ctx.font = "11px Arial";
    ctx.textAlign = "right";
    ctx.fillText("Unlocked", row.x + row.w - 8, row.y + row.h / 2);
    return;
  }

  const entries = getOrderedCostEntries(cost);
  ctx.font = entries.length > 5 ? "10px Arial" : "11px Arial";
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
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("ASSEMBLER TARGETS", layout.x + 14, layout.y + 18);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "11px Arial";
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
    ctx.font = "13px Arial";
    ctx.textAlign = "left";
    ctx.fillText(row.label, layout.x + 48, y + layout.rowH / 2);

    ctx.textAlign = "right";
    ctx.fillText(String(assemblerWindowModule.assemblerTargets[row.key] || 0), layout.x + layout.width - 28, y + layout.rowH / 2);
  }
}
function drawBtn(text, x, y, w, h, active) {
  ctx.font = "11px Arial";
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
  if (isTurretType(itemName)) return getTurretBaseSpriteName(itemName);
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
    copperore: "Copper",
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
    ironore: "Iron",
    nickel: "Nickel",
    oxygen: "Oxygen",
    railgunrods: "RailgunRods",
    rocketammunition: "RocketAmmunition",
    silicon: "Silicon",
    siliconore: "Silicon",
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
  ctx.font = "bold 11px Arial";
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
  ctx.font = "11px Arial";
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
  ctx.font = "11px Arial";
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
    cannonBalls: "Cannon balls",
    ironOre: "Iron ore",
    copperOre: "Copper ore",
    siliconOre: "Silicon ore",
    ironPlate: "Iron plate",
    copperPlate: "Copper plate",
    helium3: "Helium-3",
    railgunRods: "Railgun rods",
    rocketAmmunition: "Rocket ammunition",
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

  ctx.font = "bold 12px Arial";
  ctx.fillStyle = "#88aaff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("DRONE", panelX + 10, panelY + 16);

  let y = panelY + 38;

  function textLine(label, value) {
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = "11px Arial";
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
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(getSmallShipLiquidLimit(smallShip, key)), limitX + limitW / 2, rowY);
    smallShipCargoLimitRects.push({ kind: "liquid", key, x: limitX, y: rowY - 7, w: limitW, h: 14 });
    rowY += 18;
  }
  y += 40 + fluidRows.length * 18;

  const cargoBoxH = 32 + cargoKeys.length * rowH;
  drawInventoryBox(boxX, y, boxW, cargoBoxH, "CARGO");
  ctx.fillStyle = "white";
  ctx.font = "bold 11px Arial";
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
    ctx.font = "10px Arial";
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
  ctx.font = "bold 12px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("SALVAGE", layout.x + 10, layout.y + 17);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "10px Arial";
  ctx.textAlign = "right";
  ctx.fillText("click or drag", layout.x + layout.width - 10, layout.y + 17);

  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    const rowY = layout.y + 34 + i * layout.rowH;

    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(layout.x + 8, rowY, layout.width - 16, layout.rowH - 6);
    ctx.strokeStyle = "rgba(100,150,255,0.5)";
    ctx.strokeRect(layout.x + 8, rowY, layout.width - 16, layout.rowH - 6);

    const iconName = isTurretType(item.type) ? getTurretBaseSpriteName(item.type) : item.type;
    if (!drawImageSprite(iconName, layout.x + 16, rowY + 5, 28, 28)) {
      ctx.fillStyle = "rgba(80,120,190,0.42)";
      ctx.fillRect(layout.x + 16, rowY + 5, 28, 28);
    }

    ctx.fillStyle = "white";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "left";
    ctx.fillText(`[${item.count}x] ${item.type}`, layout.x + 52, rowY + 13);

    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.font = "10px Arial";
    ctx.fillText(`${item.w}x${item.h}`, layout.x + 52, rowY + 29);
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

  ctx.font = "bold 12px Arial";
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
  ctx.font = "bold 11px Arial";
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
  ctx.font = "11px Arial";
  ctx.textAlign = "left";
  ctx.fillText("Crew", boxX + 26, y + 34);
  ctx.fillStyle = "white";
  ctx.textAlign = "right";
  ctx.fillText(`${res.crew}/${res.crewCap}`, boxX + boxW - 8, y + 34);
}

function drawTooltip() {
  const researchHover = researchWindowOpen && hoveredResearchItem;
  if ((!buildMode || !hoveredInventoryItem) && !researchHover) return;

  const item = researchHover ? getInventoryItemByName(hoveredResearchItem.name) : hoveredInventoryItem;
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
  const th = 95 + lines.length * lineH + costEntries.length * 18;

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

  // Titel blau + fett, Grösse direkt dahinter
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#44aaff";
  ctx.fillText(
    `${item.name}  ${item.size[0]}x${item.size[1]}`,
    tx + padding,
    ty + padding + 10
  );

  // Bild oben rechts
  const previewX = tx + tw - padding - imageBox;
  const previewY = ty + padding;

  ctx.strokeStyle = "rgba(80,160,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(previewX, previewY, imageBox, imageBox);

  const previewName = item.name === "Main Thruster" || item.name === "RCS Thruster"
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
    drawPreviewSprite(getTurretBaseSpriteName(item.name));
    const topSprite = getTurretTopSpriteName(item.name);
    if (topSprite) drawPreviewSprite(topSprite);
  } else {
    drawPreviewSprite(previewName);
  }

  // Beschreibung weiss
  ctx.font = "11px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "white";

  const descX = tx + padding;
  const descY = ty + 45;
  const maxTextWidth = tw - padding * 2 - imageBox - 12;
  let y = descY;

  for (let i = 0; i < lines.length; i++) {
    const isCostTitle = lines[i] === costTitle;
    ctx.fillStyle = isCostTitle ? "#88aaff" : "white";
    ctx.font = isCostTitle ? "bold 11px Arial" : "11px Arial";
    ctx.fillText(lines[i], descX, y, maxTextWidth);
    y += lineH;
  }

  if (costEntries.length > 0) {
    ctx.font = "11px Arial";
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
  if (buildMode || uiDialog || tutorialOverlay) return null;

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

function drawPlanetResourceTooltip() {
  const planet = getHoveredPlanetForTooltip();
  if (!planet) return;

  const rates = getPlanetMiningRates(planet);
  const entries = Object.entries(rates).filter(([, amount]) => amount > 0);
  if (entries.length === 0) return;

  const title = planet.def?.name || planet.typeKey || "Planet";
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
  ctx.font = "bold 13px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(title, tx + padding, ty + 18);

  let y = ty + 44;
  for (const [key] of entries) {
    drawResourceIcon(key, tx + padding, y, 14);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "12px Arial";
    ctx.fillText(formatResourceName(key), tx + padding + 22, y);
    y += rowH;
  }
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
