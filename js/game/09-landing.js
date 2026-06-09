let orbitPhase   = "approach";
let orbitEllipse = null;
let _orbitAngle  = 0;
let orbitApproachPoint = null;
let orbitLockedSpeed = 0;

let shipLanded         = false;
let landedPlanet       = null;
let gravityOverride    = false;
let landingPhase       = "none";
let planetMiningTimer  = 0;
let landingStartAngle  = 0;
let landingProgress    = 0;
let landingDuration    = 3;
let landingDirection   = 1;
let landingEntrySpeed  = 0;
let departureStartRadius = 0;
let planetDrillCheckTimer = 0;
let planetDrillAvailable = false;

const ORBIT_APPROACH_ACCEL_FACTOR = 0.006;

function getOrbitTangentSpeed(body, radius) {
  const base = radius * 0.0007;
  return Math.max(0.4, Math.min(MAX_SHIP_SPEED * 0.55, base));
}

function getDesiredOrbitRadius(body) {
  if (body.type === "star") {
    const shellRadius = typeof getDysonSphereWorldRadius === "function"
      ? getDysonSphereWorldRadius(body)
      : body.radius;
    return Math.max(body.radius + CONFIG.GRID_SIZE * 35, shellRadius + CONFIG.GRID_SIZE * 22);
  }
  const extraTiles = body.type === "blackhole" ? 50 : 14;
  const surfaceClearance = Math.max(
    CONFIG.GRID_SIZE * extraTiles,
    body.radius * 0.35,
    getShipCollisionRadius() * 0.8
  );
  return body.radius + surfaceClearance;
}

function getLandedRadius(planet) {
  return planet.radius - getShipCollisionRadius() * 0.3;
}

function isOrbitTargetValid(target) {
  if (!target) return false;
  if (worldStars  && worldStars.includes(target))  return true;
  if (planets     && planets.includes(target))     return true;
  if (blackHole   && target === blackHole)          return true;
  if (asteroids   && asteroids.includes(target))   return true;
  return false;
}

function getBestOrbitTarget() {
  const sel = selectedFlightTarget || getMouseFlightObject();
  if (sel) {
    if (sel.planet && planets.includes(sel.planet))       return sel.planet;
    if (sel.star   && worldStars.includes(sel.star))      return sel.star;
    if (sel.asteroid && asteroids.includes(sel.asteroid)) return sel.asteroid;
    if (blackHole   && sel === blackHole)                  return blackHole;
  }

  let nearest = null, nearestDist = Infinity;
  const check = (obj) => {
    const d = Math.hypot(obj.x - ship.x, obj.y - ship.y);
    if (d < nearestDist) { nearestDist = d; nearest = obj; }
  };
  for (const p of planets) check(p);
  for (const s of worldStars) check(s);
  if (asteroids) for (const a of asteroids) check(a);
  if (blackHole) check(blackHole);

  return nearestDist <= GRAVITY_RANGE * 4 ? nearest : null;
}

function getBestLandingTarget() {

  if (orbitModeActive && orbitTarget) {
    if (planets.includes(orbitTarget)) return orbitTarget;
    if (asteroids && asteroids.includes(orbitTarget)) return orbitTarget;
  }
  const sel = selectedFlightTarget || getMouseFlightObject();
  if (sel) {
    if (sel.planet   && planets.includes(sel.planet))       return sel.planet;
    if (sel.asteroid && asteroids.includes(sel.asteroid))   return sel.asteroid;
  }
  return null;
}

function updateOrbitMode(dt) {
  if (!orbitModeActive) {
    orbitEllipse = null;
    orbitApproachPoint = null;
    orbitLockedSpeed = 0;
    return;
  }
  if (landingPhase !== "none") return;

  if (!isOrbitTargetValid(orbitTarget)) {
    orbitTarget = getBestOrbitTarget();
    orbitPhase  = "approach";
    orbitApproachPoint = null;
    orbitLockedSpeed = 0;
    orbitEllipse = null;
  }
  if (!orbitTarget) { orbitEllipse = null; return; }

  const body     = orbitTarget;
  const desiredR = getDesiredOrbitRadius(body);
  orbitDesiredRadius = desiredR;

  const relX = ship.x - body.x;
  const relY = ship.y - body.y;
  const dist = Math.max(1, Math.hypot(relX, relY));
  const radialErr = dist - desiredR;

  if (orbitPhase === "approach") {
    _orbitApproach(dt, body, relX, relY, dist, desiredR, radialErr);
  } else {
    _orbitFree(dt, body, desiredR);
  }

  ship._orbitPredictTimer = (ship._orbitPredictTimer || 0) - dt;
  if (ship._orbitPredictTimer <= 0) {
    ship._orbitPredictTimer = 0.5;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      pts.push({ x: body.x + Math.cos(a) * desiredR, y: body.y + Math.sin(a) * desiredR });
    }
    orbitEllipse = pts;
  }
}

function _orbitApproach(dt, body, relX, relY, dist, desiredR, radialErr) {
  if (!orbitApproachPoint || orbitApproachPoint.body !== body) {
    orbitApproachPoint = createOrbitTangentPoint(body, relX, relY, dist, desiredR);
  }

  const point = orbitApproachPoint;
  const dx = point.x - ship.x;
  const dy = point.y - ship.y;
  const pointDist = Math.hypot(dx, dy);
  const travelAngle = Math.atan2(dy, dx);
  const desiredSpeed = point.approachSpeed;
  const targetVx = Math.cos(travelAngle) * desiredSpeed;
  const targetVy = Math.sin(travelAngle) * desiredSpeed;
  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;
  const dvLen = Math.hypot(dvx, dvy);

  if (dvLen > 0.04 && res.fuel > 0) {
    const thrustAngle = Math.atan2(dvy, dvx);
    const desiredShipAngle = getShipAngleForBestThruster(thrustAngle, ship.angle);
    const turnError = Math.atan2(
      Math.sin(desiredShipAngle - ship.angle),
      Math.cos(desiredShipAngle - ship.angle)
    );
    if (Math.abs(turnError) > 0.06) {
      ship.rotateToward(dt, desiredShipAngle, 1.0);
    } else {
      ship.thrustToward(dt, thrustAngle);
    }
  }

  const nextX = ship.x + ship.vx;
  const nextY = ship.y + ship.vy;
  const progressNow = (ship.x - point.x) * point.approachX + (ship.y - point.y) * point.approachY;
  const progressNext = (nextX - point.x) * point.approachX + (nextY - point.y) * point.approachY;
  const crossesTangent = progressNow <= 0 && progressNext >= 0;
  const captureDistance = Math.max(CONFIG.GRID_SIZE, desiredSpeed * 2.5);

  if (pointDist <= captureDistance || crossesTangent) {
    _orbitAngle = point.angle;
    orbitLockedSpeed = Math.max(desiredSpeed, Math.hypot(ship.vx, ship.vy));
    orbitPhase = "free";
    orbitApproachPoint = null;
    _orbitFree(dt, body, desiredR);
  }
}

function createOrbitTangentPoint(body, relX, relY, dist, radius) {
  const orbitDir = body.orbitDir || 1;
  const baseAngle = Math.atan2(relY, relX);
  const currentSpeed = Math.hypot(ship.vx, ship.vy);
  const approachSpeed = Math.max(
    getOrbitTangentSpeed(body, radius),
    Math.min(MAX_SHIP_SPEED, Math.max(currentSpeed, MAX_SHIP_SPEED * 0.62))
  );

  if (dist <= radius + CONFIG.GRID_SIZE) {
    const approachX = -Math.sin(baseAngle) * orbitDir;
    const approachY = Math.cos(baseAngle) * orbitDir;
    return {
      body,
      angle: baseAngle,
      x: body.x + Math.cos(baseAngle) * radius,
      y: body.y + Math.sin(baseAngle) * radius,
      approachX,
      approachY,
      approachSpeed
    };
  }

  const offset = Math.acos(Math.min(1, radius / dist));
  const candidates = [baseAngle + offset, baseAngle - offset].map(angle => {
    const x = body.x + Math.cos(angle) * radius;
    const y = body.y + Math.sin(angle) * radius;
    const approachX = x - ship.x;
    const approachY = y - ship.y;
    const approachLen = Math.max(0.001, Math.hypot(approachX, approachY));
    const tangentX = -Math.sin(angle) * orbitDir;
    const tangentY = Math.cos(angle) * orbitDir;
    const alignment = approachX / approachLen * tangentX + approachY / approachLen * tangentY;
    return {
      body,
      angle,
      x,
      y,
      alignment,
      approachX: approachX / approachLen,
      approachY: approachY / approachLen,
      approachSpeed
    };
  });

  return candidates[0].alignment >= candidates[1].alignment ? candidates[0] : candidates[1];
}

function _orbitFree(dt, body, desiredR) {
  const orbitDir  = body.orbitDir || 1;
  const tangSpeed = orbitLockedSpeed || getOrbitTangentSpeed(body, desiredR);
  const angSpeed  = (tangSpeed / desiredR) * orbitDir;
  _orbitAngle += angSpeed;

  ship.x = body.x + Math.cos(_orbitAngle) * desiredR;
  ship.y = body.y + Math.sin(_orbitAngle) * desiredR;

  const tx = -Math.sin(_orbitAngle) * orbitDir;
  const ty =  Math.cos(_orbitAngle) * orbitDir;
  ship.vx = tx * tangSpeed;
  ship.vy = ty * tangSpeed;

  ship.rotateToward(dt, Math.atan2(ty, tx) + Math.PI / 2 + SHIP_NOSE_OFFSET, 0.6);
}

function updateLandingMode(dt) {
  if (!landingModeActive) {
    if (shipLanded || landingPhase !== "none") _exitLanding();
    return;
  }

  if (!landingTarget) {
    landingTarget = getBestLandingTarget();
  }
  if (!landingTarget) return;

  const planet = landingTarget;

  switch (landingPhase) {
    case "none":
      _startSpiralLanding(planet);
      break;
    case "descend":
      _updateDescend(dt, planet);
      break;
    case "landed":
      _updateLanded(dt, planet);
      break;
    case "ascend":
      _updateAscend(dt, planet);
      break;
  }
}

function _startSpiralLanding(planet) {
  landingPhase = "descend";
  landingProgress = 0;
  landingStartAngle = Math.atan2(ship.y - planet.y, ship.x - planet.x);
  landingDirection = planet.orbitDir || 1;
  landingEntrySpeed = MAX_SHIP_SPEED * 0.7;
  const pathLength = getDesiredOrbitRadius(planet) * 1.35;
  landingDuration = Math.max(3, pathLength / Math.max(1, landingEntrySpeed * 60));
  orbitLockedSpeed = 0;
}

function _updateDescend(dt, planet) {
  const previousX = ship.x;
  const previousY = ship.y;
  landingProgress = Math.min(1, landingProgress + dt / landingDuration);
  const eased = landingProgress * landingProgress * (3 - 2 * landingProgress);
  const spiralRadius = getDesiredOrbitRadius(planet) * (1 - eased);
  const spiralAngle = landingStartAngle + landingDirection * Math.PI * 0.5 * eased;

  ship.x = planet.x + Math.cos(spiralAngle) * spiralRadius;
  ship.y = planet.y + Math.sin(spiralAngle) * spiralRadius;
  ship.vx = ship.x - previousX;
  ship.vy = ship.y - previousY;
  if (Math.hypot(ship.vx, ship.vy) > 0.001) {
    ship.angle = Math.atan2(ship.vy, ship.vx) + Math.PI / 2 + SHIP_NOSE_OFFSET;
  }
  ship.angularVelocity = 0;

  if (landingProgress >= 1) {
    ship.x = planet.x;
    ship.y = planet.y;
    ship.vx = 0;
    ship.vy = 0;
    _onLanded(planet);
  }
}

function _updateLanded(dt, planet) {
  ship.x = planet.x;
  ship.y = planet.y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;
}

function _onLanded(planet) {
  landingPhase    = "landed";
  shipLanded      = true;
  landedPlanet    = planet;
  gravityOverride = true;
  planetMiningTimer = 0;

  const typeKey  = planet.typeKey || planet.type;
  const typeName = (planet.def && planet.def.name) || typeKey || "Planet";
  updatePlanetDrillWarning(0, true);
  flash(`Landed on ${typeName}`);
  playSound("toggle", 90);
}

function _exitLanding() {
  shipLanded      = false;
  landedPlanet    = null;
  gravityOverride = false;
  landingPhase    = "none";
  planetMiningTimer = 0;
  landingModeActive = false;
  landingTarget     = null;
}

function departLandingToOrbit() {
  const planet = landingTarget || landedPlanet;
  if (!planet) {
    _exitLanding();
    flash("Landing mode disengaged");
    return;
  }
  if (landingPhase === "ascend") {
    flash("Already returning to orbit");
    return;
  }

  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  departureStartRadius = Math.hypot(dx, dy);
  landingStartAngle = departureStartRadius > 0.001
    ? Math.atan2(dy, dx)
    : landingStartAngle + landingDirection * Math.PI * 0.5;
  landingProgress = 0;
  landingPhase = "ascend";
  shipLanded = false;
  landedPlanet = null;
  gravityOverride = false;
  planetMiningTimer = 0;
  flash("Returning to orbit");
}

function _updateAscend(dt, planet) {
  const previousX = ship.x;
  const previousY = ship.y;
  const targetRadius = getDesiredOrbitRadius(planet);
  landingProgress = Math.min(1, landingProgress + dt / landingDuration);
  const eased = landingProgress * landingProgress * (3 - 2 * landingProgress);
  const radius = departureStartRadius + (targetRadius - departureStartRadius) * eased;
  const angle = landingStartAngle + landingDirection * Math.PI * 0.5 * eased;

  ship.x = planet.x + Math.cos(angle) * radius;
  ship.y = planet.y + Math.sin(angle) * radius;
  ship.vx = ship.x - previousX;
  ship.vy = ship.y - previousY;
  if (Math.hypot(ship.vx, ship.vy) > 0.001) {
    ship.angle = Math.atan2(ship.vy, ship.vx) + Math.PI / 2 + SHIP_NOSE_OFFSET;
  }
  ship.angularVelocity = 0;

  if (landingProgress < 1) return;

  const speed = Math.max(landingEntrySpeed, getOrbitTangentSpeed(planet, targetRadius));
  const orbitDir = planet.orbitDir || landingDirection || 1;
  _exitLanding();
  orbitTarget = planet;
  orbitDesiredRadius = targetRadius;
  orbitModeActive = true;
  orbitPhase = "free";
  _orbitAngle = angle;
  orbitLockedSpeed = speed;
  ship.x = planet.x + Math.cos(angle) * targetRadius;
  ship.y = planet.y + Math.sin(angle) * targetRadius;
  ship.vx = -Math.sin(angle) * orbitDir * speed;
  ship.vy = Math.cos(angle) * orbitDir * speed;
  ship._orbitExitCoast = false;
  flash("Returned to orbit");
}

function shouldSkipGravity() {
  return gravityOverride || orbitModeActive || landingModeActive;
}

const PLANET_MINING_RATES = {
  water:      { water: 0.8, hydrogen: 0.05 },
  lava:       { uranium: 0.35, ironOre: 0.12 },
  ice:        { water: 0.4, deuterium: 0.18, tritium: 0.10 },
  desert:     { silicon: 0.20, copperOre: 0.12 },
  gas:        { hydrogen: 0.55, deuterium: 0.08 },
  metal:      { ironOre: 0.22, nickel: 0.15, copperOre: 0.08 },
  jungle:     { food: 0.60, carbon: 0.10 },
  radioactive:{ uranium: 0.80, silicon: 0.06 },
  end:        { helium3: 0.45, uranium: 0.32, nickel: 0.24, silicon: 0.18 },
};

function getPlanetMiningRates(planet) {
  if (!planet) return {};
  const typeKey = planet.typeKey || planet.type;
  return PLANET_MINING_RATES[typeKey] || {};
}

function hasOperationalPlanetDrill() {
  return placedModules.some(module => module.type === "Drill" && getModuleHealth(module) > 0);
}

function updatePlanetDrillWarning(dt = 0, force = false) {
  if (!shipLanded || !landedPlanet) {
    planetDrillCheckTimer = 0;
    planetDrillAvailable = false;
    setPersistentFlash("planet-drill-required", "", false);
    return true;
  }

  planetDrillCheckTimer = Math.max(0, planetDrillCheckTimer - dt);
  if (force || planetDrillCheckTimer <= 0) {
    planetDrillCheckTimer = 1;
    planetDrillAvailable = hasOperationalPlanetDrill();
  }

  const needsDrill = !planetDrillAvailable;
  setPersistentFlash("planet-drill-required", "Planet mining requires at least one working drill", needsDrill);
  return !needsDrill;
}

function updatePlanetMining(dt) {
  if (!shipLanded || !landedPlanet) return;
  if (!updatePlanetDrillWarning(dt)) return;

  planetMiningTimer += dt;
  if (planetMiningTimer < 1.0) return;
  const elapsed = planetMiningTimer;
  planetMiningTimer = 0;

  let acceptedTotal = 0;
  for (const [key, rate] of Object.entries(getPlanetMiningRates(landedPlanet))) {
    if (res[key] === undefined) continue;
    acceptedTotal += storeResource(key, rate * elapsed);
  }

  landedPlanet._miningSound = (landedPlanet._miningSound || 0) + elapsed;
  if (landedPlanet._miningSound >= 5 && acceptedTotal > 0) {
    landedPlanet._miningSound = 0;
    playSound("items", 700);
  } else if (acceptedTotal <= 0) {
    landedPlanet._storageWarningTimer = (landedPlanet._storageWarningTimer || 0) + elapsed;
    if (landedPlanet._storageWarningTimer >= 5) {
      landedPlanet._storageWarningTimer = 0;
      flash("Planet mining needs free warehouse space; gases also need a matching tank");
    }
  }
}

function drawOrbitIndicator() {
  if (buildMode || !orbitModeActive || !orbitTarget) return;

  const bodyScreen = worldToScreen(orbitTarget.x, orbitTarget.y);
  const desiredR   = getDesiredOrbitRadius(orbitTarget);
  const refR       = desiredR * camera.scale;

  ctx.beginPath();
  ctx.arc(bodyScreen.x, bodyScreen.y, refR, 0, Math.PI * 2);
  ctx.strokeStyle = orbitPhase === "free"
    ? "rgba(0,220,180,0.55)"
    : "rgba(255,200,60,0.45)";
  ctx.lineWidth = orbitPhase === "free" ? 2 : 1.5;
  ctx.setLineDash(orbitPhase === "free" ? [] : [6, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (orbitPhase === "approach") {
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(255,200,60,0.85)";
    ctx.fillText("Entering orbit...", bodyScreen.x + refR * 0.7 + 6, bodyScreen.y - 6);
  }
}

function drawLandingOverlay() {
  if (!landingModeActive && !shipLanded) return;

  const phaseLabels = {
    descend: "Descent...",
    landed:  "Landed",
    ascend:  "Returning to orbit...",
    none:    "Landing initiated",
  };
  const label = phaseLabels[landingPhase] || "Landing";
  const color = landingPhase === "landed" ? "#88ffcc" : "#ffdd66";

  ctx.save();
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur  = 4;
  ctx.fillText(label, 14, VIEW.h - 48);

  if (shipLanded && landedPlanet) {
    const rates = getPlanetMiningRates(landedPlanet);
    const parts = Object.entries(rates)
      .map(([k, v]) => `${formatResourceName(k)}: +${v.toFixed(2)}/s`)
      .join("  |  ");
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(180,255,220,0.75)";
    ctx.fillText(parts, 14, VIEW.h - 32);
  }

  ctx.restore();
}

function getPlanetMiningTooltip(planet) {
  if (!planet) return "";
  const rates = getPlanetMiningRates(planet);
  if (!Object.keys(rates).length) return "";
  return "Passive mining (landed):\n" +
    Object.entries(rates).map(([k, v]) => `  ${formatResourceName(k)}: +${v.toFixed(2)}/s`).join("\n");
}

function getOrbitBodyVelocity(body) {

  return { x: 0, y: 0 };
}

function getOrbitDirection(body) {
  return body.orbitDir || 1;
}

function getCircularOrbitSpeed(body, radius) {
  return getOrbitTangentSpeed(body, radius);
}
