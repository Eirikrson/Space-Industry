// ═══════════════════════════════════════════════════════════════════════════
// ORBIT & LANDING SYSTEM  (vollständig überarbeitet)
// ═══════════════════════════════════════════════════════════════════════════
//
// INTEGRATION:
//   • Diese Datei ersetzt 09-landing.js vollständig.
//   • Außerdem müssen in 01-world.js folgende Änderungen gemacht werden
//     (siehe Abschnitt "PATCHES FÜR 01-world.js" am Ende dieser Datei).
//   • In 08-simulation.js: updatePlanetMining(dt) am Ende von
//     updateResources() vor removeEmptyAsteroids() aufrufen.
//
// STEUERUNG:
//   O         → Orbit-Modus ein/aus  (Ziel = ausgewähltes Objekt oder nächster Körper)
//   L         → Landen  (nur wenn Orbit-Modus aktiv UND Ziel ein Planet/Asteroid ist)
//   LEERTASTE → Ziel = Himmelskörper/Asteroid → Geschwindigkeit auf 0 bremsen
//               Ziel = Feindschiff → auf Relativgeschwindigkeit des Feindes angleichen
//                                    + Nase zum Feind drehen
//
// PHYSIK-MODELL:
//   • Planeten, Sterne, Asteroiden: stationär (vx/vy = 0)
//   • Orbit: exakte Kreisbahn, kein Treibstoff
//   • Anflug: variable Schubkraft (weiter weg → schneller, näher → langsamer)
//             → überschiesst die Orbitlinie nicht
//   • Landen: Kollision deaktiviert, Schiff "sinkt" in den Planeten
//   • Mining: passiv, 1×/s, planetentyp-spezifisch
// ═══════════════════════════════════════════════════════════════════════════

// ── State: Orbit ───────────────────────────────────────────────────────────
// (orbitModeActive, orbitTarget, orbitDesiredRadius kommen aus dem globalen State)
let orbitPhase   = "approach";   // "approach" | "free"
let orbitEllipse = null;         // [{x,y}] – gezeichneter Orbitkreis
let _orbitAngle  = 0;            // aktueller Winkel auf dem Kreis (rad)
let orbitApproachPoint = null;   // fixed tangent point used during approach
let orbitLockedSpeed = 0;        // entry speed retained while circling

// ── State: Landing ─────────────────────────────────────────────────────────
let shipLanded         = false;
let landedPlanet       = null;
let gravityOverride    = false;
let landingPhase       = "none";  // "none" | "descend" | "landed" | "ascend"
let planetMiningTimer  = 0;
let landingStartAngle  = 0;
let landingProgress    = 0;
let landingDuration    = 3;
let landingDirection   = 1;
let landingEntrySpeed  = 0;
let departureStartRadius = 0;
let planetDrillCheckTimer = 0;
let planetDrillAvailable = false;

// ── Konstanten ─────────────────────────────────────────────────────────────
const ORBIT_APPROACH_ACCEL_FACTOR = 0.006;

// Geschwindigkeit auf der Orbitlinie (world-units per simulation frame).
// Wird durch getOrbitTangentSpeed() dynamisch ermittelt.
function getOrbitTangentSpeed(body, radius) {
  const base = radius * 0.0007;
  return Math.max(0.4, Math.min(MAX_SHIP_SPEED * 0.55, base));
}

// Wie weit außerhalb des Planeten/Sterns die Orbitlinie liegt (in Tiles).
function getDesiredOrbitRadius(body) {
  if (body.type === "star") {
    const shellRadius = typeof getDysonSphereWorldRadius === "function"
      ? getDysonSphereWorldRadius(body)
      : body.radius;
    return Math.max(body.radius + CONFIG.GRID_SIZE * 35, shellRadius + CONFIG.GRID_SIZE * 22);
  }
  const extraTiles = body.type === "blackhole" ? 50 : 14;
  return body.radius + CONFIG.GRID_SIZE * extraTiles;
}

// Landungsradius: Schiff erscheint leicht im Planeten (visuell "gelandet").
function getLandedRadius(planet) {
  return planet.radius - getShipCollisionRadius() * 0.3;
}

// ── Orbit-Ziel-Validierung ─────────────────────────────────────────────────
function isOrbitTargetValid(target) {
  if (!target) return false;
  if (worldStars  && worldStars.includes(target))  return true;
  if (planets     && planets.includes(target))     return true;
  if (blackHole   && target === blackHole)          return true;
  if (asteroids   && asteroids.includes(target))   return true;
  return false;
}

// Findet das beste Orbit-Ziel: ausgewähltes Objekt hat Vorrang.
function getBestOrbitTarget() {
  const sel = selectedFlightTarget || getMouseFlightObject();
  if (sel) {
    if (sel.planet && planets.includes(sel.planet))       return sel.planet;
    if (sel.star   && worldStars.includes(sel.star))      return sel.star;
    if (sel.asteroid && asteroids.includes(sel.asteroid)) return sel.asteroid;
    if (blackHole   && sel === blackHole)                  return blackHole;
  }

  // Sonst: nächster Körper in Reichweite
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

// Nächster Planet/Asteroid als Landeziel (kein Stern/Black Hole).
function getBestLandingTarget() {
  // Wenn Orbit aktiv → Orbitziel nehmen
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

// ══════════════════════════════════════════════════════════════════════════
// ORBIT-MODUS
// ══════════════════════════════════════════════════════════════════════════
function updateOrbitMode(dt) {
  if (!orbitModeActive) {
    orbitEllipse = null;
    orbitApproachPoint = null;
    orbitLockedSpeed = 0;
    return;
  }
  if (landingPhase !== "none") return; // Landen hat Vorrang

  // Ziel validieren
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

  // Orbitkreis zeichnen (alle 0.5 s aktualisieren)
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

// ── Anflug-Phase ───────────────────────────────────────────────────────────
// Variable Schubkraft: weit weg → volle Kraft, nah dran → sehr sanft.
// Tangential-Anteil wächst erst wenn das Schiff nahe am Orbit ist,
// damit es nicht "über den Orbit hinausschiesst".
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
    if (!ship.thrustToward(dt, thrustAngle)) {
      rotateBestThrusterToward(dt, thrustAngle);
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

function rotateBestThrusterToward(dt, worldAngle) {
  let bestLocalDirection = null;
  let bestThrust = -1;

  for (const module of placedModules) {
    const stats = BUILDING_STATS[module.type];
    if (!stats || !stats.thrust || stats.thrust <= bestThrust) continue;
    bestThrust = stats.thrust;
    bestLocalDirection = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
  }

  if (bestLocalDirection !== null) {
    ship.rotateToward(dt, worldAngle - bestLocalDirection, 1.0);
  }
}

// ── Freie Orbit-Phase ──────────────────────────────────────────────────────
// Schiff wird exakt auf dem Kreis bewegt, kein Treibstoff.
function _orbitFree(dt, body, desiredR) {
  const orbitDir  = body.orbitDir || 1;
  const tangSpeed = orbitLockedSpeed || getOrbitTangentSpeed(body, desiredR);
  const angSpeed  = (tangSpeed / desiredR) * orbitDir;
  _orbitAngle += angSpeed;

  // Position exakt auf den Kreis pinnen
  ship.x = body.x + Math.cos(_orbitAngle) * desiredR;
  ship.y = body.y + Math.sin(_orbitAngle) * desiredR;

  // Geschwindigkeit = Tangente (für realistischen Austritt beim O-Drücken)
  const tx = -Math.sin(_orbitAngle) * orbitDir;
  const ty =  Math.cos(_orbitAngle) * orbitDir;
  ship.vx = tx * tangSpeed;
  ship.vy = ty * tangSpeed;

  // Nase entlang der Flugrichtung
  ship.rotateToward(dt, Math.atan2(ty, tx) + Math.PI / 2 + SHIP_NOSE_OFFSET, 0.6);
}

// ══════════════════════════════════════════════════════════════════════════
// LANDING-MODUS
// ══════════════════════════════════════════════════════════════════════════
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
  landingEntrySpeed = Math.max(
    orbitLockedSpeed || 0,
    Math.hypot(ship.vx, ship.vy),
    getOrbitTangentSpeed(planet, getDesiredOrbitRadius(planet))
  );
  const pathLength = getDesiredOrbitRadius(planet) * 1.35;
  landingDuration = Math.max(5.4, Math.min(18, pathLength / Math.max(1, landingEntrySpeed * 60) * 3));
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
  return;

  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  const radialErr = dist - landR;

  // Abstiegsgeschwindigkeit: sanft je näher
  const descentSpeed = Math.max(-3.0, Math.min(0.5, -radialErr * 0.005));
  const targetVx = nx * descentSpeed;
  const targetVy = ny * descentSpeed;
  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;

  if (Math.hypot(dvx, dvy) > 0.03 && res.fuel > 0) {
    const angle = Math.atan2(dvy, dvx);
    if (!ship.thrustToward(dt, angle)) {
      ship.rotateToward(dt, angle, 1.0);
    }
  }

  // Nase zum Planeten
  ship.rotateToward(dt,
    Math.atan2(planet.y - ship.y, planet.x - ship.x) + Math.PI / 2 + SHIP_NOSE_OFFSET,
    0.5
  );

  if (Math.abs(radialErr) < CONFIG.GRID_SIZE * 1.5 && Math.hypot(dvx, dvy) < 0.5) {
    ship.vx = 0;
    ship.vy = 0;
    ship.angularVelocity = 0;
    _onLanded(planet);
  }
}

// Gelandet: Schiff bleibt auf der Planetenoberfläche.
function _updateLanded(dt, planet) {
  ship.x = planet.x;
  ship.y = planet.y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angularVelocity = 0;
  return;

  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  // Sanft an die Landeposition heften
  const radialErr = dist - landR;
  ship.x += nx * radialErr * 0.10;
  ship.y += ny * radialErr * 0.10;
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

// ── Gravity-Override ───────────────────────────────────────────────────────
function shouldSkipGravity() {
  return gravityOverride || orbitModeActive || landingModeActive;
}

// ══════════════════════════════════════════════════════════════════════════
// LEERTASTE – Velocity Assist (überarbeitet)
// ══════════════════════════════════════════════════════════════════════════
//
// Wird in ship.updateVelocityMatch() genutzt (bereits vorhanden in 01-world.js).
// Die bestehende Logik bleibt, aber wir ergänzen:
//   • Himmelskörper / Asteroid / Stern → bremse auf absolute 0
//   • Feindschiff → matched Relativgeschwindigkeit + dreht Nase zum Feind
//
// getApproachCommandForState() wird nicht verändert; stattdessen klemmen wir
// uns in getOrbitBodyVelocity() ein, das ohnehin 0 zurückgibt.
// Die bestehende updateVelocityMatch()-Logik im Ship deckt den Feind-Fall ab
// (matchVelocity = true in getApproachProfile für "Enemy Ship").
// Für Sterne/Planeten/Asteroiden braucht es nur das Ziel-vx/vy = 0,
// was durch resolveFlightTarget() schon korrekt gesetzt ist.
//
// → KEINE Änderung in dieser Datei notwendig; die bestehende Logik ist korrekt.
//   Dokumentiert zur Klarheit.

// ══════════════════════════════════════════════════════════════════════════
// PASSIVES MINING
// ══════════════════════════════════════════════════════════════════════════

const PLANET_MINING_RATES = {
  water:      { water: 0.8, hydrogen: 0.05 },
  lava:       { uranium: 0.35, ironOre: 0.12 },
  ice:        { water: 0.4, deuterium: 0.18, tritium: 0.10 },
  desert:     { silicon: 0.20, copperOre: 0.12 },
  gas:        { hydrogen: 0.55, deuterium: 0.08 },
  metal:      { ironOre: 0.22, nickel: 0.15, copperOre: 0.08 },
  jungle:     { food: 0.60, carbon: 0.10 },
  radioactive:{ uranium: 0.80, silicon: 0.06 },
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
      flash("Planet mining needs free warehouse space or matching liquid tanks");
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// HUD
// ══════════════════════════════════════════════════════════════════════════
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
    ctx.fillText("→ Entering orbit …", bodyScreen.x + refR * 0.7 + 6, bodyScreen.y - 6);
  }
}

function drawLandingOverlay() {
  if (!landingModeActive && !shipLanded) return;

  const phaseLabels = {
    descend: "Descent …",
    landed:  "Landed",
    ascend:  "Returning to orbit …",
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

// ══════════════════════════════════════════════════════════════════════════
// HILFS-FUNKTIONEN (werden von 01-world.js benötigt)
// ══════════════════════════════════════════════════════════════════════════
function getOrbitBodyVelocity(body) {
  // Alle Körper sind jetzt stationär → immer 0
  return { x: 0, y: 0 };
}

function getOrbitDirection(body) {
  return body.orbitDir || 1;
}

function getCircularOrbitSpeed(body, radius) {
  return getOrbitTangentSpeed(body, radius);
}

// ══════════════════════════════════════════════════════════════════════════
// PATCHES FÜR 01-world.js
// ══════════════════════════════════════════════════════════════════════════
//
// 1. KEY HANDLER – "o" drücken:
//    Bestehenden Toggle-Code für orbitModeActive beibehalten, aber hinzufügen:
//
//      case "o":
//        if (landingModeActive) break;          // Orbit erst verlassen wenn gelandet
//        orbitModeActive = !orbitModeActive;
//        if (orbitModeActive) {
//          orbitTarget = getBestOrbitTarget();
//          orbitPhase  = "approach";
//          orbitEllipse = null;
//        } else {
//          orbitEllipse = null;
//        }
//        break;
//
// 2. KEY HANDLER – "l" drücken (NEU):
//    Nur wenn Orbit aktiv:
//
//      case "l":
//        if (!orbitModeActive || orbitPhase !== "free") {
//          flash("Enter orbit first (O), then press L to land");
//          break;
//        }
//        landingTarget    = getBestLandingTarget();
//        if (!landingTarget) { flash("No landable body in orbit"); break; }
//        landingModeActive = true;
//        landingPhase      = "none";
//        // Orbit-Modus deaktivieren sobald Landung beginnt
//        orbitModeActive   = false;
//        orbitEllipse      = null;
//        break;
//
// 3. LEERTASTE – Velocity Assist (bestehende Logik in ship.update):
//    Der bestehende Block:
//
//      if (keys[" "]) { ... this.updateVelocityMatch(dt, lockedApproachTarget); }
//
//    bleibt unverändert.  resolveFlightTarget() liefert vx/vy=0 für Planeten/Sterne/
//    Asteroiden (stationär), sodass der Assist die Schiffsgeschwindigkeit auf 0 bremst.
//    Für Feindschiffe liefert er vx/vy des Feindes und der bestehende matchVelocity-
//    Code dreht die Nase zum Feind (matchRotateNose muss true sein wenn Feind selektiert).
//
//    Ergänze in updateVelocityMatch():  wenn target.enemy gesetzt ist:
//      matchRotateNose = true;
//    sonst:
//      matchRotateNose = false;
//
//    Das hält die Nase automatisch zum Feind gerichtet.
//
// 4. ASTEROIDEN stationär machen:
//    In Asteroid.update(): Die Zeilen
//      this.x += this.vx * dt * 60;
//      this.y += this.vy * dt * 60;
//    entfernen (oder hinter einem Flag verstecken).
//    Belt-Asteroiden: _beltStar-Block ebenfalls deaktivieren (oder lassen –
//    sie sind ohnehin nur Deko).
//    ODER: einfacher – einfach `this.vx = this.vy = 0` im Constructor setzen
//    und den Drift entfernen.
//
// 5. PLANETEN / STERNE stationär machen:
//    In GalaxyPlanet.update() / GalaxyStar.update(): orbitAngle-Fortschritt
//    kommentieren/entfernen und x/y festhalten.
//    Die Positionen werden beim Spawn gesetzt und bleiben dann fest.
//
// 6. shouldSkipGravity() ist in dieser Datei definiert und ersetzt die
//    vorherige Version in 09-landing.js.  Aufruf in applyGravity() bleibt.
//
// ══════════════════════════════════════════════════════════════════════════
