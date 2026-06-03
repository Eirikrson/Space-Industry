function getMouseFlightObject() {
  const world = screenToWorld(mouse.x, mouse.y);
  const candidates = [];

  for (const star of worldStars) {
    candidates.push({
      x: star.x,
      y: star.y,
      vx: 0,
      vy: 0,
      radius: star.radius,
      type: "Star",
      star
    });
  }

  for (const planet of planets) {
    candidates.push({
      x: planet.x,
      y: planet.y,
      vx: 0,
      vy: 0,
      radius: planet.radius,
      type: planet.name || "Planet",
      planet
    });
  }

  for (const asteroid of asteroids) {
    candidates.push({
      x: asteroid.x,
      y: asteroid.y,
      vx: asteroid.vx,
      vy: asteroid.vy,
      radius: asteroid.size,
      type: "Asteroid",
      asteroid
    });
  }

  for (const enemy of enemyShips) {
    const computer = enemy.modules.find(module => module.type === "Computer");
    if (!computer) continue;

    const computerWorld = getEnemyModuleWorldCenter(enemy, computer);

    for (const module of enemy.modules) {
      const moduleWorld = getEnemyModuleWorldCenter(enemy, module);
      const moduleRadius = Math.max(module.w || 1, module.h || 1) * CONFIG.GRID_SIZE * 0.65;
      const hoverDistance = Math.hypot(moduleWorld.x - world.x, moduleWorld.y - world.y) - moduleRadius;

      candidates.push({
        x: computerWorld.x,
        y: computerWorld.y,
        vx: enemy.vx,
        vy: enemy.vy,
        radius: Math.max(CONFIG.GRID_SIZE, getEnemyShipRadius(enemy) * 0.25),
        hoverDistance,
        type: "Enemy Ship",
        enemy
      });
    }

    candidates.push({
      x: computerWorld.x,
      y: computerWorld.y,
      vx: enemy.vx,
      vy: enemy.vy,
      radius: getEnemyShipRadius(enemy),
      type: "Enemy Ship",
      enemy
    });
  }

  let best = null;
  let bestDist = Infinity;

  for (const candidate of candidates) {
    const surfaceDist = candidate.hoverDistance !== undefined
      ? candidate.hoverDistance
      : Math.sqrt((candidate.x - world.x) ** 2 + (candidate.y - world.y) ** 2) - candidate.radius;

    if (surfaceDist < bestDist) {
      best = candidate;
      bestDist = surfaceDist;
    }
  }

  return bestDist <= CONFIG.GRID_SIZE * 6 ? best : null;
}

function resolveFlightTarget(target) {
  if (!target) return null;

  if (target.asteroid) {
    if (!asteroids.includes(target.asteroid) || target.asteroid.totalItems <= 0) {
      return null;
    }

    return {
      x: target.asteroid.x,
      y: target.asteroid.y,
      vx: target.asteroid.vx,
      vy: target.asteroid.vy,
      radius: target.asteroid.size,
      type: "Asteroid",
      asteroid: target.asteroid
    };
  }

  if (target.planet) {
    if (!planets.includes(target.planet)) return null;
    return { x: target.planet.x, y: target.planet.y, vx: 0, vy: 0, radius: target.planet.radius, type: target.planet.name || "Planet", planet: target.planet };
  }

  if (target.enemy) {
    if (!enemyShips.includes(target.enemy) || target.enemy._dead) return null;
    const computer = target.enemy.modules.find(module => module.type === "Computer");
    const computerWorld = computer
      ? getEnemyModuleWorldCenter(target.enemy, computer)
      : { x: target.enemy.x, y: target.enemy.y };

    return {
      x: computerWorld.x,
      y: computerWorld.y,
      vx: target.enemy.vx,
      vy: target.enemy.vy,
      radius: getEnemyShipRadius(target.enemy),
      type: "Enemy Ship",
      enemy: target.enemy
    };
  }

  if (target.star) {
    if (!worldStars.includes(target.star)) return null;
    return { x: target.star.x, y: target.star.y, vx: 0, vy: 0, radius: target.star.radius, type: "Star", star: target.star };
  }

  if (target.type === "Star") {
    return { x: STAR.x, y: STAR.y, vx: 0, vy: 0, radius: STAR.radius, type: "Star", star: STAR };
  }

  return target;
}

function getSurfaceGapToTarget(x, y, target) {
  const liveTarget = resolveFlightTarget(target);
  if (!liveTarget) return Infinity;

  const dist = Math.hypot(liveTarget.x - x, liveTarget.y - y);
  return Math.max(0, dist - (liveTarget.radius || 0) - getShipCollisionRadius() * 0.5);
}

function getApproachProfile(target) {
  const type = target.type || "";

  if (type === "Enemy Ship" || target.enemy) {
    // Fast approach but match relative velocity precisely before arrival
    // brakeFactor kept high so ship arrives at exactly enemy velocity
    return { gapTiles: 7, maxSpeed: 10.0, closeSpeed: 0.5, gain: 0.065, brakeFactor: 0.92, matchVelocity: true };
  }

  if (type === "Star") {
    // Very conservative – star is dangerous; brake early and slow
    return { gapTiles: 12, maxSpeed: 6.0, closeSpeed: 0.12, gain: 0.028, brakeFactor: 0.52, matchVelocity: false };
  }

  if (type === "Planet") {
    // Approach quickly, brake firmly so ship does not overshoot
    return { gapTiles: 7, maxSpeed: 7.0, closeSpeed: 0.15, gain: 0.040, brakeFactor: 0.55, matchVelocity: false };
  }

  // Asteroid / generic: fast approach, hard brake
  return { gapTiles: 3.5, maxSpeed: 7.0, closeSpeed: 0.18, gain: 0.048, brakeFactor: 0.52, matchVelocity: false };
}

function getApproachCommandForState(x, y, vx, vy, target) {
  const liveTarget = resolveFlightTarget(target);
  if (!liveTarget) return null;

  const grid = CONFIG.GRID_SIZE;
  const dx = liveTarget.x - x;
  const dy = liveTarget.y - y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) return null;

  const approachX = dx / dist;
  const approachY = dy / dist;
  const targetVx = liveTarget.vx || 0;
  const targetVy = liveTarget.vy || 0;
  const targetRadius = liveTarget.radius || 0;
  const shipRadius = getShipCollisionRadius() * 0.5;
  const profile = getApproachProfile(liveTarget);
  const desiredDistance = targetRadius + shipRadius + profile.gapTiles * grid;

  // For enemies: approach the hold-point but also blend toward matching enemy velocity
  // so that when we arrive we move exactly with the enemy (no fly-by).
  if (profile.matchVelocity) {
    const holdX = liveTarget.x - approachX * desiredDistance;
    const holdY = liveTarget.y - approachY * desiredDistance;
    const errorX = holdX - x;
    const errorY = holdY - y;
    const errorDist = Math.hypot(errorX, errorY);

    // Estimate deceleration capability
    const brakeAccel = Math.max(0.04, ship.getAccelerationToward(Math.atan2(targetVy - vy, targetVx - vx), 1));
    // Distance at which we must start blending to target velocity
    const relVx = vx - targetVx;
    const relVy = vy - targetVy;
    const relSpeed = Math.hypot(relVx, relVy);
    const brakeDistance = (relSpeed * relSpeed) / (2 * Math.max(0.04, brakeAccel));

    // Blend factor: 0 far away, 1 when we should already be matched
    const blend = Math.min(1, errorDist > 0.1 ? brakeDistance / errorDist : 1);

    // Desired approach velocity: move toward hold-point or match target vel
    const errorAngle = errorDist > 0.01 ? Math.atan2(errorY, errorX) : Math.atan2(targetVy - vy, targetVx - vx);
    const safeSpeed = Math.sqrt(Math.max(0, 2 * brakeAccel * errorDist)) * profile.brakeFactor;
    const speedLimit = Math.max(profile.closeSpeed, Math.min(profile.maxSpeed, safeSpeed));
    let approachSpeed = Math.min(speedLimit, errorDist * profile.gain);
    if (errorDist < grid * 0.3) approachSpeed = 0;
    else if (errorDist < grid * 2) approachSpeed = Math.min(approachSpeed, profile.closeSpeed);

    const approachVx = Math.cos(errorAngle) * approachSpeed;
    const approachVy = Math.sin(errorAngle) * approachSpeed;

    // Lerp between approach command and pure velocity match
    return {
      x: targetVx + approachVx * (1 - blend),
      y: targetVy + approachVy * (1 - blend)
    };
  }

  // Non-enemy: physics-aware braking – compute how much stopping distance we need
  // and reduce speed early enough to never overshoot.
  const holdX = liveTarget.x - approachX * desiredDistance;
  const holdY = liveTarget.y - approachY * desiredDistance;
  const errorX = holdX - x;
  const errorY = holdY - y;
  const errorDist = Math.hypot(errorX, errorY);
  const errorAngle = errorDist > 0.01 ? Math.atan2(errorY, errorX) : Math.atan2(targetVy - vy, targetVx - vx);

  // Braking distance estimate based on current speed and decel capability
  const brakeAngle = Math.atan2(targetVy - vy, targetVx - vx);
  const brakeAccel = Math.max(0.04, ship.getAccelerationToward(brakeAngle, 1));

  // Use a more conservative brakeFactor so we stop before the hold point
  const safeSpeed = Math.sqrt(Math.max(0, 2 * brakeAccel * errorDist)) * profile.brakeFactor;
  const speedLimit = Math.max(profile.closeSpeed, Math.min(profile.maxSpeed, safeSpeed));
  let desiredSpeed = Math.min(speedLimit, errorDist * profile.gain);

  if (errorDist < grid * 0.25) {
    desiredSpeed = 0;
  } else if (errorDist < grid * 2.5) {
    desiredSpeed = Math.min(desiredSpeed, profile.closeSpeed);
  }

  return {
    x: targetVx + Math.cos(errorAngle) * desiredSpeed,
    y: targetVy + Math.sin(errorAngle) * desiredSpeed
  };
}

function getThrustVectorForDesiredAngle(desiredAngle, vx, vy, modules = placedModules, shipAngle = ship.angle, scale = 1) {
  const massFactor = getMassAccelerationFactor(modules);
  let ax = 0;
  let ay = 0;

  for (const module of modules) {
    const stats = BUILDING_STATS[module.type];
    if (!stats || !stats.thrust) continue;

    const shipLocalDir = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
    const worldDir = shipLocalDir + shipAngle;
    const diff = Math.abs(normalizeAngle(desiredAngle - worldDir));
    if (diff > Math.PI / 4) continue;

    ax += Math.cos(worldDir) * stats.thrust * scale * 0.12 * massFactor;
    ay += Math.sin(worldDir) * stats.thrust * scale * 0.12 * massFactor;
  }

  if (!canAccelerateWithVelocity(vx, vy, ax, ay)) return { x: 0, y: 0 };
  return { x: ax, y: ay };
}

// Returns the best available thruster local direction for a given key press,
// or null if no thruster maps to that key.
function getBestThrusterLocalDir(keyUp, keyDown, keyLeft, keyRight) {
  let bestDir = null;
  let bestThrust = 0;
  for (const module of placedModules) {
    const stats = BUILDING_STATS[module.type];
    if (!stats || !stats.thrust) continue;
    const shipLocalDir = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
    const up = Math.abs(normalizeAngle(shipLocalDir + Math.PI / 2)) < 0.5;
    const down = Math.abs(normalizeAngle(shipLocalDir - Math.PI / 2)) < 0.5;
    const left = Math.abs(normalizeAngle(shipLocalDir - Math.PI)) < 0.5;
    const right = Math.abs(normalizeAngle(shipLocalDir)) < 0.5;
    const active = (up && keyUp) || (down && keyDown) || (left && keyLeft) || (right && keyRight);
    if (!active) continue;
    if (stats.thrust > bestThrust) {
      bestThrust = stats.thrust;
      bestDir = shipLocalDir;
    }
  }
  return bestDir;
}

function getManualThrustVector(vx, vy, shipAngle = ship.angle) {
  let ax = 0;
  let ay = 0;
  const thrustScale = precisionThrust ? 0.2 : 1;
  const massFactor = getMassAccelerationFactor(placedModules);
  let anyKeyPressed = keys.w || keys.s || keys.q || keys.e;
  let anyThrusterFired = false;

  for (const module of placedModules) {
    const stats = BUILDING_STATS[module.type];
    if (!stats || !stats.thrust) continue;

    const shipLocalDir = stats.thrustDir + (module.rot || 0) * Math.PI / 2;
    const up = Math.abs(normalizeAngle(shipLocalDir + Math.PI / 2)) < 0.5;
    const down = Math.abs(normalizeAngle(shipLocalDir - Math.PI / 2)) < 0.5;
    const left = Math.abs(normalizeAngle(shipLocalDir - Math.PI)) < 0.5;
    const right = Math.abs(normalizeAngle(shipLocalDir)) < 0.5;
    const active = (up && keys.w) || (down && keys.s) || (left && keys.q) || (right && keys.e);
    if (!active) continue;

    const worldDir = shipLocalDir + shipAngle;
    ax += Math.cos(worldDir) * stats.thrust * thrustScale * 0.12 * massFactor;
    ay += Math.sin(worldDir) * stats.thrust * thrustScale * 0.12 * massFactor;
    anyThrusterFired = true;
  }

  // Auto-rotation: if a direction key is pressed but no thruster covers it,
  // rotate the ship so that the best available thruster faces the desired world direction.
  if (anyKeyPressed && !anyThrusterFired) {
    // Determine the desired local direction from key presses
    // W = up (local -Y, angle = -PI/2 from ship nose), S = down, Q = left, E = right
    // In ship-local space: up = -PI/2 relative to ship (nose forward = 0)
    // thrustDir convention: 0 = right, PI/2 = down, PI/-PI = left, -PI/2 = up
    const desiredLocalDir =
      keys.w ? -Math.PI / 2 :
      keys.s ?  Math.PI / 2 :
      keys.q ?  Math.PI     :
                0;           // keys.e = right

    // Find the best thruster local direction available
    const bestLocal = getBestThrusterLocalDir(keys.w, keys.s, keys.q, keys.e) ?? (() => {
      // Fallback: pick the thruster closest to any direction
      let best = null, bestDiff = Infinity;
      for (const module of placedModules) {
        const stats = BUILDING_STATS[module.type];
        if (!stats || !stats.thrust) continue;
        const d = Math.abs(normalizeAngle(stats.thrustDir + (module.rot || 0) * Math.PI / 2 - desiredLocalDir));
        if (d < bestDiff) { bestDiff = d; best = stats.thrustDir + (module.rot || 0) * Math.PI / 2; }
      }
      return best;
    })();

    if (bestLocal !== null) {
      // We want: bestLocal + newShipAngle = desiredLocalDir + currentShipAngle
      // → newShipAngle = currentShipAngle + desiredLocalDir - bestLocal
      const targetAngle = shipAngle + desiredLocalDir - bestLocal;
      const delta = normalizeAngle(targetAngle - ship.angle);
      const rotSpeed = 0.045;
      ship._autoRotating = true;
      ship.angle += Math.max(-rotSpeed, Math.min(rotSpeed, delta));
    }
    return { x: 0, y: 0 };
  }

  ship._autoRotating = anyKeyPressed && anyThrusterFired ? false : ship._autoRotating;
  if (!canAccelerateWithVelocity(vx, vy, ax, ay)) return { x: 0, y: 0 };
  return { x: ax, y: ay };
}

// Approximate gravity acceleration at world position (x, y) for trajectory preview.
// Uses only nearby stars/planets for efficiency (no asteroids).
function getTrajectoryGravityAccel(x, y) {
  let gx = 0, gy = 0;
  const G_SCALE = 0.00008; // tuned so gravity feels right at orbital distances

  for (const star of (typeof worldStars !== "undefined" ? worldStars : [])) {
    const dx = star.x - x;
    const dy = star.y - y;
    const distSq = dx * dx + dy * dy;
    const minDist = star.radius * star.radius;
    if (distSq < minDist) continue;
    const mass = (star.radius || 200) * (star.radius || 200);
    const f = G_SCALE * mass / distSq;
    const dist = Math.sqrt(distSq);
    gx += (dx / dist) * f;
    gy += (dy / dist) * f;
  }

  for (const planet of (typeof planets !== "undefined" ? planets : [])) {
    const dx = planet.x - x;
    const dy = planet.y - y;
    const distSq = dx * dx + dy * dy;
    const minDist = planet.radius * planet.radius;
    if (distSq < minDist) continue;
    // Quick range check – only include planets within 4000 units
    if (distSq > 4000 * 4000) continue;
    const mass = (planet.radius || 60) * (planet.radius || 60) * 0.12;
    const f = G_SCALE * mass / distSq;
    const dist = Math.sqrt(distSq);
    gx += (dx / dist) * f;
    gy += (dy / dist) * f;
  }

  return { x: gx, y: gy };
}

function drawTrajectory() {
  if (buildMode || (!trajectoryVisible && !velocityAssistActive && !keys[" "])) return;

  const points = [];
  let x = ship.x;
  let y = ship.y;
  let vx = ship.vx;
  let vy = ship.vy;
  let simAngle = ship.angle;
  let travelled = 0;
  const target = lockedApproachTarget || selectedFlightTarget;
  const precisionScale = precisionThrust ? 0.2 : 1;

  // Use fewer steps when orbit mode is active (orbit arc is drawn separately)
  const maxSteps = orbitModeActive ? 90 : 200;
  const maxLen = typeof TRAJECTORY_LENGTH !== "undefined" ? TRAJECTORY_LENGTH : 8000;

  points.push(worldToScreen(x, y));

  for (let i = 0; i < maxSteps && travelled < maxLen; i++) {
    let thrust = { x: 0, y: 0 };

    // Only apply manual thrust if no velocity assist is active
    if (!velocityAssistActive && !keys[" "]) {
      thrust = getManualThrustVector(vx, vy, simAngle);
    }

    const liveTarget = resolveFlightTarget(target);

    if ((velocityAssistActive || keys[" "]) && liveTarget) {
      if (matchRotateNose) {
        const noseAngle = Math.atan2(liveTarget.y - y, liveTarget.x - x) + Math.PI / 2 + SHIP_NOSE_OFFSET;
        const turnStep = Math.max(-0.045, Math.min(0.045, normalizeAngle(noseAngle - simAngle)));
        simAngle += turnStep;
      }

      const command = getApproachCommandForState(x, y, vx, vy, liveTarget);
      if (command) {
        const dvx = command.x - vx;
        const dvy = command.y - vy;
        if (Math.hypot(dvx, dvy) > 0.04) {
          thrust = getThrustVectorForDesiredAngle(Math.atan2(dvy, dvx), vx, vy, placedModules, simAngle, precisionScale);
        }
      }
    }

    // Apply gravity (lightweight: only computed every 4 steps for performance)
    if (i % 4 === 0) {
      const grav = getTrajectoryGravityAccel(x, y);
      vx += grav.x * 4;
      vy += grav.y * 4;
    }

    vx += thrust.x;
    vy += thrust.y;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SHIP_SPEED) {
      vx = (vx / speed) * MAX_SHIP_SPEED;
      vy = (vy / speed) * MAX_SHIP_SPEED;
    }

    const beforeX = x;
    const beforeY = y;
    x += vx;
    y += vy;
    travelled += Math.hypot(x - beforeX, y - beforeY);
    points.push(worldToScreen(x, y));
  }

  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = "rgba(70, 180, 255, 0.88)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 7]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(150, 220, 255, 0.95)";
  const end = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
  ctx.fill();

  // Orbit mode: draw the tangential approach arc that connects the trajectory
  // endpoint to the orbit circle of the closest body.
  if (orbitModeActive && typeof orbitTarget !== "undefined" && orbitTarget) {
    const liveOrbit = resolveFlightTarget(orbitTarget);
    if (liveOrbit) {
      const orbitRadius = typeof orbitDesiredRadius !== "undefined" && orbitDesiredRadius > 0
        ? orbitDesiredRadius
        : (liveOrbit.radius || 200) * 1.6;

      // Current ship-to-center vector at end of trajectory
      const endX = x;
      const endY = y;
      const cx = liveOrbit.x;
      const cy = liveOrbit.y;
      const toCenterDist = Math.hypot(cx - endX, cy - endY);

      if (toCenterDist > orbitRadius * 0.5) {
        // Draw the orbit circle (dashed, dimmer)
        const orbitScreenCenter = worldToScreen(cx, cy);
        const orbitScreenR = orbitRadius * camera.scale;

        ctx.strokeStyle = "rgba(80, 200, 255, 0.32)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 10]);
        ctx.beginPath();
        ctx.arc(orbitScreenCenter.x, orbitScreenCenter.y, orbitScreenR, 0, Math.PI * 2);
        ctx.stroke();

        // Draw the approach arc from end-of-trajectory to orbit tangent point
        // Approximate: arc from current angle to tangent angle around the body
        const endAngle = Math.atan2(endY - cy, endX - cx);
        const velAngle = Math.atan2(vy, vx);
        // Determine orbit direction from velocity
        const cross = (endX - cx) * vy - (endY - cy) * vx;
        const ccw = cross > 0;

        // Sweep a short arc (up to half circle) to show approach
        const sweepAngle = Math.min(Math.PI, Math.abs(toCenterDist - orbitRadius) / Math.max(orbitRadius, 1) * Math.PI * 1.5 + 0.6);
        const arcStart = endAngle;
        const arcEnd = ccw ? endAngle + sweepAngle : endAngle - sweepAngle;

        const endScreenPos = worldToScreen(endX, endY);
        ctx.strokeStyle = "rgba(120, 230, 255, 0.65)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.arc(orbitScreenCenter.x, orbitScreenCenter.y, orbitScreenR, arcStart, arcEnd, !ccw);
        ctx.stroke();

        // Label showing target orbit radius
        ctx.setLineDash([]);
        ctx.font = "11px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(120,230,255,0.75)";
        const labelAngle = (arcStart + arcEnd) / 2;
        const labelR = orbitScreenR + 18;
        ctx.fillText(
          `orbit ~${Math.round(orbitRadius / (typeof CONFIG !== "undefined" ? CONFIG.GRID_SIZE : 32))} tiles`,
          orbitScreenCenter.x + Math.cos(labelAngle) * labelR,
          orbitScreenCenter.y + Math.sin(labelAngle) * labelR
        );
      }
    }
  }

  ctx.restore();
}

function shipCanAccelerateToward(worldAngle) {
  const localAngle = normalizeAngle(worldAngle - ship.angle);

  for (const module of placedModules) {
    const stats = BUILDING_STATS[module.type];
    if (!stats || !stats.thrust) continue;

    const thrustDir = normalizeAngle(stats.thrustDir + (module.rot || 0) * Math.PI / 2);
    const diff = Math.abs(normalizeAngle(localAngle - thrustDir));

    if (diff < Math.PI / 4) return true;
  }

  return false;
}

function matchNearestFlightObjectVelocity() {
  if (buildMode) return;

  const target = getMouseFlightObject();
  if (!target) {
    flash("No flight object under mouse");
    return;
  }

  velocityMatchTarget = target;
}

function removeEmptyAsteroids() {
  for (let i = asteroids.length - 1; i >= 0; i--) {
    if (asteroids[i].totalItems <= 0) {
      asteroids.splice(i, 1);
    }
  }
}

function getBeltAtShip() {
  for (const system of solarSystems) {
    for (const belt of [system.innerBelt, system.outerBelt]) {
      if (!belt) continue;
      const dist = Math.hypot(ship.x - belt.star.x, ship.y - belt.star.y);
      if (dist >= belt.innerR && dist <= belt.outerR) {
        return belt;
      }
    }
  }

  return null;
}

function isAsteroidInBelt(asteroid, belt) {
  if (!belt || asteroid._beltStar !== belt.star) return false;
  const dist = Math.hypot(asteroid.x - belt.star.x, asteroid.y - belt.star.y);
  return dist >= belt.innerR && dist <= belt.outerR;
}

function createDynamicBeltAsteroid(belt, maxTiles = 50) {
  const shipEdgeRadius = getShipCollisionRadius();
  const minRadius = shipEdgeRadius + CONFIG.GRID_SIZE * 12;
  const maxRadius = shipEdgeRadius + CONFIG.GRID_SIZE * maxTiles;

  for (let tries = 0; tries < 30; tries++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = minRadius + Math.random() * Math.max(CONFIG.GRID_SIZE, maxRadius - minRadius);
    const x = ship.x + Math.cos(angle) * radius;
    const y = ship.y + Math.sin(angle) * radius;
    const dist = Math.hypot(x - belt.star.x, y - belt.star.y);

    if (dist < belt.innerR || dist > belt.outerR) continue;

    const asteroid = new Asteroid(x, y, belt.kind === "outer" && Math.random() < 0.18 ? "ice" : "rock");
    if (isInsideCelestialBody(asteroid.x, asteroid.y, asteroid.size + CONFIG.GRID_SIZE * 2)) continue;
    asteroid._beltDynamic = true;
    asteroid._beltStar = belt.star;
    asteroid._beltDist = dist;
    asteroid._beltAngle = Math.atan2(y - belt.star.y, x - belt.star.x);
    asteroid._beltOrbitSpeed = (belt.kind === "inner" ? 0.00055 : 0.00022) * (Math.random() < 0.5 ? 1 : -1) * (belt.innerR / Math.max(dist, 1));
    asteroid.size *= belt.kind === "inner" ? 0.9 : 1.1;
    return asteroid;
  }

  return null;
}

function updateDynamicBeltAsteroids() {
  const activeBelt = getBeltAtShip();
  const keepRadius = getShipCollisionRadius() + CONFIG.GRID_SIZE * 50;

  for (let i = asteroids.length - 1; i >= 0; i--) {
    const asteroid = asteroids[i];
    const tooFar = Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y) > keepRadius;
    const wrongBelt = asteroid._beltDynamic && !isAsteroidInBelt(asteroid, activeBelt);
    const insideCelestial = isInsideCelestialBody(asteroid.x, asteroid.y, asteroid.size + CONFIG.GRID_SIZE * 2);

    if (tooFar || wrongBelt || insideCelestial) {
      asteroids.splice(i, 1);
    }
  }

  if (!activeBelt) return;

  const localRadius = keepRadius;
  const targetLocalCount = activeBelt.kind === "inner" ? 5 : 2;
  const localCount = asteroids.filter(asteroid =>
    asteroid._beltDynamic &&
    asteroid.totalItems > 0 &&
    isAsteroidInBelt(asteroid, activeBelt) &&
    Math.hypot(asteroid.x - ship.x, asteroid.y - ship.y) <= localRadius
  ).length;

  for (let i = localCount; i < targetLocalCount; i++) {
    const asteroid = createDynamicBeltAsteroid(activeBelt, 50);
    if (asteroid) asteroids.push(asteroid);
  }
}

function clearAsteroidsNearShip() {
  const clearRadius = CONFIG.GRID_SIZE * 5;
  const com = getCenterOfMass();

  for (let i = asteroids.length - 1; i >= 0; i--) {
    const asteroid = asteroids[i];
    let remove = false;

    for (const module of placedModules) {
      const center = getModuleCenter(module);
      const rel = rotVec(
        (center.x - com.x) * CONFIG.GRID_SIZE,
        (center.y - com.y) * CONFIG.GRID_SIZE,
        ship.angle
      );

      const wx = ship.x + com.x * CONFIG.GRID_SIZE + rel.x;
      const wy = ship.y + com.y * CONFIG.GRID_SIZE + rel.y;
      const dx = asteroid.x - wx;
      const dy = asteroid.y - wy;

      if (Math.sqrt(dx * dx + dy * dy) <= clearRadius + asteroid.size) {
        remove = true;
        break;
      }
    }

    if (remove) asteroids.splice(i, 1);
  }
}
