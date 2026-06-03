// ═══════════════════════════════════════════════════════════════════════════
// PLANET LANDING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════
//
// Ablauf:
//   1. Spieler aktiviert Landing-Modus (landingModeActive = true)
//   2. Schiff fliegt in Kurve (curved approach) vom Orbit an den Planeten
//   3. Sobald nah genug → landed, Gravitation ausgeschaltet
//   4. Passiver Ressourcenabbau läuft pro Sekunde (planet-spezifisch)
//   5. Beim Verlassen → gravityOverride = false, normaler Betrieb
//
// Integration:
//   • Ersetze die bestehende updateLandingMode()-Funktion in 01-world.js
//     durch updateLandingMode() aus dieser Datei.
//   • Füge updatePlanetMining(dt) am Ende von updateResources() in
//     08-simulation.js ein (vor removeEmptyAsteroids()).
//   • Ergänze die globalen Variablen (Abschnitt "State" unten) in deiner
//     globalen Variablendatei (z.B. direkt nach den bestehenden Landing-Vars).
//   • Rufe drawLandingOverlay() in deiner Haupt-Draw-Schleife auf (nach den
//     Planeten, vor der HUD-Ebene).
// ═══════════════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────────────
// Diese Variablen ergänzen die bestehenden (landingModeActive, landingTarget).

let shipLanded         = false;   // true = Schiff ist auf Planeten gelandet
let landedPlanet       = null;    // Referenz auf den aktuell belegten Planeten
let gravityOverride    = false;   // true = applyGravity() wird überbrückt
let landingPhase       = "none";  // "none" | "approach" | "circling" | "descend" | "landed"
let landingApproachAngle = 0;     // Winkel am dem das Schiff den Planeten umkreist
let landingCircleTimer = 0;       // Zeit während des Einkreisens
let planetMiningTimer  = 0;       // Akkumulator für Ressourcen-Ticks

// ── Passiver Abbau pro Planetentyp ────────────────────────────────────────
// Grundwerte sind BEWUSST niedrig gehalten – Asteroiden-Flotten lohnen sich mehr.
// Ausnahme: spezialisierte Ressourcen je Planetentyp sind deutlich effektiver.
//
// Einheit: Ressource pro Sekunde (wird über storeResource() gespeist)

const PLANET_MINING_RATES = {
  water: {
    water:    0.8,   // Spezial – effizienter als Asteroiden für Wasser
    hydrogen: 0.05,
  },
  lava: {
    uranium:  0.35,  // moderat – radioaktiver Planet ist besser für Uran
    ironOre:  0.12,
  },
  ice: {
    water:    0.4,
    deuterium: 0.18, // Spezial
    tritium:  0.10,  // Spezial
  },
  desert: {
    silicon:  0.20,  // Spezial
    copperOre: 0.12,
  },
  gas: {
    hydrogen: 0.55,  // Spezial – effizienter als Scooper für H2
    deuterium: 0.08,
  },
  metal: {
    ironOre:  0.22,  // Spezial
    nickel:   0.15,  // Spezial
    copperOre: 0.08,
  },
  jungle: {
    food:     0.60,  // Spezial – beste Nahrungsquelle
    carbon:   0.10,
  },
  radioactive: {
    uranium:  0.80,  // SPEZIAL – mit Abstand effizienteste Uranquelle
    silicon:  0.06,
  },
};

// Basisrate für alle nicht-spezialisierten Ressourcen (Asteroiden-Flotte lohnt
// sich ab ca. 3 Drohnen mehr als diese Rate für die meisten Güter).
const PLANET_MINING_BASE_RATE = 0.04;

// ── Hilfsfunktion: Ressourcensatz für aktuellen Planeten ──────────────────
function getPlanetMiningRates(planet) {
  if (!planet) return {};
  const typeKey = planet.typeKey || planet.type;
  return PLANET_MINING_RATES[typeKey] || {};
}

// ── Abstands-Geometrie ────────────────────────────────────────────────────
function getLandingOrbitRadius(planet) {
  // Orbit-Kreis, von dem die Kurve zum Landen beginnt
  return planet.radius + CONFIG.GRID_SIZE * 18;
}

function getLandedRadius(planet) {
  // Abstand wenn "gelandet" (knapp über Oberfläche)
  return planet.radius + getShipCollisionRadius() * 0.9 + CONFIG.GRID_SIZE * 1.5;
}

// ── Haupt-Update ──────────────────────────────────────────────────────────
function updateLandingMode(dt) {
  if (!landingModeActive) {
    // Wenn Modus deaktiviert wird → Landung abbrechen
    if (shipLanded || landingPhase !== "none") {
      _exitLanding();
    }
    return;
  }

  // Ziel bestimmen (bevorzuge gewähltes Ziel, sonst nächster Planet)
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

// Phase 1: Anflug – Schiff fliegt auf Orbit-Kreis zu
function _startLandingApproach(planet) {
  landingPhase = "approach";
  landingCircleTimer = 0;

  // Startwinkel: Schiff → Planet, dann kurz im Uhrzeigersinn einkreisen
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

  // Kreisbahngeschwindigkeit am Orbit
  const orbitSpeed = Math.sqrt(Math.max(0,
    (planet.gravity || 1) * GRAVITY_SCALE / Math.max(orbitR * 0.002, 1) * orbitR
  ));
  const clampedOrbitSpeed = Math.max(0.3, Math.min(MAX_SHIP_SPEED * 0.6, orbitSpeed));

  // Tangentialvektor (im Uhrzeigersinn)
  const tangX = -Math.sin(landingApproachAngle) * clampedOrbitSpeed;
  const tangY =  Math.cos(landingApproachAngle) * clampedOrbitSpeed;

  const targetVx = bodyVel.x + tangX + dx * 0.004;
  const targetVy = bodyVel.y + tangY + dy * 0.004;

  const dvx = targetVx - ship.vx;
  const dvy = targetVy - ship.vy;

  if (Math.hypot(dvx, dvy) > 0.04 && res.fuel > 0) {
    ship.thrustToward(dt, Math.atan2(dvy, dvx));
  }

  // Nase zum Planeten drehen
  ship.rotateToward(dt,
    Math.atan2(planet.y - ship.y, planet.x - ship.x) + Math.PI / 2 + SHIP_NOSE_OFFSET,
    0.5
  );

  if (dist < CONFIG.GRID_SIZE * 6) {
    landingPhase = "circling";
    landingCircleTimer = 0;
  }
}

// Phase 2: Einkreisen – halbe Umrundung als Kurve, dann Abstieg
function _updateCircling(dt, planet, bodyVel) {
  const orbitR = getLandingOrbitRadius(planet);
  landingCircleTimer += dt;

  // Winkel kontinuierlich vorschieben → erzeugt die elegante Kurve
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

  // Nach einer halben Runde → Abstieg beginnen
  if (landingCircleTimer > Math.PI / angularSpeed) {
    landingPhase = "descend";
  }
}

// Phase 3: Abstieg – radial auf Landeabstand zubewegen
function _updateDescend(dt, planet, bodyVel) {
  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  const radialError = dist - landR;
  const radialSpeed = (ship.vx - bodyVel.x) * nx + (ship.vy - bodyVel.y) * ny;

  // Sanfte Annäherungsgeschwindigkeit
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

  // Gelandet?
  if (Math.abs(radialError) < CONFIG.GRID_SIZE * 0.5 && Math.hypot(dvx, dvy) < 0.3) {
    ship.vx = bodyVel.x;
    ship.vy = bodyVel.y;
    ship.angularVelocity = 0;
    _onLanded(planet);
  }
}

// Phase 4: Gelandet – Schiff bleibt synchron mit Planet
function _updateLanded(dt, planet, bodyVel) {
  const landR = getLandedRadius(planet);
  const dx = ship.x - planet.x;
  const dy = ship.y - planet.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / dist;
  const ny = dy / dist;

  // Sanft an Landeposition heften
  const radialError = dist - landR;
  ship.x += nx * radialError * 0.08;
  ship.y += ny * radialError * 0.08;
  ship.vx = bodyVel.x;
  ship.vy = bodyVel.y;
  ship.angularVelocity = 0;
}

// ── Landeereignisse ────────────────────────────────────────────────────────
function _onLanded(planet) {
  landingPhase = "landed";
  shipLanded    = true;
  landedPlanet  = planet;
  gravityOverride = true;  // Gravitation für Spieler deaktivieren
  planetMiningTimer = 0;

  const typeKey = planet.typeKey || planet.type;
  const typeName = (planet.def && planet.def.name) || typeKey || "Planet";
  flash(`Gelandet auf ${typeName} – passiver Abbau aktiv`);
  playSound("toggle", 90);
}

function _exitLanding() {
  shipLanded      = false;
  landedPlanet    = null;
  gravityOverride = false;
  landingPhase    = "none";
  landingCircleTimer = 0;
  planetMiningTimer  = 0;
  // landingModeActive und landingTarget werden vom bestehenden Toggle-Code verwaltet
}

// ── Passiver Ressourcenabbau (in updateResources aufrufen) ────────────────
function updatePlanetMining(dt) {
  if (!shipLanded || !landedPlanet) return;

  planetMiningTimer += dt;
  if (planetMiningTimer < 1.0) return; // einmal pro Sekunde
  const elapsed = planetMiningTimer;
  planetMiningTimer = 0;

  const rates = getPlanetMiningRates(landedPlanet);

  for (const [key, rate] of Object.entries(rates)) {
    if (res[key] === undefined) continue;
    const amount = rate * elapsed;
    storeResource(key, amount);
  }

  // Akustisches Feedback (alle 5 s)
  landedPlanet._miningSound = (landedPlanet._miningSound || 0) + elapsed;
  if (landedPlanet._miningSound >= 5) {
    landedPlanet._miningSound = 0;
    playSound("items", 700);
  }
}

// ── Gravitations-Override (wird in applyGravity aufgerufen) ───────────────
// Füge am Anfang von applyGravity() ein: if (gravityOverride) return;
// Alternativ hier als Wrapper falls du applyGravity nicht ändern willst:
function shouldSkipGravity() {
  return gravityOverride;
}

// ── HUD / Overlay ──────────────────────────────────────────────────────────
function drawLandingOverlay() {
  // Landing-Phase Indikator (oben links, unter dem Orbit-Status)
  if (!landingModeActive && !shipLanded) return;

  const phaseLabels = {
    approach:  "⬇ Anflug …",
    circling:  "↻ Einkreisen …",
    descend:   "⬇ Abstieg …",
    landed:    "⚓ Gelandet",
    none:      "Landing-Modus aktiv",
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

// ── Tooltip für Planeten-Scan (optional, passt in drawFlightTargetInfo) ───
function getPlanetMiningTooltip(planet) {
  if (!planet) return "";
  const rates = getPlanetMiningRates(planet);
  if (!Object.keys(rates).length) return "";
  const lines = Object.entries(rates)
    .map(([k, v]) => `  ${formatResourceName(k)}: +${v.toFixed(2)}/s`)
    .join("\n");
  return `Passiver Abbau (gelandet):\n${lines}`;
}
