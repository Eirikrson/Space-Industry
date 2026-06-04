// ═══════════════════════════════════════════════════════════════════════════
// PLANET LANDING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. Player activates landing mode (landingModeActive = true)
//   2. Ship flies in a curved approach from orbit to the planet
//   3. Once close enough, it lands and gravity is disabled
//   4. Passive resource mining runs once per second (planet-specific)
//   5. On departure, gravityOverride = false and normal flight resumes
//
// Integration:
//   • Replace the existing updateLandingMode() function in 01-world.js
//     with updateLandingMode() from this file.
//   • Add updatePlanetMining(dt) at the end of updateResources() in
//     08-simulation.js before removeEmptyAsteroids().
//   • Add the global variables (the "State" section below) to your
//     global state file, for example directly after the existing landing vars.
//   • Call drawLandingOverlay() in the main draw loop, after planets and before
//     the HUD layer.
// ═══════════════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────
// These variables extend the existing landingModeActive and landingTarget state.

let shipLanded         = false;   // true = ship is landed on a planet
let landedPlanet       = null;    // reference to the currently occupied planet
let gravityOverride    = false;   // true = applyGravity() is bypassed
let landingPhase       = "none";  // "none" | "approach" | "circling" | "descend" | "landed"
let landingApproachAngle = 0;     // angle used while the ship circles the planet
let landingCircleTimer = 0;       // time spent circling
let planetMiningTimer  = 0;       // resource tick accumulator

// ── Passive mining per planet type ────────────────────────────────────────
// Base values are intentionally low; asteroid fleets are more profitable.
// Exception: specialized resources per planet type are much more effective.
//
// Unit: resource per second, fed through storeResource().

const PLANET_MINING_RATES = {
  water: {
    water:    0.8,   // specialty - more efficient than asteroids for water
    hydrogen: 0.05,
  },
  lava: {
    uranium:  0.35,  // moderate - radioactive planets are better for uranium
    ironOre:  0.12,
  },
  ice: {
    water:    0.4,
    deuterium: 0.18, // specialty
    tritium:  0.10,  // specialty
  },
  desert: {
    silicon:  0.20,  // specialty
    copperOre: 0.12,
  },
  gas: {
    hydrogen: 0.55,  // specialty - more efficient than scoopers for H2
    deuterium: 0.08,
  },
  metal: {
    ironOre:  0.22,  // specialty
    nickel:   0.15,  // specialty
    copperOre: 0.08,
  },
  jungle: {
    food:     0.60,  // specialty - best food source
    carbon:   0.10,
  },
  radioactive: {
    uranium:  0.80,  // specialty - by far the best uranium source
    silicon:  0.06,
  },
};

// Base rate for non-specialized resources. Asteroid fleets outperform this
// rate for most goods once roughly three drones are active.
const PLANET_MINING_BASE_RATE = 0.04;

// ── Helper: resource set for the current planet ───────────────────────────
function getPlanetMiningRates(planet) {
  if (!planet) return {};
  const typeKey = planet.typeKey || planet.type;
  return PLANET_MINING_RATES[typeKey] || {};
}

// ── Distance geometry ─────────────────────────────────────────────────────
function getLandingOrbitRadius(planet) {
  // Orbit circle where the landing curve begins.
  return planet.radius + CONFIG.GRID_SIZE * 18;
}

function getLandedRadius(planet) {
  // Negative offset so the ship appears to "sink into" the planet visually
  return planet.radius - getShipCollisionRadius() * 0.3;
}

// ── Main update ───────────────────────────────────────────────────────────
function updateLandingMode(dt) {
  if (!landingModeActive) {
    // If the mode is disabled, cancel the landing.
    if (shipLanded || landingPhase !== "none") {
      _exitLanding();
    }
    return;
  }

  // Pick a target: prefer the selected target, otherwise the nearest planet.
  if (!landingTarget || !planets.includes(landingTarget)) {
    landingTarget = getBestLandingTarget();
  }
  if (!landingTarget) return;

  const planet = landingTarget;
  const bodyVel = getOrbitBodyVelocity(planet);

  switch (landingPhase) {
    case "none":
      _startLandingApproach(planet);
      break;
    case "approach":
      _updateApproach(dt, planet, bodyVel);
      break;
    case "circling":
      _updateCircling(dt, planet, bodyVel);
      break;
    case "descend":
      _updateDescend(dt, planet, bodyVel);
      break;
    case "landed":
      _updateLanded(dt, planet, bodyVel);
      break;
  }
}

// Phase 1: approach - ship flies toward the orbit circle.
function _startLandingApproach(planet) {
  landingPhase = "approach";
  landingCircleTimer = 0;

  // Start angle: ship to planet, then circle clockwise briefly.
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  landingApproachAngle = Math.atan2(dy, dx);
}

function _updateApproach(dt, planet, bodyVel) {
  const orbitR = getLandingOrbitRadius(planet);
  const targetX = planet.x + Math.cos(landingApproachAngle) * orbitR;
  const targetY = planet.y + Math.sin(landingApproachAngle) * orbitR;

  const dx = targetX - ship.x;
  const dy = targetY - ship.y;
  const dist = Math.hypot(dx, dy);

  // Orbital speed at the orbit.
  const orbitSpeed = Math.sqrt(Math.max(0,
    (planet.gravity || 1) * GRAVITY_SCALE / Math.max(orbitR * 0.002, 1) * orbitR
  ));
  const clampedOrbitSpeed = Math.max(0.3, Math.min(MAX_SHIP_SPEED * 0.6, orbitSpeed));

  // Tangential vector, clockwise.
  const tangX = -Math.sin(landingApproachAngle) * clampedOrbitSpeed;
  const tangY =  Math.cos(landingApproachAngle) * clampedOrbitSpeed;

  const targetVx = bodyVel.x + tangX + dx * 0.004;
  const targetVy = bodyVel.y + tangY + dy * 0.004;

  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;

  if (Math.hypot(dvx, dvy) > 0.04 && res.fuel > 0) {
    ship.thrustToward(dt, Math.atan2(dvy, dvx));
  }

  // Turn the nose toward the planet.
  ship.rotateToward(dt,
    Math.atan2(planet.y - ship.y, planet.x - ship.x) + Math.PI / 2 + SHIP_NOSE_OFFSET,
    0.5
  );

  if (dist < CONFIG.GRID_SIZE * 6) {
    landingPhase = "circling";
    landingCircleTimer = 0;
  }
}

// Phase 2: circling - half a curved orbit, then descent.
function _updateCircling(dt, planet, bodyVel) {
  const orbitR = getLandingOrbitRadius(planet);
  landingCircleTimer += dt;

  // Advance the angle continuously to create the curve.
  const angularSpeed = 0.55; // rad/s
  landingApproachAngle += angularSpeed * dt;

  const targetX = planet.x + Math.cos(landingApproachAngle) * orbitR;
  const targetY = planet.y + Math.sin(landingApproachAngle) * orbitR;

  const dx = targetX - ship.x;
  const dy = targetY - ship.y;

  const tangVx = -Math.sin(landingApproachAngle) * angularSpeed * orbitR;
  const tangVy =  Math.cos(landingApproachAngle) * angularSpeed * orbitR;

  const targetVx = bodyVel.x + tangVx + dx * 0.006;
  const targetVy = bodyVel.y + tangVy + dy * 0.006;

  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;

  if (Math.hypot(dvx, dvy) > 0.04 && res.fuel > 0) {
    ship.thrustToward(dt, Math.atan2(dvy, dvx));
  }

  ship.rotateToward(dt,
    Math.atan2(planet.y - ship.y, planet.x - ship.x) + Math.PI / 2 + SHIP_NOSE_OFFSET,
    0.55
  );

  // After half an orbit, begin descent.
  if (landingCircleTimer > Math.PI / angularSpeed) {
    landingPhase = "descend";
  }
}

// Phase 3: descent - move radially toward landing distance.
function _updateDescend(dt, planet, bodyVel) {
  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  const radialError = dist - landR;
  const radialSpeed = (ship.vx - bodyVel.x) * nx + (ship.vy - bodyVel.y) * ny;

  // Smooth approach speed.
  const descentSpeed = Math.max(-2.0, Math.min(1.0, -radialError * 0.004 - radialSpeed * 0.7));
  const targetVx = bodyVel.x + nx * descentSpeed;
  const targetVy = bodyVel.y + ny * descentSpeed;
  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;

  if (Math.hypot(dvx, dvy) > 0.03 && res.fuel > 0) {
    ship.thrustToward(dt, Math.atan2(dvy, dvx));
  }

  ship.rotateToward(dt,
    Math.atan2(planet.y - ship.y, planet.x - ship.x) + Math.PI / 2 + SHIP_NOSE_OFFSET,
    0.45
  );

  // Landed?
  if (Math.abs(radialError) < CONFIG.GRID_SIZE * 1.5 && Math.hypot(dvx, dvy) < 0.5) {
    ship.vx = bodyVel.x;
    ship.vy = bodyVel.y;
    ship.angularVelocity = 0;
    _onLanded(planet);
  }
}

// Phase 4: landed - ship stays synchronized with the planet.
function _updateLanded(dt, planet, bodyVel) {
  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  // Smoothly pin to the landing position.
  const radialError = dist - landR;
  ship.x += nx * radialError * 0.08;
  ship.y += ny * radialError * 0.08;
  ship.vx = bodyVel.x;
  ship.vy = bodyVel.y;
  ship.angularVelocity = 0;
}

// ── Landing events ────────────────────────────────────────────────────────
function _onLanded(planet) {
  landingPhase = "landed";
  shipLanded    = true;
  landedPlanet  = planet;
  gravityOverride = true;  // Disable gravity for the player while landed.
  planetMiningTimer = 0;

  const typeKey = planet.typeKey || planet.type;
  const typeName = (planet.def && planet.def.name) || typeKey || "Planet";
  flash(`Landed on ${typeName} - passive mining active`);
  playSound("toggle", 90);
}

function _exitLanding() {
  shipLanded      = false;
  landedPlanet    = null;
  gravityOverride = false;
  landingPhase    = "none";
  landingCircleTimer = 0;
  planetMiningTimer  = 0;
  // landingModeActive and landingTarget are handled by the existing toggle code.
}

// ── Passive resource mining (called from updateResources) ─────────────────
function updatePlanetMining(dt) {
  if (!shipLanded || !landedPlanet) return;

  planetMiningTimer += dt;
  if (planetMiningTimer < 1.0) return; // once per second
  const elapsed = planetMiningTimer;
  planetMiningTimer = 0;

  const rates = getPlanetMiningRates(landedPlanet);

  for (const [key, rate] of Object.entries(rates)) {
    if (res[key] === undefined) continue;
    const amount = rate * elapsed;
    storeResource(key, amount);
  }

  // Audio feedback every 5 seconds.
  landedPlanet._miningSound = (landedPlanet._miningSound || 0) + elapsed;
  if (landedPlanet._miningSound >= 5) {
    landedPlanet._miningSound = 0;
    playSound("items", 700);
  }
}

// ── Gravity override (called by applyGravity) ─────────────────────────────
// Add this at the start of applyGravity(): if (gravityOverride) return;
// Alternatively, keep this wrapper if applyGravity should stay unchanged:
function shouldSkipGravity() {
  return gravityOverride;
}

// ── HUD / Overlay ──────────────────────────────────────────────────────────
function drawLandingOverlay() {
  // Landing-Phase Indikator (oben links, unter dem Orbit-Status)
  if (!landingModeActive && !shipLanded) return;

  const phaseLabels = {
    approach:  "Approach...",
    circling:  "Circling...",
    descend:   "Descent...",
    landed:    "Landed",
    none:      "Landing mode active",
  };

  const label = phaseLabels[landingPhase] || "Landing";
  const color = landingPhase === "landed" ? "#88ffcc" : "#ffdd66";

  ctx.save();
  ctx.font = "bold 13px monospace";
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 4;
  ctx.fillText(label, 14, VIEW.h - 48);

  if (shipLanded && landedPlanet) {
    const typeKey = landedPlanet.typeKey || landedPlanet.type;
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

// ── Planet scan tooltip (optional, fits into drawFlightTargetInfo) ────────
function getPlanetMiningTooltip(planet) {
  if (!planet) return "";
  const rates = getPlanetMiningRates(planet);
  if (!Object.keys(rates).length) return "";
  const lines = Object.entries(rates)
    .map(([k, v]) => `  ${formatResourceName(k)}: +${v.toFixed(2)}/s`)
    .join("\n");
  return `Passive mining (landed):\n${lines}`;
}
