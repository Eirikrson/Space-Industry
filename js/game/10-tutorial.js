const TUTORIAL_STEPS = [
  {
    id: "move",
    title: "Flight basics",
    body: "Use W, A, S and D to fly.",
    waitFor: "move10"
  },
  {
    id: "strafe",
    title: "Side thrusters",
    body: "If your ship has side thrusters, Q and E let you slide sideways. That helps when docking, mining, and avoiding rocks.",
    waitFor: "ok"
  },
  {
    id: "power",
    title: "Solar power",
    body: "Solar panels produce more energy when you are closer to a star. Far away from stars, your machines and shields can run out of power.",
    waitFor: "ok"
  },
  {
    id: "autopilot",
    title: "Relative flight assist",
    body: "Point at an object and hold Space. The ship matches its relative velocity and returns to the distance it had when the assist started. Against enemies it also turns toward the target. Press R to align the ship nose manually.",
    waitFor: "ok"
  },
  {
    id: "asteroid-danger",
    title: "Careful approach",
    body: "Do not fly into asteroids. They damage your ship. Slow down before you arrive and keep a little distance from the surface.",
    waitFor: "ok"
  },
  {
    id: "orbit",
    title: "Orbit pilot",
    body: "Near a planet or star, press O to use the orbit pilot. It helps you settle into a stable orbit instead of falling into the body.",
    waitFor: "ok"
  },
  {
    id: "landing",
    title: "Landing",
    body: "When orbiting a planet, press L to land. A drill can mine useful items from a landed planet over time.",
    waitFor: "ok"
  },
  {
    id: "build",
    title: "Build menu",
    body: "Press B to open the build menu. Place blueprints, then press B again to commit them. Building consumes items from your inventory.",
    waitFor: "buildOpened",
    triggerOnly: true
  },
  {
    id: "blueprints",
    title: "Automatic blueprints",
    body: "Press N to let the ship automatically place repair blueprints for missing parts. It still needs the required inventory items to build them.",
    waitFor: "ok"
  },
  {
    id: "map",
    title: "Galaxy map",
    body: "Press M to open the map. You can inspect the galaxy and click individual solar systems to focus on their planets and belts.",
    waitFor: "mapOpened"
  },
  {
    id: "map-system-click",
    title: "System focus",
    body: "You can click a solar system with the left mouse button. The map then focuses that system and shows its planets and belts.",
    waitFor: "mapSystemClicked"
  },
  {
    id: "map-return",
    title: "Back to flight",
    body: "Close the map when you are done. New flight tips continue only after you are back in the world.",
    waitFor: "mapClosed",
    triggerOnly: true
  },
  {
    id: "precision",
    title: "Precision thrust",
    body: "Press G for precision thrust. It reduces engine power so small docking, orbit, and mining adjustments are easier.",
    waitFor: "ok"
  }
];

const TUTORIAL_EVENT_STEPS = {
  damage: {
    title: "Damage and crew repairs",
    body: "Your ship can take damage from asteroids, enemies, and dangerous orbits. Add crew modules to increase your people, then press V to repair damaged modules using parts."
  },
  turret: {
    title: "Turrets",
    body: "Turrets defend the ship automatically when they have power and ammunition. Hover a turret to see its range. Click an enemy to make it the priority target, or click a turret to open turret control."
  },
  turretTargeting: {
    title: "Turret target priority",
    body: "The selected enemy is now prioritized by every turret that can reach it. Missile Turrets coordinate automatically, so only one missile at a time is assigned to the same enemy."
  },
  shield: {
    title: "Shields",
    body: "Shield generators can block hits when powered. Press X to toggle shields, and watch your energy reserve."
  },
  hangar: {
    title: "Drones and hangars",
    body: "Hangars let you build and configure drones. Click a hangar to edit its drone, assign cargo limits, and press C to recall drones when needed."
  },
  laboratory: {
    title: "Laboratory",
    body: "Click a Laboratory to open research. Research unlocks buildings, and computer upgrades unlock the next technology tiers."
  },
  fusion: {
    title: "Fusion reactor",
    body: "Fusion reactors can burn different fuels. Click the reactor to choose its mode, then make sure the matching resources are available."
  },
  assembler: {
    title: "Assembler",
    body: "Assemblers craft parts automatically. Click an assembler to set target amounts for items you want it to keep stocked."
  },
  quarters: {
    title: "Quarters",
    body: "Click Quarters to open crew management. More assigned crew helps repair and operate the ship faster."
  },
  crew: {
    title: "Life support and crew",
    body: "Life Support, Farms, and Quarters work together to grow and sustain crew. More crew makes repairs faster."
  },
  endRobotCivilization: {
    title: "Ancient robot civilization",
    body: "A ship has been detected without any human life signs. It appears to belong to an ancient, highly advanced robot civilization. You have entered their galaxy."
  },
  quantumComputer: {
    title: "Black-hole navigation",
    body: ""
  }
};

function shouldBlockSimulationForOverlay() {
  return !!uiDialog || !!tutorialOverlay;
}

function isTutorialFlightUiClear(options = {}) {
  const allowMap = !!options.allowMap;
  return appState === "playing" &&
    !buildMode &&
    !uiDialog &&
    !researchWindowOpen &&
    !assemblerWindowModule &&
    !turretControlWindowOpen &&
    !activeSmallShipEdit &&
    !dysonPanelOpen &&
    (allowMap || !mapVisible);
}

function resetTutorialForNewWorld() {
  localStorage.removeItem(TUTORIAL_SKIP_KEY);
  tutorialSkipped = false;
  tutorialActive = true;
  tutorialOverlay = null;
  tutorialStepIndex = 0;
  tutorialMoveTime = 0;
  tutorialFlightTime = 0;
  tutorialAsteroidsMined = 0;
  tutorialMapTimer = 0;
  tutorialPrecisionTimer = 0;
  tutorialWorldReturnTimer = 0;
  tutorialStepDelayTimer = 0;
  pendingTutorialEvent = null;
  tutorialSeen.clear();
  if (tutorialActive) showTutorialStep(0);
}

function showTutorialStep(index) {
  if (!tutorialActive || tutorialSkipped || index >= TUTORIAL_STEPS.length) {
    tutorialOverlay = null;
    tutorialActive = false;
    return;
  }
  tutorialStepIndex = index;
  tutorialStepDelayTimer = 0;
  const step = TUTORIAL_STEPS[index];
  const allowMap = step.waitFor === "mapSystemClicked" || step.waitFor === "mapClosed";
  tutorialOverlay = step.triggerOnly || !isTutorialFlightUiClear({ allowMap }) ? null : step;
  resetTutorialTypewriter();
}

function advanceTutorial() {
  if (tutorialOverlay && !tutorialTypewriterDone) {
    finishTutorialTypewriter();
    return;
  }

  if (tutorialOverlay?.source === "event") {
    tutorialOverlay = null;
    resetTutorialTypewriter();
    return;
  }

  tutorialOverlay = null;
  resetTutorialTypewriter();
  const current = TUTORIAL_STEPS[tutorialStepIndex];
  if (current && current.waitFor === "ok") {
    tutorialSeen.add(current.id);
    tutorialStepDelayTimer = 0;
    return;
  }
  if (!current || current.waitFor === "ok" || tutorialSeen.has(current.id) || tutorialSeen.has(current.waitFor)) {
    showTutorialStep(tutorialStepIndex + 1);
  }
}

function skipTutorial() {
  tutorialSkipped = true;
  tutorialActive = false;
  tutorialOverlay = null;
  resetTutorialTypewriter();
}

function tutorialEvent(id) {
  if (tutorialSkipped || tutorialSeen.has(id)) return;
  const step = TUTORIAL_EVENT_STEPS[id];
  if (!step) return;
  if (id !== "endRobotCivilization" && !isTutorialFlightUiClear()) {
    pendingTutorialEvent = id;
    return;
  }
  tutorialSeen.add(id);
  tutorialOverlay = { ...step, source: "event", waitFor: "ok" };
  resetTutorialTypewriter();
}

function notifyTutorialModuleBuilt(type) {
  if (isTurretType(type)) tutorialEvent("turret");
  if (type === "Shield Generator") tutorialEvent("shield");
  if (isHangarType(type)) tutorialEvent("hangar");
  if (type === "Laboratory") tutorialEvent("laboratory");
  if (type === "Fusion Reactor") tutorialEvent("fusion");
  if (type === "Assembler") tutorialEvent("assembler");
  if (type === "Quarters") tutorialEvent("quarters");
  if (type === "Life Support" || type === "Farm Module" || type === "Quarters") tutorialEvent("crew");
  if (type === "Quantum Computer") notifyTutorialQuantumComputerBuilt();
}

function notifyTutorialResearch(type) {
  notifyTutorialModuleBuilt(type);
}

function notifyTutorialAsteroidMined() {
  tutorialAsteroidsMined++;
}

function notifyTutorialBuildOpened() {
  if (tutorialSkipped || tutorialSeen.has("buildOpened")) return;
  tutorialSeen.add("buildOpened");
  tutorialStepIndex = Math.max(tutorialStepIndex, 7);
  pendingTutorialEvent = null;
  tutorialOverlay = isTutorialFlightUiClear() ? TUTORIAL_STEPS[7] : null;
  resetTutorialTypewriter();
}

function notifyTutorialMapSystemClicked() {
  tutorialSeen.add("mapSystemClicked");
}

function notifyTutorialActionDone(id) {
  if (!id) return;
  tutorialSeen.add(id);
}

function getPlacedStabilizerCount() {
  return placedModules.filter(module => module.type === "Gravitational Pull Stabilizer" && getModuleHealth(module) > 0).length;
}

function getRequiredStabilizerCount() {
  return 1;
}

function notifyTutorialQuantumComputerBuilt() {
  if (tutorialSkipped || tutorialSeen.has("quantumComputer")) return;
  const have = getPlacedStabilizerCount();
  const need = getRequiredStabilizerCount();
  const ready = getBlackHoleReadiness();
  tutorialSeen.add("quantumComputer");
  tutorialOverlay = {
    ...TUTORIAL_EVENT_STEPS.quantumComputer,
    source: "event",
    body: `Quantum navigation is installed. For black-hole travel you need ${need} Gravitational Pull Stabilizer. Current stabilizers: ${have}/${need}. Event Horizon Shields depend on ship size: ${ready.eventShields}/${ready.requiredShields}. You also need 45000 stored energy.`,
    waitFor: "ok"
  };
  resetTutorialTypewriter();
}

function resetTutorialTypewriter() {
  tutorialTypewriterKey = "";
  tutorialTypewriterTime = 0;
  tutorialTypewriterDone = false;
  drawTutorialOverlay._lastAt = performance.now();
  updateLoopSound("tutorial", false);
}

function finishTutorialTypewriter() {
  if (!tutorialOverlay) return;
  tutorialTypewriterKey = `${tutorialOverlay.title || ""}|${tutorialOverlay.body || ""}`;
  tutorialTypewriterTime = 9999;
  tutorialTypewriterDone = true;
  updateLoopSound("tutorial", false);
}

function getTutorialTypewriterText(fullText) {
  const key = `${tutorialOverlay?.title || ""}|${fullText || ""}`;
  if (tutorialTypewriterKey !== key) {
    tutorialTypewriterKey = key;
    tutorialTypewriterTime = 0;
    tutorialTypewriterDone = false;
  }

  tutorialTypewriterTime += Math.min(0.05, Math.max(0, (performance.now() - (drawTutorialOverlay._lastAt || performance.now())) / 1000));
  drawTutorialOverlay._lastAt = performance.now();

  const charsPerSecond = 34;
  const shown = Math.min(String(fullText || "").length, Math.floor(tutorialTypewriterTime * charsPerSecond));
  tutorialTypewriterDone = shown >= String(fullText || "").length;
  updateLoopSound("tutorial", !tutorialTypewriterDone);
  return String(fullText || "").slice(0, shown);
}

function updateTutorial(dt) {
  if (!tutorialActive || tutorialSkipped || tutorialOverlay || appState !== "playing") return;

  if (pendingTutorialEvent && isTutorialFlightUiClear()) {
    const id = pendingTutorialEvent;
    pendingTutorialEvent = null;
    tutorialEvent(id);
    return;
  }

  if (currentWorldIsEnd) return;

  const step = TUTORIAL_STEPS[tutorialStepIndex];
  if (!step) return;

  const allowMapStep = step.waitFor === "mapSystemClicked" || step.waitFor === "mapClosed" || step.waitFor === "mapOpened";
  if (!isTutorialFlightUiClear({ allowMap: allowMapStep })) return;

  if (step.waitFor === "ok" && tutorialSeen.has(step.id)) {
    if (mapVisible || buildMode) return;
    tutorialStepDelayTimer += dt;
    if (tutorialStepDelayTimer >= 5) showTutorialStep(tutorialStepIndex + 1);
    return;
  }

  if (step.waitFor === "move10") {
    if (mapVisible || buildMode) return;
    if (keys.w || keys.a || keys.s || keys.d) tutorialMoveTime += dt;
    if (tutorialMoveTime >= 10) showTutorialStep(tutorialStepIndex + 1);
    return;
  }

  if (step.waitFor === "buildOpened") {
    if (tutorialSeen.has("buildOpened")) showTutorialStep(tutorialStepIndex + 1);
    else if (buildMode || tutorialAsteroidsMined >= 4) {
      tutorialSeen.add("buildOpened");
      tutorialOverlay = step;
    }
    return;
  }

  if (step.waitFor === "mapOpened") {
    if (tutorialSeen.has("mapOpened") && !mapVisible) {
      showTutorialStep(tutorialStepIndex + 3);
      return;
    }
    if (!mapVisible) return;
    tutorialMapTimer += dt;
    if (tutorialMapTimer >= 2) showTutorialStep(tutorialStepIndex + 1);
    return;
  }

  if (step.waitFor === "mapSystemClicked") {
    if (!mapVisible && tutorialSeen.has("mapOpened")) {
      showTutorialStep(tutorialStepIndex + 2);
      return;
    }
    if (tutorialSeen.has("mapSystemClicked")) showTutorialStep(tutorialStepIndex + 1);
    return;
  }

  if (step.waitFor === "mapClosed") {
    if (mapVisible || buildMode) return;
    tutorialWorldReturnTimer += dt;
    if (tutorialWorldReturnTimer >= 2) showTutorialStep(tutorialStepIndex + 1);
    return;
  }

  if (mapVisible || buildMode) return;
  tutorialFlightTime += dt;
  if (tutorialFlightTime > 60 && tutorialStepIndex < 11) {
    showTutorialStep(11);
  }
  if (tutorialFlightTime > 70 && tutorialStepIndex < 12) {
    showTutorialStep(12);
  }
}

function getTutorialLayout() {
  const w = Math.min(720, VIEW.w - 48);
  const h = Math.min(300, VIEW.h - 48);
  const x = VIEW.w / 2 - w / 2;
  const y = VIEW.h / 2 - h / 2;
  return {
    x, y, w, h,
    skip: { x: x + 24, y: y + h - 58, w: 150, h: 34 },
    ok: { x: x + w - 124, y: y + h - 58, w: 100, h: 34 }
  };
}

function wrapTutorialText(textValue, maxWidth) {
  const words = String(textValue || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawTutorialOverlay() {
  if (!tutorialOverlay) {
    updateLoopSound("tutorial", false);
    return;
  }
  const layout = getTutorialLayout();

  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.fillStyle = "rgba(4, 10, 30, 0.96)";
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
  ctx.strokeStyle = "rgba(100,180,255,0.95)";
  ctx.lineWidth = 2;
  ctx.strokeRect(layout.x, layout.y, layout.w, layout.h);

  ctx.fillStyle = "white";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = "bold 20px Consolas, monospace";
  ctx.fillText(tutorialOverlay.title, layout.x + 28, layout.y + 26);

  ctx.font = "15px Consolas, monospace";
  const visibleBody = getTutorialTypewriterText(tutorialOverlay.body);
  const lines = wrapTutorialText(visibleBody, layout.w - 56);
  let y = layout.y + 68;
  for (const line of lines) {
    ctx.fillText(line, layout.x + 28, y);
    y += 23;
  }

  drawBtn("Skip tutorial", layout.skip.x, layout.skip.y, layout.skip.w, layout.skip.h, false);
  drawBtn("Ok", layout.ok.x, layout.ok.y, layout.ok.w, layout.ok.h, true);
}

function handleTutorialClick(mx, my) {
  if (!tutorialOverlay) return false;
  const layout = getTutorialLayout();
  if (mx >= layout.skip.x && mx <= layout.skip.x + layout.skip.w && my >= layout.skip.y && my <= layout.skip.y + layout.skip.h) {
    skipTutorial();
    return true;
  }
  if (mx >= layout.ok.x && mx <= layout.ok.x + layout.ok.w && my >= layout.ok.y && my <= layout.ok.y + layout.ok.h) {
    advanceTutorial();
    return true;
  }
  return true;
}
