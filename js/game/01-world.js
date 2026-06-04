class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
  }
}

class Ship {
  constructor() {
    this.x = CONFIG.GALAXY_CENTER_X;
    this.y = CONFIG.GALAXY_CENTER_Y - 55000; // near first solar system
    this.angle = 0;
    this.vx = 0;
    this.vy = 0;
    this.angularVelocity = 0;
  }

  setThrusterLimitPulse(module, dt) {
    module._thrustLimitPulseTime = ((module._thrustLimitPulseTime || 0) + dt) % 2;
    module._thrustActive = module._thrustLimitPulseTime < 1;
  }

  resetThrusterLimitPulse(module) {
    module._thrustLimitPulseTime = 0;
  }

  update(dt) {
    if (buildMode) return;

    for (const m of placedModules) {
      const stats = BUILDING_STATS[m.type];
      if (!stats || !stats.thrust) continue;

      if (res.fuel <= 0) {
        m._thrustActive = false;
        this.resetThrusterLimitPulse(m);
        continue;
      }

      const moduleRot = (m.rot || 0) * Math.PI / 2;
      const shipLocalDir = stats.thrustDir + moduleRot;

      const up = Math.abs(normalizeAngle(shipLocalDir + Math.PI / 2)) < 0.5;
      const down = Math.abs(normalizeAngle(shipLocalDir - Math.PI / 2)) < 0.5;
      const left = Math.abs(normalizeAngle(shipLocalDir - Math.PI)) < 0.5;
      const right = Math.abs(normalizeAngle(shipLocalDir)) < 0.5;

      let active = false;
      if (up && keys.w) active = true;
      if (down && keys.s) active = true;
      if (left && keys.q) active = true;
      if (right && keys.e) active = true;

      if (active) {
        const thrustScale = precisionThrust ? 0.2 : 1;
        const massFactor = getMassAccelerationFactor(placedModules);
        const worldDir = shipLocalDir + this.angle;
        const ax = Math.cos(worldDir) * stats.thrust * thrustScale * dt * 0.12 * massFactor;
        const ay = Math.sin(worldDir) * stats.thrust * thrustScale * dt * 0.12 * massFactor;

        if (!canAccelerateWithVelocity(this.vx, this.vy, ax, ay)) {
          this.setThrusterLimitPulse(m, dt);
          continue;
        }

        this.vx += ax;
        this.vy += ay;
        if (!orbitModeActive) {
          res.fuel = Math.max(0, res.fuel - stats.fuelUse * thrustScale * dt);
        }
        m._thrustActive = true;
        this.resetThrusterLimitPulse(m);
      } else {
        m._thrustActive = false;
        this.resetThrusterLimitPulse(m);
      }
    }

    if (keys[" "]) {
      if (!velocityAssistActive) {
        precisionBeforeAssist = precisionThrust;
        lockedApproachTarget = selectedFlightTarget || getMouseFlightObject();
        velocityAssistActive = true;
      }
      this.updateVelocityMatch(dt, lockedApproachTarget);
    } else {
      velocityMatchTarget = null;
      lockedApproachTarget = null;
      if (velocityAssistActive) {
        precisionThrust = precisionBeforeAssist;
        velocityAssistActive = false;
      }
    }

    this.updateRotation(dt);

    clampVelocity(this);

    // Apply gravity from galaxy bodies (only black hole now)
    applyGravity(dt);
    // Auto-deceleration when no thrust is applied
    applyVelocityDamping(dt);
    updateOrbitMode(dt);
    updateLandingMode(dt);

    this.x += this.vx;
    this.y += this.vy;

    this.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, this.x));
    this.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, this.y));
  }

  updateVelocityMatch(dt, target) {
    let liveTarget = resolveFlightTarget(target);
    if (!liveTarget) {
      const reacquired = getMouseFlightObject();
      if (reacquired) {
        lockedApproachTarget = reacquired;
        liveTarget = resolveFlightTarget(reacquired);
      }
    }

    velocityMatchTarget = liveTarget;
    if (!velocityMatchTarget || res.fuel <= 0) return;

    const dx = velocityMatchTarget.x - this.x;
    const dy = velocityMatchTarget.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let angleDiff = 0;
    if (matchRotateNose && dist > 0.01) {
      const desiredShipAngle = Math.atan2(dy, dx) + Math.PI / 2 + SHIP_NOSE_OFFSET;
      angleDiff = Math.abs(normalizeAngle(desiredShipAngle - this.angle));
      this.rotateToward(dt, desiredShipAngle, 1.0);
    }

    const command = getApproachCommandForState(this.x, this.y, this.vx, this.vy, velocityMatchTarget);
    if (!command) return;

    const surfaceGap = getSurfaceGapToTarget(this.x, this.y, velocityMatchTarget);
    const closeApproach = !velocityMatchTarget.enemy && surfaceGap <= CONFIG.GRID_SIZE * 8;
    const turningHard = matchRotateNose && angleDiff > 0.8;
    precisionThrust = closeApproach || turningHard ? true : precisionBeforeAssist;

    const dvx = command.x - this.vx;
    const dvy = command.y - this.vy;
    const delta = Math.sqrt(dvx * dvx + dvy * dvy);

    if (Math.abs(this.angularVelocity) > 0.01 && !matchRotateNose) {
      this.angularVelocity *= Math.pow(0.05, dt);
    }

    if (delta < 0.06) return;

    const desiredAngle = Math.atan2(dvy, dvx);
    if (!this.thrustToward(dt, desiredAngle)) {
      flash("No thruster faces the needed direction");
    }
  }

  updateEnemyIntercept(dt, target) {
    this.updateVelocityMatch(dt, target);
  }

  getAccelerationToward(desiredAngle, scale = 1) {
    let acceleration = 0;

    for (const module of placedModules) {
      const stats = BUILDING_STATS[module.type];
      if (!stats || !stats.thrust) continue;

      const shipLocalDir = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
      const worldDir = shipLocalDir + this.angle;
      const diff = Math.abs(normalizeAngle(desiredAngle - worldDir));

      if (diff > Math.PI / 4) continue;
      acceleration += Math.cos(diff) * stats.thrust * scale * 0.12 * getMassAccelerationFactor(placedModules);
    }

    return acceleration;
  }
  rotateToward(dt, desiredAngle, strength = 1) {
    const diff = normalizeAngle(desiredAngle - this.angle);
    const turnScale = precisionThrust ? 0.2 : 1;
    this.angularVelocity += Math.max(-1, Math.min(1, diff * 4.0)) * strength * turnScale * dt;
  }

  updateRotation(dt) {
    const turnScale = precisionThrust ? 0.2 : 1;
    const hasRCS = placedModules.some(m => m.type === "RCS Thruster");

    if (hasRCS && res.fuel > 0) {
      let turnInput = 0;
      if (keys.a) turnInput -= 1;
      if (keys.d) turnInput += 1;

      if (turnInput !== 0) {
        this.angularVelocity += turnInput * 1.2 * turnScale * dt;
        if (!orbitModeActive) {
          res.fuel = Math.max(0, res.fuel - 0.6 * turnScale * dt);
        }

        for (const m of placedModules) {
          if (m.type === "RCS Thruster") m._thrustActive = true;
        }
      }
    }

    this.angularVelocity *= Math.pow(0.18, dt);
    this.angularVelocity = Math.max(-3.2, Math.min(3.2, this.angularVelocity));
    this.angle += this.angularVelocity * dt;
  }

  thrustToward(dt, desiredAngle) {
    if (res.fuel <= 0) return false;

    const thrustScale = precisionThrust ? 0.2 : 1;
    let usedThruster = false;

    for (const m of placedModules) {
      const stats = BUILDING_STATS[m.type];
      if (!stats || !stats.thrust) continue;

      const shipLocalDir = stats.thrustDir + (m.rot || 0) * Math.PI / 2;
      const worldDir = shipLocalDir + this.angle;
      const diff = Math.abs(normalizeAngle(desiredAngle - worldDir));

      if (diff > Math.PI / 4) continue;

      const massFactor = getMassAccelerationFactor(placedModules);
      const ax = Math.cos(worldDir) * stats.thrust * thrustScale * dt * 0.12 * massFactor;
      const ay = Math.sin(worldDir) * stats.thrust * thrustScale * dt * 0.12 * massFactor;

      if (!canAccelerateWithVelocity(this.vx, this.vy, ax, ay)) {
        this.setThrusterLimitPulse(m, dt);
        continue;
      }

      this.vx += ax;
      this.vy += ay;
      if (!orbitModeActive) {
        res.fuel = Math.max(0, res.fuel - stats.fuelUse * thrustScale * dt);
      }
      m._thrustActive = true;
      this.resetThrusterLimitPulse(m);
      usedThruster = true;
    }

    return usedThruster;
  }

  draw() {}
}

class Asteroid {
  constructor(x, y, kind = worldRand() < 0.10 ? "ice" : "rock") {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.size = kind === "ice" ? 35 + worldRand() * 70 : 30 + worldRand() * 60;
    this.angle = worldRand() * Math.PI * 2;
    const driftAngle = worldRand() * Math.PI * 2;
    const driftSpeed = 1.8 + worldRand() * (MAX_ASTEROID_DRIFT_SPEED - 1.8);
    this.vx = Math.cos(driftAngle) * driftSpeed;
    this.vy = Math.sin(driftAngle) * driftSpeed;
    this.spin = (worldRand() - 0.5) * 0.01;
    this.contents = createAsteroidContents(this.kind);
    this.totalItems = getAsteroidTotal(this.contents);
    this.maxItems = this.totalItems;
    this.verts = [];

    const n = 8 + Math.floor(worldRand() * 5);

    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = this.size * (0.7 + worldRand() * 0.3);
      this.verts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  }

  update(dt) {
    if (this._beltStar) {
      this._beltAngle += this._beltOrbitSpeed * dt;
      const oldX = this.x;
      const oldY = this.y;
      this.x = this._beltStar.x + Math.cos(this._beltAngle) * this._beltDist;
      this.y = this._beltStar.y + Math.sin(this._beltAngle) * this._beltDist;
      this.vx = (this.x - oldX) / Math.max(dt * 60, 0.001);
      this.vy = (this.y - oldY) / Math.max(dt * 60, 0.001);
    } else {
      this.x += this.vx * dt * 60;
      this.y += this.vy * dt * 60;
    }

    this.angle += this.spin * dt * 60;

    if (this.x < 0) this.x += CONFIG.WORLD_WIDTH;
    if (this.x > CONFIG.WORLD_WIDTH) this.x -= CONFIG.WORLD_WIDTH;
    if (this.y < 0) this.y += CONFIG.WORLD_HEIGHT;
    if (this.y > CONFIG.WORLD_HEIGHT) this.y -= CONFIG.WORLD_HEIGHT;
  }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const s = camera.scale;
    const frac = Math.max(0, this.totalItems / Math.max(1, this.maxItems));

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);

    ctx.beginPath();
    ctx.moveTo(this.verts[0].x * s, this.verts[0].y * s);

    for (let i = 1; i < this.verts.length; i++) {
      ctx.lineTo(this.verts[i].x * s, this.verts[i].y * s);
    }

    ctx.closePath();

    const grayVal = Math.floor(80 + frac * 80);
    ctx.fillStyle = this.kind === "ice"
      ? `rgb(${Math.floor(70 + frac * 70)},${Math.floor(155 + frac * 70)},${Math.floor(210 + frac * 45)})`
      : `rgb(${grayVal},${grayVal},${grayVal})`;
    ctx.strokeStyle = this.kind === "ice" ? "#9ee8ff" : "#aaa";
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }
}

class WaterPlanet {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 220 * CELESTIAL_SIZE_FACTOR;
    this.type = "water";    this.angle = 0;
  }

  update(dt) {
    this.angle += dt * 0.03;
  }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const r = this.radius * camera.scale;
    const gradient = ctx.createRadialGradient(p.x - r * 0.25, p.y - r * 0.25, r * 0.05, p.x, p.y, r);

    gradient.addColorStop(0, "rgba(190,235,255,1)");
    gradient.addColorStop(0.45, "rgba(45,145,230,0.95)");
    gradient.addColorStop(1, "rgba(5,35,95,1)");

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.strokeStyle = "rgba(150,220,255,0.75)";
    ctx.lineWidth = Math.max(1, 2 * camera.scale);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.strokeStyle = "rgba(230,250,255,0.18)";
    ctx.lineWidth = Math.max(1, 3 * camera.scale);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, i * r * 0.22, r * 0.82, r * 0.08, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }
}

const camera = new Camera();
const ship = new Ship();

function randomWorldPositionAwayFromShip(minTiles = 50) {
  const minDist = CONFIG.GRID_SIZE * minTiles;

  for (let tries = 0; tries < 100; tries++) {
    const x = Math.random() * CONFIG.WORLD_WIDTH;
    const y = Math.random() * CONFIG.WORLD_HEIGHT;

    if (Math.hypot(x - ship.x, y - ship.y) >= minDist) {
      return { x, y };
    }
  }

  return {
    x: Math.max(0, Math.min(CONFIG.WORLD_WIDTH, ship.x + minDist)),
    y: ship.y
  };
}

function createAsteroidAwayFromShip() {
  for (let tries = 0; tries < 60; tries++) {
    const pos = randomWorldPositionAwayFromShip(50);
    const asteroid = new Asteroid(pos.x, pos.y);
    if (!isInsideCelestialBody(asteroid.x, asteroid.y, asteroid.size + CONFIG.GRID_SIZE * 2)) {
      return asteroid;
    }
  }

  const pos = randomWorldPositionAwayFromShip(50);
  return new Asteroid(pos.x, pos.y);
}

function createAmbientSystemAsteroid(star, maxRadius, kind = "rock") {
  for (let tries = 0; tries < 50; tries++) {
    const angle = worldRand() * Math.PI * 2;
    const minR = star.radius * 2.2;
    const dist = minR + worldRand() * Math.max(CONFIG.GRID_SIZE * 100, maxRadius - minR);
    const asteroid = new Asteroid(star.x + Math.cos(angle) * dist, star.y + Math.sin(angle) * dist, kind);
    if (isInsideCelestialBody(asteroid.x, asteroid.y, asteroid.size + CONFIG.GRID_SIZE * 2)) continue;
    asteroid._beltStar = star;
    asteroid._beltDist = dist;
    asteroid._beltAngle = angle;
    asteroid._beltOrbitSpeed = (0.000015 + worldRand() * 0.000025) * (worldRand() < 0.5 ? 1 : -1) * (CONFIG.GRID_SIZE * 400 / Math.max(dist, 1));
    asteroid._ambientSystemAsteroid = true;
    return asteroid;
  }

  return null;
}

function spawnAmbientSystemAsteroids(system, count) {
  if (!system || !system.star) return;
  const maxRadius = Math.max(
    system.outerBelt?.outerR || 0,
    system.innerBelt?.outerR || 0,
    ...system.planets.map(planet => planet.orbitRadius + planet.radius)
  ) * 1.04;

  for (let i = 0; i < count; i++) {
    const asteroid = createAmbientSystemAsteroid(system.star, maxRadius, worldRand() < 0.12 ? "ice" : "rock");
    if (asteroid) asteroids.push(asteroid);
  }
}

function spawnAmbientGalaxyAsteroids(count) {
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 50; tries++) {
      const angle = worldRand() * Math.PI * 2;
      const dist = CONFIG.GALAXY_RADIUS * (0.16 + worldRand() * 0.9);
      const asteroid = new Asteroid(
        CONFIG.GALAXY_CENTER_X + Math.cos(angle) * dist,
        CONFIG.GALAXY_CENTER_Y + Math.sin(angle) * dist,
        worldRand() < 0.08 ? "ice" : "rock"
      );
      if (isInsideCelestialBody(asteroid.x, asteroid.y, asteroid.size + CONFIG.GRID_SIZE * 2)) continue;
      asteroid._ambientGalaxyAsteroid = true;
      asteroids.push(asteroid);
      break;
    }
  }
}

function isInsideCelestialBody(x, y, padding = 0) {
  if (blackHole && Math.hypot(x - blackHole.x, y - blackHole.y) <= blackHole.radius + padding) return true;

  for (const star of worldStars) {
    if (Math.hypot(x - star.x, y - star.y) <= star.radius + padding) return true;
  }

  for (const planet of planets) {
    if (Math.hypot(x - planet.x, y - planet.y) <= planet.radius + padding) return true;
  }

  return false;
}

// Galaxy generated after camera/ship init below


camera.x = ship.x;
camera.y = ship.y;
buildCamera.x = ship.x;
buildCamera.y = ship.y;

// ═══════════════════════════════════════════════════════════════════════════
// GALAXY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// ── Seeded pseudo-random for deterministic galaxy layout ──────────────────
function seededRand(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

let activeWorldRand = Math.random;
function worldRand() {
  return activeWorldRand();
}

// ── Planet type definitions ───────────────────────────────────────────────


const PLANET_TYPE_KEYS = Object.keys(PLANET_TYPES);
const CELESTIAL_SIZE_FACTOR = 3;
const BLACK_HOLE_SIZE_FACTOR = 2.5;
const PLANET_ORBIT_GAP = CONFIG.GRID_SIZE * 220;
const SYSTEM_EDGE_PADDING = CONFIG.GRID_SIZE * 900;
const ASTEROID_BELT_WIDTH = CONFIG.GRID_SIZE * 420;
const PLANET_ORBIT_PERIOD_MIN = 60 * 60;
const PLANET_ORBIT_PERIOD_MAX = 3 * 60 * 60;
const SYSTEM_ORBIT_PERIOD_MIN = 3 * 60 * 60;
const SYSTEM_ORBIT_PERIOD_MAX = 5 * 60 * 60;
const WORLD_CHUNK_SIZE = CONFIG.GRID_SIZE * 1800;
const ACTIVE_CHUNK_RADIUS = 1;

function orbitSpeedFromPeriodSeconds(seconds) {
  return Math.PI * 2 / Math.max(1, seconds);
}

function randomOrbitSpeed(minSeconds, maxSeconds) {
  return orbitSpeedFromPeriodSeconds(minSeconds + worldRand() * (maxSeconds - minSeconds));
}

function getOrbitAngleAt(baseAngle, speed, dir, timeSeconds) {
  return baseAngle + speed * dir * Math.max(0, timeSeconds || 0);
}

function getWorldChunkCoord(value) {
  return Math.floor(value / WORLD_CHUNK_SIZE);
}

function getWorldChunkKey(x, y) {
  return `${getWorldChunkCoord(x)},${getWorldChunkCoord(y)}`;
}

function addActiveWorldChunksForPoint(chunks, x, y) {
  const cx = getWorldChunkCoord(x);
  const cy = getWorldChunkCoord(y);

  for (let dx = -ACTIVE_CHUNK_RADIUS; dx <= ACTIVE_CHUNK_RADIUS; dx++) {
    for (let dy = -ACTIVE_CHUNK_RADIUS; dy <= ACTIVE_CHUNK_RADIUS; dy++) {
      chunks.add(`${cx + dx},${cy + dy}`);
    }
  }
}

function getActiveWorldChunks() {
  const chunks = new Set();
  addActiveWorldChunksForPoint(chunks, ship.x, ship.y);

  if (typeof smallShips !== "undefined") {
    for (const smallShip of smallShips) {
      if (smallShip && !smallShip._delete && Number.isFinite(smallShip.x) && Number.isFinite(smallShip.y)) {
        addActiveWorldChunksForPoint(chunks, smallShip.x, smallShip.y);
      }
    }
  }

  return chunks;
}

function getActiveWorldFocusPoints() {
  const points = [{ x: ship.x, y: ship.y }];

  if (typeof smallShips !== "undefined") {
    for (const smallShip of smallShips) {
      if (smallShip && !smallShip._delete && Number.isFinite(smallShip.x) && Number.isFinite(smallShip.y)) {
        points.push({ x: smallShip.x, y: smallShip.y });
      }
    }
  }

  return points;
}

function isPointInActiveChunks(x, y, chunks) {
  return chunks.has(getWorldChunkKey(x, y));
}

function getSystemActivityRadius(system) {
  if (!system) return 0;
  return Math.max(
    system.outerBelt?.outerR || 0,
    system.innerBelt?.outerR || 0,
    ...((system.planets || []).map(planet => planet.orbitRadius + planet.radius))
  );
}

function isSystemNearActiveFocus(system, focusPoints) {
  if (!system || !system.star) return false;
  const radius = getSystemActivityRadius(system) + WORLD_CHUNK_SIZE * (ACTIVE_CHUNK_RADIUS + 1);

  for (const point of focusPoints) {
    if (Math.hypot(point.x - system.star.x, point.y - system.star.y) <= radius) {
      return true;
    }
  }

  return false;
}

function syncSystemPositionsAtTime(system, timeSeconds) {
  if (!system) return;
  system.star?.setPositionAt?.(timeSeconds);

  for (const planet of system.planets || []) {
    planet.setPositionAt?.(timeSeconds);
  }
}

function syncStarPositionsAtTime(timeSeconds = worldPlayTime) {
  for (const star of worldStars) {
    star.setPositionAt?.(timeSeconds);
  }
}

function syncVisibleWorldPositions(timeSeconds = worldPlayTime) {
  for (const system of solarSystems) {
    syncSystemPositionsAtTime(system, timeSeconds);
  }
}

let lastMapWorldSyncSecond = -1;
function syncMapWorldPositionsIfNeeded(timeSeconds = worldPlayTime) {
  const second = Math.floor(timeSeconds || 0);
  if (lastMapWorldSyncSecond === second) return;
  lastMapWorldSyncSecond = second;
  syncVisibleWorldPositions(timeSeconds);
}

class GalaxyPlanet {
  constructor(x, y, typeKey, r, starRef) {
    this.x = x; this.y = y;
    this.typeKey = typeKey;
    this.def = PLANET_TYPES[typeKey];
    this.radius = r;
    this.star = starRef;
    // Orbital parameters around its star
    const dx = x - starRef.x, dy = y - starRef.y;
    this.orbitRadius = Math.sqrt(dx*dx + dy*dy);
    this.orbitAngle = Math.atan2(dy, dx);
    this.orbitDir = worldRand() < 0.5 ? 1 : -1;
    this.orbitSpeed = randomOrbitSpeed(PLANET_ORBIT_PERIOD_MIN, PLANET_ORBIT_PERIOD_MAX);
    this.baseOrbitAngle = this.orbitAngle;
    this.spinAngle = worldRand() * Math.PI * 2;
    this.spinSpeed = 0.005 + worldRand() * 0.02;
    // Generate cloud bands (for visual)
    this.bands = [];
    const rng = seededRand(Math.floor(x + y * 7));
    for (let i = 0; i < 5 + Math.floor(rng() * 4); i++) {
      this.bands.push({ offset: rng() * 2 - 1, width: 0.05 + rng() * 0.18, alpha: 0.08 + rng() * 0.18 });
    }
    this.type = typeKey; // compat with existing planet collision code
  }

  update(dt) {
    this.orbitAngle += this.orbitSpeed * this.orbitDir * dt;
    this.setPositionFromAngle(this.orbitAngle);
    this.spinAngle += this.spinSpeed * dt;
  }

  setPositionFromAngle(angle) {
    this.orbitAngle = angle;
    this.x = this.star.x + Math.cos(this.orbitAngle) * this.orbitRadius;
    this.y = this.star.y + Math.sin(this.orbitAngle) * this.orbitRadius;
  }

  setPositionAt(timeSeconds) {
    this.setPositionFromAngle(getOrbitAngleAt(this.baseOrbitAngle, this.orbitSpeed, this.orbitDir, timeSeconds));
  }

  get gravity() { return this.radius * 0.018; }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const r = this.radius * camera.scale;

    // Cull offscreen
    if (p.x < -r*2 || p.x > VIEW.w+r*2 || p.y < -r*2 || p.y > VIEW.h+r*2) return;

    const colors = this.def.colors;
    // Main body gradient
    const grad = ctx.createRadialGradient(p.x - r*0.3, p.y - r*0.3, r*0.05, p.x, p.y, r);
    grad.addColorStop(0, colors[2]);
    grad.addColorStop(0.4, colors[1]);
    grad.addColorStop(0.8, colors[0]);
    grad.addColorStop(1, "#000000");

    ctx.save();
    ctx.translate(p.x, p.y);

    if (this.typeKey === "gas" && r > 2) {
      const cloudRad = r * 1.65;
      const cloudGrad = ctx.createRadialGradient(0, 0, r * 0.72, 0, 0, cloudRad);
      cloudGrad.addColorStop(0, "rgba(255,225,150,0.20)");
      cloudGrad.addColorStop(0.55, "rgba(255,210,110,0.10)");
      cloudGrad.addColorStop(1, "transparent");
      ctx.beginPath();
      ctx.arc(0, 0, cloudRad, 0, Math.PI*2);
      ctx.fillStyle = cloudGrad;
      ctx.fill();

      ctx.save();
      ctx.rotate(this.spinAngle * 0.45);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.ellipse(0, i * r * 0.34, cloudRad * 0.95, r * 0.18, 0, 0, Math.PI*2);
        ctx.strokeStyle = "rgba(255,235,180,0.08)";
        ctx.lineWidth = Math.max(1, r * 0.035);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Atmosphere glow
    if (r > 2) {
      const atmRad = r * 1.18;
      const atmGrad = ctx.createRadialGradient(0, 0, r*0.85, 0, 0, atmRad);
      atmGrad.addColorStop(0, this.def.atmosphere || "rgba(0,100,255,0.15)");
      atmGrad.addColorStop(1, "transparent");
      ctx.beginPath(); ctx.arc(0, 0, atmRad, 0, Math.PI*2);
      ctx.fillStyle = atmGrad; ctx.fill();
    }

    // Planet body
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();

    // Cloud/surface bands (only when large enough to see)
    if (r > 8) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI*2);
      ctx.clip();
      ctx.rotate(this.spinAngle);
      for (const band of this.bands) {
        ctx.beginPath();
        ctx.ellipse(0, band.offset * r, r * 0.98, r * band.width, 0, 0, Math.PI*2);
        ctx.fillStyle = `rgba(${hexToRgb(this.def.cloudColor || "#ffffff")},${band.alpha})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Terminator shadow
    const shadowGrad = ctx.createRadialGradient(r*0.35, -r*0.1, 0, 0, 0, r);
    shadowGrad.addColorStop(0, "transparent");
    shadowGrad.addColorStop(0.7, "transparent");
    shadowGrad.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = shadowGrad; ctx.fill();

    ctx.restore();

    // Label when close enough
    if (r > 30) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `${Math.min(14, Math.max(9, r * 0.07))}px Arial`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(this.def.name, p.x, p.y + r + 4);
    }
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ── Black Hole ────────────────────────────────────────────────────────────
class BlackHole {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = CONFIG.BLACK_HOLE_RADIUS * BLACK_HOLE_SIZE_FACTOR;
    this.gravity = this.radius * 0.5; // very strong
    this.accretionAngle = 0;
  }

  update(dt) {
    this.accretionAngle += dt * 0.01;
  }

  get type() { return "blackhole"; }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const r = this.radius * camera.scale;

    if (p.x < -r*4 || p.x > VIEW.w+r*4 || p.y < -r*4 || p.y > VIEW.h+r*4) return;

    ctx.save();
    ctx.translate(p.x, p.y);

    // Outer glow / gravitational lens effect
    const outerR = r * 3.5;
    const lensGrad = ctx.createRadialGradient(0, 0, r, 0, 0, outerR);
    lensGrad.addColorStop(0, "rgba(120,0,200,0.5)");
    lensGrad.addColorStop(0.3, "rgba(80,0,160,0.2)");
    lensGrad.addColorStop(0.7, "rgba(30,0,80,0.08)");
    lensGrad.addColorStop(1, "transparent");
    ctx.beginPath(); ctx.arc(0, 0, outerR, 0, Math.PI*2);
    ctx.fillStyle = lensGrad; ctx.fill();

    // Accretion disk — elliptical rings, animated
    ctx.rotate(this.accretionAngle);
    for (let ring = 0; ring < 6; ring++) {
      const ri = r * (1.3 + ring * 0.35);
      const alpha = 0.7 - ring * 0.1;
      const hue = ring < 3 ? `rgba(255,${100 + ring*30},0,${alpha})` : `rgba(255,${200 + ring*10},100,${alpha*0.6})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, ri, ri * 0.22, 0, 0, Math.PI*2);
      ctx.strokeStyle = hue;
      ctx.lineWidth = Math.max(1, r * 0.12 * (1 - ring * 0.12));
      ctx.stroke();
    }
    ctx.rotate(-this.accretionAngle);

    // Event horizon — pure black
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2);
    ctx.fillStyle = "#000000"; ctx.fill();

    // Inner glow ring
    const innerGlow = ctx.createRadialGradient(0, 0, r*0.75, 0, 0, r*1.05);
    innerGlow.addColorStop(0, "transparent");
    innerGlow.addColorStop(0.6, "rgba(200,100,255,0.25)");
    innerGlow.addColorStop(1, "rgba(150,50,200,0.5)");
    ctx.beginPath(); ctx.arc(0, 0, r*1.05, 0, Math.PI*2);
    ctx.fillStyle = innerGlow; ctx.fill();

    ctx.restore();

    if (r > 20) {
      ctx.fillStyle = "rgba(200,100,255,0.8)";
      ctx.font = "bold 13px Arial";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("BLACK HOLE", p.x, p.y + r * 1.1 + 5);
    }
  }
}

class EndTwinPlanet {
  constructor(centerX, centerY, radius, angle, colors) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.radius = radius;
    this.angle = angle;
    this.orbitRadius = radius * 0.56;
    this.spinAngle = angle;
    this.colors = colors;
    this.type = "planet";
    this.typeKey = "end";
    this.def = { name: "Unknown Planet", colors, atmosphere: "rgba(120,180,255,0.18)", cloudColor: "#cceeff" };
    this.x = centerX + Math.cos(angle) * this.orbitRadius;
    this.y = centerY + Math.sin(angle) * this.orbitRadius;
  }

  update(dt) {
    this.angle += dt * 0.006;
    this.spinAngle += dt * 0.012;
    this.x = this.centerX + Math.cos(this.angle) * this.orbitRadius;
    this.y = this.centerY + Math.sin(this.angle) * this.orbitRadius;
  }

  get gravity() { return this.radius * 0.035; }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const r = this.radius * camera.scale;
    if (p.x < -r * 2 || p.x > VIEW.w + r * 2 || p.y < -r * 2 || p.y > VIEW.h + r * 2) return;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(this.spinAngle);

    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.45);
    glow.addColorStop(0, "rgba(90,160,255,0.16)");
    glow.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    const grad = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.05, 0, 0, r);
    grad.addColorStop(0, this.colors[2]);
    grad.addColorStop(0.48, this.colors[1]);
    grad.addColorStop(1, this.colors[0]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    if (r > 12) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, i * r * 0.23, r * 0.95, r * 0.09, 0, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? "rgba(210,235,255,0.10)" : "rgba(40,70,150,0.16)";
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

// ── Asteroid Belt ─────────────────────────────────────────────────────────
class AsteroidBelt {
  constructor(star, innerR, outerR, count, kind) {
    this.star = star;
    this.innerR = innerR;
    this.outerR = outerR;
    this.kind = kind; // "inner" or "outer"
    this.orbitSpeed = 0.000015 + worldRand() * 0.00001;
    this.orbitAngle = 0;
    this.rocks = [];

    const rng = seededRand(Math.floor(star.x + star.y + innerR));
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const dist = innerR + rng() * (outerR - innerR);
      const size = 6 + rng() * 22;
      const isIce = kind === "outer" && rng() < 0.1;
      const speed = (0.00003 + rng() * 0.00004) * (1000 / Math.max(dist, 500));
      const dir = rng() < 0.5 ? 1 : -1;
      this.rocks.push({ angle, dist, size, isIce, orbitSpeed: speed * dir });
    }
  }

  update(dt) {
    for (const r of this.rocks) {
      r.angle += r.orbitSpeed * dt;
    }
  }

  draw() {
    const starP = worldToScreen(this.star.x, this.star.y);
    // Only draw if star is reasonably on screen
    const maxR = this.outerR * camera.scale;
    if (starP.x < -maxR*2 || starP.x > VIEW.w+maxR*2 || starP.y < -maxR*2 || starP.y > VIEW.h+maxR*2) return;

    if (camera.scale > 0.003) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = Math.max(1, camera.scale * 2);
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(starP.x, starP.y, this.innerR * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(starP.x, starP.y, this.outerR * camera.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const drawStep = camera.scale < 0.02 ? 5 : camera.scale < 0.05 ? 3 : camera.scale < 0.12 ? 2 : 1;
    for (let i = 0; i < this.rocks.length; i += drawStep) {
      const rock = this.rocks[i];
      const wx = this.star.x + Math.cos(rock.angle) * rock.dist;
      const wy = this.star.y + Math.sin(rock.angle) * rock.dist;
      const p = worldToScreen(wx, wy);

      if (p.x < -20 || p.x > VIEW.w+20 || p.y < -20 || p.y > VIEW.h+20) continue;

      const r = rock.size * camera.scale;
      if (r < 0.3) continue;

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI*2);
      ctx.fillStyle = rock.isIce ? "#9ee8ff" : "#888888";
      ctx.fill();
    }
  }
}

// ── GalaxyStar ────────────────────────────────────────────────────────────


class GalaxyStar {
  constructor(x, y, radius, typeIndex) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.type = "star";
    this.starType = STAR_TYPES[typeIndex % STAR_TYPES.length];
    // Orbit around black hole
    const dx = x - CONFIG.GALAXY_CENTER_X, dy = y - CONFIG.GALAXY_CENTER_Y;
    this.orbitRadius = Math.sqrt(dx*dx + dy*dy);
    this.orbitAngle = Math.atan2(dy, dx);
    this.orbitDir = worldRand() < 0.5 ? 1 : -1;
    this.orbitSpeed = randomOrbitSpeed(SYSTEM_ORBIT_PERIOD_MIN, SYSTEM_ORBIT_PERIOD_MAX);
    this.baseOrbitAngle = this.orbitAngle;
    this.pulseT = worldRand() * Math.PI * 2;
  }

  update(dt) {
    this.orbitAngle += this.orbitSpeed * this.orbitDir * dt;
    this.setPositionFromAngle(this.orbitAngle);
    this.pulseT += dt * 0.4;
  }

  setPositionFromAngle(angle) {
    this.orbitAngle = angle;
    this.x = CONFIG.GALAXY_CENTER_X + Math.cos(this.orbitAngle) * this.orbitRadius;
    this.y = CONFIG.GALAXY_CENTER_Y + Math.sin(this.orbitAngle) * this.orbitRadius;
  }

  setPositionAt(timeSeconds) {
    this.setPositionFromAngle(getOrbitAngleAt(this.baseOrbitAngle, this.orbitSpeed, this.orbitDir, timeSeconds));
  }

  get gravity() { return this.radius * 0.008; }

  draw() {
    const p = worldToScreen(this.x, this.y);
    const pulse = 1 + Math.sin(this.pulseT) * 0.04;
    const r = this.radius * camera.scale * pulse;

    if (p.x < -r*3 || p.x > VIEW.w+r*3 || p.y < -r*3 || p.y > VIEW.h+r*3) return;

    const st = this.starType;
    // Corona
    const coronaR = r * 2.2;
    const coronaGrad = ctx.createRadialGradient(p.x, p.y, r*0.5, p.x, p.y, coronaR);
    coronaGrad.addColorStop(0, st.color1.replace(")", ",0.4)").replace("rgb","rgba"));
    coronaGrad.addColorStop(1, "transparent");
    ctx.beginPath(); ctx.arc(p.x, p.y, coronaR, 0, Math.PI*2);
    ctx.fillStyle = coronaGrad; ctx.fill();

    // Main body
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, st.color0);
    grad.addColorStop(0.4, st.color1);
    grad.addColorStop(1, st.color2 + "00");
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();

    if (r > 15) {
      ctx.fillStyle = "rgba(255,240,180,0.75)";
      ctx.font = `${Math.min(13, Math.max(8, r * 0.05))}px Arial`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(st.name, p.x, p.y + r + 3);
    }
  }
}

// ── Galaxy Generator ──────────────────────────────────────────────────────
function generateGalaxy() {
  const CX = CONFIG.GALAXY_CENTER_X, CY = CONFIG.GALAXY_CENTER_Y;
  const rng = seededRand(currentWorldSeed || 42);
  activeWorldRand = rng;

  if (currentWorldIsEnd) {
    generateEndGalaxy(rng);
    activeWorldRand = Math.random;
    return;
  }

  // Black hole at center
  blackHole = new BlackHole(CX, CY);

  // 10 solar systems evenly spread + some randomness
  for (let si = 0; si < CONFIG.SYSTEM_COUNT; si++) {
    const angleBase = (si / CONFIG.SYSTEM_COUNT) * Math.PI * 2;
    const angle = angleBase + (rng() - 0.5) * 0.22;
    const ring = si % 2;
    const dist = CONFIG.GALAXY_RADIUS * (ring === 0 ? 0.55 + rng() * 0.08 : 0.82 + rng() * 0.08);
    const sx = CX + Math.cos(angle) * dist;
    const sy = CY + Math.sin(angle) * dist;
    const starRadius = (1200 + rng() * 1200) * CELESTIAL_SIZE_FACTOR;
    const starTypeIdx = Math.floor(rng() * STAR_TYPES.length);

    const star = new GalaxyStar(sx, sy, starRadius, starTypeIdx);
    worldStars.push(star);

    // 10 planets per system
    const systemPlanets = [];
    const usedTypes = [];
    let nextOrbit = starRadius + PLANET_ORBIT_GAP;
    const maxOrbitBeforeBlackHole = Math.max(
      starRadius + PLANET_ORBIT_GAP,
      dist - blackHole.radius - SYSTEM_EDGE_PADDING
    );
    for (let pi = 0; pi < 10; pi++) {
      // Pick planet type: gas giants tend to be outer
      let typeKey;
      if (pi < 3) {
        // Inner: rocky types
        typeKey = ["lava","desert","metal","radioactive"][Math.floor(rng() * 4)];
      } else if (pi < 7) {
        // Mid: varied
        typeKey = PLANET_TYPE_KEYS[Math.floor(rng() * PLANET_TYPE_KEYS.length)];
      } else {
        // Outer: gas/ice/water
        typeKey = ["gas","ice","water","jungle"][Math.floor(rng() * 4)];
      }
      usedTypes.push(typeKey);

      const def = PLANET_TYPES[typeKey];
      const radius = (def.radius[0] + rng() * (def.radius[1] - def.radius[0])) * CELESTIAL_SIZE_FACTOR;
      const orbitDist = Math.min(maxOrbitBeforeBlackHole, nextOrbit + radius + rng() * CONFIG.GRID_SIZE * 80);
      nextOrbit = orbitDist + radius + PLANET_ORBIT_GAP + rng() * CONFIG.GRID_SIZE * 70;
      const planetAngle = rng() * Math.PI * 2;
      const px = sx + Math.cos(planetAngle) * orbitDist;
      const py = sy + Math.sin(planetAngle) * orbitDist;
      const planet = new GalaxyPlanet(px, py, typeKey, radius, star);
      systemPlanets.push(planet);
      planets.push(planet);
    }

    const sortedPlanets = [...systemPlanets].sort((a, b) => a.orbitRadius - b.orbitRadius);
    const beltSlots = [];
    for (let i = 0; i < sortedPlanets.length - 1; i++) {
      const innerEdge = sortedPlanets[i].orbitRadius + sortedPlanets[i].radius + CONFIG.GRID_SIZE * 55;
      const outerEdge = sortedPlanets[i + 1].orbitRadius - sortedPlanets[i + 1].radius - CONFIG.GRID_SIZE * 55;
      const width = outerEdge - innerEdge;
      if (i >= 1 && i <= 7 && width >= ASTEROID_BELT_WIDTH * 1.2) {
        beltSlots.push({ innerEdge, outerEdge, width, index: i });
      }
    }

    beltSlots.sort((a, b) => b.width - a.width);
    const firstSlot = beltSlots[0] || {
      innerEdge: sortedPlanets[3].orbitRadius + sortedPlanets[3].radius + CONFIG.GRID_SIZE * 45,
      outerEdge: sortedPlanets[4].orbitRadius - sortedPlanets[4].radius - CONFIG.GRID_SIZE * 45
    };
    const fallbackOuterPlanet = sortedPlanets[Math.min(7, sortedPlanets.length - 1)];
    const fallbackSecondSlot = {
      innerEdge: fallbackOuterPlanet.orbitRadius + fallbackOuterPlanet.radius + CONFIG.GRID_SIZE * 70,
      outerEdge: fallbackOuterPlanet.orbitRadius + fallbackOuterPlanet.radius + ASTEROID_BELT_WIDTH * 1.55
    };
    const secondSlot = beltSlots.find(slot => Math.abs(slot.index - firstSlot.index) >= 2) || beltSlots[1] || fallbackSecondSlot;
    const orderedSlots = [firstSlot, secondSlot].sort((a, b) => a.innerEdge - b.innerEdge);

    function makeBelt(slot, count, kind) {
      const center = (slot.innerEdge + slot.outerEdge) / 2;
      const halfWidth = Math.min(ASTEROID_BELT_WIDTH / 2, Math.max(CONFIG.GRID_SIZE * 45, (slot.outerEdge - slot.innerEdge) * 0.36));
      return new AsteroidBelt(star, center - halfWidth, center + halfWidth, count, kind);
    }

    const innerBelt = makeBelt(orderedSlots[0], 90, "inner");
    const outerBelt = makeBelt(orderedSlots[1], 75, "outer");

    solarSystems.push({ star, planets: systemPlanets, innerBelt, outerBelt });
  }

  for (const system of solarSystems) {
    const beltCount = (system.innerBelt?.rocks.length || 0) + (system.outerBelt?.rocks.length || 0);
    spawnAmbientSystemAsteroids(system, Math.max(8, Math.floor(beltCount / 10)));
  }
  spawnAmbientGalaxyAsteroids(Math.max(20, Math.floor(CONFIG.SYSTEM_COUNT * 8)));

  // Player starts near system 0
  const startStar = solarSystems[0].star;
  STAR = startStar; // set global STAR for solar panel calculations
  ship.x = startStar.x + startStar.radius * 4;
  ship.y = startStar.y;
  camera.x = ship.x; camera.y = ship.y;
  buildCamera.x = ship.x; buildCamera.y = ship.y;

  // Free-roaming asteroids near player start
  for (let i = 0; i < WORLD_OBJECTS.ASTEROID_COUNT; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rng() * Math.PI * 2;
      const d = startStar.radius * 4 + rng() * startStar.radius * 14;
      const ax = startStar.x + Math.cos(a) * d;
      const ay = startStar.y + Math.sin(a) * d;
      const ast = new Asteroid(ax, ay);
      if (isInsideCelestialBody(ast.x, ast.y, ast.size + CONFIG.GRID_SIZE * 2)) continue;
      asteroids.push(ast);
      break;
    }
  }

  // Nebula/dust particles for atmosphere
  generateNebula(rng);
  activeWorldRand = Math.random;
}

function generateEndGalaxy(rng) {
  const CX = CONFIG.GALAXY_CENTER_X, CY = CONFIG.GALAXY_CENTER_Y;
  blackHole = null;

  const twinRadius = CONFIG.GRID_SIZE * 380;
  planets.push(
    new EndTwinPlanet(CX, CY, twinRadius, 0, ["#203a78", "#4d78d8", "#c7f2ff"]),
    new EndTwinPlanet(CX, CY, twinRadius, Math.PI, ["#291d58", "#6b44bb", "#e1ccff"])
  );

  const endPlanetKeys = ["metal", "radioactive", "lava", "ice", "gas", "water", "desert"];

  for (let si = 0; si < 4; si++) {
    const angle = (si / 4) * Math.PI * 2 + (rng() - 0.5) * 0.16;
    const dist = CONFIG.GALAXY_RADIUS * (0.62 + rng() * 0.13);
    const sx = CX + Math.cos(angle) * dist;
    const sy = CY + Math.sin(angle) * dist;
    const starRadius = (1700 + rng() * 1000) * CELESTIAL_SIZE_FACTOR;
    const starTypeIdx = Math.floor(rng() * STAR_TYPES.length);

    const star = new GalaxyStar(sx, sy, starRadius, starTypeIdx);
    worldStars.push(star);

    const systemPlanets = [];
    let nextOrbit = starRadius + PLANET_ORBIT_GAP;
    const planetCount = 7 + Math.floor(rng() * 3);

    for (let pi = 0; pi < planetCount; pi++) {
      const typeKey = pi < 3
        ? ["metal", "radioactive", "lava"][Math.floor(rng() * 3)]
        : endPlanetKeys[Math.floor(rng() * endPlanetKeys.length)];
      const def = PLANET_TYPES[typeKey];
      const radius = (def.radius[0] + rng() * (def.radius[1] - def.radius[0])) * CELESTIAL_SIZE_FACTOR * 1.12;
      const orbitDist = nextOrbit + radius + rng() * CONFIG.GRID_SIZE * 90;
      nextOrbit = orbitDist + radius + PLANET_ORBIT_GAP + rng() * CONFIG.GRID_SIZE * 90;
      const planetAngle = rng() * Math.PI * 2;
      const planet = new GalaxyPlanet(
        sx + Math.cos(planetAngle) * orbitDist,
        sy + Math.sin(planetAngle) * orbitDist,
        typeKey,
        radius,
        star
      );
      systemPlanets.push(planet);
      planets.push(planet);
    }

    const sortedPlanets = [...systemPlanets].sort((a, b) => a.orbitRadius - b.orbitRadius);
    const beltA = sortedPlanets[Math.min(2, sortedPlanets.length - 1)];
    const beltB = sortedPlanets[Math.min(5, sortedPlanets.length - 1)];
    const innerBelt = new AsteroidBelt(
      star,
      beltA.orbitRadius + beltA.radius + CONFIG.GRID_SIZE * 55,
      beltA.orbitRadius + beltA.radius + ASTEROID_BELT_WIDTH,
      120,
      "inner"
    );
    const outerBelt = new AsteroidBelt(
      star,
      beltB.orbitRadius + beltB.radius + CONFIG.GRID_SIZE * 65,
      beltB.orbitRadius + beltB.radius + ASTEROID_BELT_WIDTH * 1.3,
      100,
      "outer"
    );

    solarSystems.push({ star, planets: systemPlanets, innerBelt, outerBelt });
  }

  for (const system of solarSystems) {
    const beltCount = (system.innerBelt?.rocks.length || 0) + (system.outerBelt?.rocks.length || 0);
    spawnAmbientSystemAsteroids(system, Math.max(12, Math.floor(beltCount / 10)));
  }
  spawnAmbientGalaxyAsteroids(36);

  const startStar = solarSystems[0].star;
  STAR = startStar;
  ship.x = startStar.x + startStar.radius * 4;
  ship.y = startStar.y;
  camera.x = ship.x; camera.y = ship.y;
  buildCamera.x = ship.x; buildCamera.y = ship.y;

  for (let i = 0; i < WORLD_OBJECTS.ASTEROID_COUNT * 1.4; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const a = rng() * Math.PI * 2;
      const d = startStar.radius * 4 + rng() * startStar.radius * 16;
      const ast = new Asteroid(startStar.x + Math.cos(a) * d, startStar.y + Math.sin(a) * d);
      if (isInsideCelestialBody(ast.x, ast.y, ast.size + CONFIG.GRID_SIZE * 2)) continue;
      asteroids.push(ast);
      break;
    }
  }

  generateNebula(rng);
}

// ── Nebula / background dust ──────────────────────────────────────────────
const nebulaPatches = [];

function generateNebula(rng) {
  const CX = CONFIG.GALAXY_CENTER_X, CY = CONFIG.GALAXY_CENTER_Y;
  const NEBULA_COLORS = ["rgba(80,0,160,", "rgba(0,60,180,", "rgba(160,40,0,", "rgba(0,120,80,", "rgba(100,20,120,"];
  for (let i = 0; i < 120; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * CONFIG.GALAXY_RADIUS * 1.1;
    nebulaPatches.push({
      x: CX + Math.cos(angle) * dist,
      y: CY + Math.sin(angle) * dist,
      r: 3000 + rng() * 18000,
      color: NEBULA_COLORS[Math.floor(rng() * NEBULA_COLORS.length)],
      alpha: 0.03 + rng() * 0.09
    });
  }
}

generateGalaxy(); // builds all solar systems, black hole, asteroid belts

// ── Gravity system ────────────────────────────────────────────────────────
let orbitModeActive = false;
let orbitTarget = null;
let orbitDesiredRadius = 0;
const GRAVITY_RANGE = 40000; // only compute gravity within this distance
const GRAVITY_SCALE = 0.00012;

// ── Velocity Damping (5 % per second, stops below 1 % of max speed) ───────
const VELOCITY_DAMPING_RATE = 0.05; // 5% per second
function applyVelocityDamping(dt) {
  if (buildMode) return;
  if (shouldSkipGravity()) return; // no damping when landed
  if (orbitModeActive) return;     // no damping in orbit
  if (placedModules.some(module => module._thrustActive)) return;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed === 0) return;

  const minSpeed = MAX_SHIP_SPEED * 0.01;
  const dampedSpeed = speed * Math.pow(1 - VELOCITY_DAMPING_RATE, dt);

  if (dampedSpeed < minSpeed) {
    ship.vx = 0;
    ship.vy = 0;
  } else {
    const scale = dampedSpeed / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }
}

function applyGravity(dt) {
  if (buildMode) return;
  if (shouldSkipGravity()) return; // Gravity is disabled while landed.

  // ONLY black hole gravity is applied – stars and planets no longer pull the ship.
  if (blackHole) {
    const dx = blackHole.x - ship.x, dy = blackHole.y - ship.y;
    const dist2 = dx*dx + dy*dy;
    const range = GRAVITY_RANGE * 4;
    if (dist2 < range * range) {
      const dist = Math.sqrt(dist2);
      const strength = blackHole.gravity * GRAVITY_SCALE * 80 * dt / Math.max(dist * 0.001, 1);
      ship.vx += (dx / dist) * strength;
      ship.vy += (dy / dist) * strength;
    }
  }
}

// ── Orbit system ──────────────────────────────────────────────────────────
//
// Two phases:
//   PHASE 1 – AUTOPILOT ("approach" / "circularize"):
//             O is pressed → ship burns fuel to reach a stable circular orbit
//             at getDesiredOrbitRadius(body). Thrusters fire, fuel consumed.
//   PHASE 2 – FREE FLIGHT ("free"):
//             Once in orbit the autopilot cuts engines.  The ship coasts
//             purely under gravity (applyGravity handles all bodies).
//             No fuel consumed.  Other bodies perturb the orbit naturally
//             → ellipses, swingbys, etc.
//
// ─────────────────────────────────────────────────────────────────────────

// ── Orbit system (simplified, no-gravity version) ─────────────────────────
//
// Since planets/stars no longer exert gravity, orbiting is a simple
// "snap to circular path" mechanic:
//   ENTRY  – 'O' pressed → ship burns to reach orbit radius, then locks
//   ORBIT  – ship coasts in a perfect circle, zero fuel consumed
//   EXIT   – 'O' pressed again → ship gets tangential velocity and leaves
//
// The drawn orbit ring matches the radius the ship actually follows.
// ─────────────────────────────────────────────────────────────────────────

const ORBIT_SPEED = 2.0;  // world-units per second along the circle (visual speed)
const ORBIT_APPROACH_ACCEL_FACTOR = 0.006; // how aggressively we close to orbit radius

let orbitPhase = "approach"; // "approach" | "free"
let orbitEllipse = null;     // [{x,y}] – drawn orbit circle points
let _orbitAngle  = 0;        // current angle on the circle (radians)

function updateOrbitMode(dt) {
  if (!orbitModeActive) { orbitEllipse = null; return; }

  // Validate / find orbit target
  if (!orbitTarget || !isOrbitTargetValid(orbitTarget)) {
    orbitTarget = getBestOrbitTarget();
    orbitPhase = "approach";
    orbitEllipse = null;
  }
  if (!orbitTarget) { orbitEllipse = null; return; }

  const body  = orbitTarget;
  const bv    = getOrbitBodyVelocity(body);
  const desiredR = getDesiredOrbitRadius(body);
  orbitDesiredRadius = desiredR;

  // Current relative position to body
  const relX = ship.x - body.x;
  const relY = ship.y - body.y;
  const dist  = Math.max(1, Math.hypot(relX, relY));
  const radialErr = dist - desiredR;

  if (orbitPhase === "approach") {
    // --- APPROACH: fly to orbit radius using thrusters, then snap to free ---
    const nx = relX / dist;
    const ny = relY / dist;
    // Tangential direction (counterclockwise)
    const orbitDir = getOrbitDirection(body);
    const tx = -ny * orbitDir;
    const ty =  nx * orbitDir;

    // Desired tangential speed (a reasonable constant so orbit looks smooth)
    const tangSpeed = Math.max(0.5, Math.min(MAX_SHIP_SPEED * 0.55, desiredR * 0.0008));

    // Target velocity: body-relative radial correction + tangential speed
    const radialCorrect = -radialErr * ORBIT_APPROACH_ACCEL_FACTOR * 60;
    const targetVx = bv.x + nx * radialCorrect + tx * tangSpeed;
    const targetVy = bv.y + ny * radialCorrect + ty * tangSpeed;
    const dvx = targetVx - ship.vx;
    const dvy = targetVy - ship.vy;

    if (Math.hypot(dvx, dvy) > 0.08 && res.fuel > 0) {
      ship.thrustToward(dt, Math.atan2(dvy, dvx));
      // Note: thrustToward already handles fuel consumption, but we want free orbit
      // so refund the fuel (orbit should be free once established).
      // During approach, fuel IS consumed (brief burn to reach orbit).
    }

    // Orient along tangential direction
    ship.rotateToward(dt, Math.atan2(ty, tx) + Math.PI / 2 + SHIP_NOSE_OFFSET, 0.7);

    // Transition to free when close enough
    if (Math.abs(radialErr) < CONFIG.GRID_SIZE * 6 && Math.hypot(dvx, dvy) < 1.2) {
      // Snap to orbit
      _orbitAngle = Math.atan2(relY, relX);
      orbitPhase = "free";
    }

  } else {
    // --- FREE ORBIT: move ship exactly along the circle, zero fuel ---
    const orbitDir = getOrbitDirection(body);
    const tangSpeed = Math.max(0.5, Math.min(MAX_SHIP_SPEED * 0.55, desiredR * 0.0008));
    const angularSpeed = (tangSpeed / desiredR) * orbitDir;
    _orbitAngle += angularSpeed * dt;

    // Pin ship to circle
    ship.x = body.x + Math.cos(_orbitAngle) * desiredR;
    ship.y = body.y + Math.sin(_orbitAngle) * desiredR;

    // Tangential velocity (for realistic exit)
    const tx = -Math.sin(_orbitAngle) * orbitDir;
    const ty =  Math.cos(_orbitAngle) * orbitDir;
    ship.vx = bv.x + tx * tangSpeed;
    ship.vy = bv.y + ty * tangSpeed;

    // Nose along flight direction
    ship.rotateToward(dt, Math.atan2(ty, tx) + Math.PI / 2 + SHIP_NOSE_OFFSET, 0.6);
  }

  // Build the visible orbit circle (refresh every 0.5 s or on phase change)
  ship._orbitPredictTimer = (ship._orbitPredictTimer || 0) - dt;
  if (ship._orbitPredictTimer <= 0) {
    ship._orbitPredictTimer = 0.5;
    const pts = [];
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push({ x: body.x + Math.cos(a) * desiredR, y: body.y + Math.sin(a) * desiredR });
    }
    orbitEllipse = pts;
  }
}

function isOrbitTargetValid(target) {
  return worldStars.includes(target) || planets.includes(target);
}

function getBestOrbitTarget() {
  const selected = selectedFlightTarget || getMouseFlightObject();
  if (selected?.planet && planets.includes(selected.planet)) return selected.planet;
  if (selected?.star && worldStars.includes(selected.star)) return selected.star;

  let nearest = null;
  let nearestDist = Infinity;

  for (const planet of planets) {
    const d = Math.hypot(planet.x - ship.x, planet.y - ship.y);
    if (d < nearestDist) {
      nearest = planet;
      nearestDist = d;
    }
  }

  for (const star of worldStars) {
    const d = Math.hypot(star.x - ship.x, star.y - ship.y);
    if (d < nearestDist) {
      nearest = star;
      nearestDist = d;
    }
  }

  return nearestDist <= GRAVITY_RANGE * 3 ? nearest : null;
}

function getDesiredOrbitRadius(body) {
  const extraTiles = body.type === "star" ? 35 : 14;
  return body.radius + CONFIG.GRID_SIZE * extraTiles;
}

function getCircularOrbitSpeed(body, radius) {
  const gravity = body.gravity || 1;
  const denom = body.type === "star"
    ? Math.max(radius * 0.0005, 1)
    : Math.max(radius * 0.002, 1);
  const accel = gravity * GRAVITY_SCALE * (body.type === "star" ? 1 : 1) / denom;
  const speed = Math.sqrt(Math.max(0, accel * radius));
  return Math.max(0.35, Math.min(MAX_SHIP_SPEED * 0.8, speed));
}

function getOrbitDirection(body) {
  return body.orbitDir || 1;
}

function getOrbitBodyVelocity(body) {
  if (body instanceof GalaxyPlanet && body.star) {
    const tangent = body.orbitAngle + Math.PI / 2;
    const speed = body.orbitRadius * body.orbitSpeed * body.orbitDir;
    return {
      x: Math.cos(tangent) * speed,
      y: Math.sin(tangent) * speed
    };
  }

  if (body instanceof GalaxyStar) {
    const tangent = body.orbitAngle + Math.PI / 2;
    const speed = body.orbitRadius * body.orbitSpeed * body.orbitDir;
    return {
      x: Math.cos(tangent) * speed,
      y: Math.sin(tangent) * speed
    };
  }

  return { x: 0, y: 0 };
}

function getBestLandingTarget() {
  const selected = selectedFlightTarget || getMouseFlightObject();
  if (selected?.planet && planets.includes(selected.planet)) return selected.planet;

  let nearest = null;
  let nearestDist = Infinity;

  for (const planet of planets) {
    const d = Math.hypot(planet.x - ship.x, planet.y - ship.y);
    if (d < nearestDist) {
      nearest = planet;
      nearestDist = d;
    }
  }

  return nearestDist <= GRAVITY_RANGE * 2 ? nearest : null;
}

// updateLandingMode ist jetzt in 09-planet-landing.js implementiert

function getNearestStar() {
  let nearest = null, nd = Infinity;
  for (const star of worldStars) {
    const d = Math.hypot(star.x - ship.x, star.y - ship.y);
    if (d < nd) { nd = d; nearest = star; }
  }
  return nearest;
}

function getSolarEfficiency() {
  const star = getNearestStar();
  if (!star) return 0.05;
  const dist = Math.hypot(star.x - ship.x, star.y - ship.y);
  const maxDist = star.radius * 25;
  return Math.max(0.05, Math.min(1.0, 1 - dist / maxDist));
}

// ── Background drawing ────────────────────────────────────────────────────
function drawGalaxyBackground() {
  // Nebula patches
  for (const patch of nebulaPatches) {
    const p = worldToScreen(patch.x, patch.y);
    const r = patch.r * camera.scale;
    if (p.x < -r || p.x > VIEW.w+r || p.y < -r || p.y > VIEW.h+r) continue;
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, patch.color + patch.alpha + ")");
    grad.addColorStop(1, patch.color + "0)");
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
  }

  // Galaxy dust toward center
  const cp = worldToScreen(CONFIG.GALAXY_CENTER_X, CONFIG.GALAXY_CENTER_Y);
  const gr = CONFIG.GALAXY_RADIUS * camera.scale;
  if (gr > 5) {
    const dustGrad = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, gr);
    dustGrad.addColorStop(0, "rgba(180,100,255,0.12)");
    dustGrad.addColorStop(0.3, "rgba(80,40,160,0.06)");
    dustGrad.addColorStop(0.7, "rgba(40,10,80,0.03)");
    dustGrad.addColorStop(1, "transparent");
    ctx.beginPath(); ctx.arc(cp.x, cp.y, gr, 0, Math.PI*2);
    ctx.fillStyle = dustGrad; ctx.fill();
  }
}

function drawOrbitIndicator() {
  if (!orbitModeActive || !orbitTarget) return;

  const bodyScreen = worldToScreen(orbitTarget.x, orbitTarget.y);
  const desiredR = getDesiredOrbitRadius(orbitTarget);
  const refR = desiredR * camera.scale;

  // Draw the exact orbit circle the ship follows
  ctx.beginPath();
  ctx.arc(bodyScreen.x, bodyScreen.y, refR, 0, Math.PI * 2);
  const orbitColor = orbitPhase === "free"
    ? "rgba(0,220,180,0.55)"
    : "rgba(255,200,60,0.45)";
  ctx.strokeStyle = orbitColor;
  ctx.lineWidth = orbitPhase === "free" ? 2 : 1.5;
  ctx.setLineDash(orbitPhase === "free" ? [] : [6, 8]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Phase label
  if (orbitPhase === "approach") {
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(255,200,60,0.85)";
    ctx.fillText("→ Approaching orbit …", bodyScreen.x + refR * 0.7 + 6, bodyScreen.y - 6);
  }
}
