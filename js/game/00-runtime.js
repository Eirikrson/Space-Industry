const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const ddOverlay = document.getElementById("dropdown-overlay");
canvas.tabIndex = 0;

const gameData = window.SPACE_INDUSTRY_DATA;
if (!gameData) throw new Error("Space Industry data files were not loaded before app.js.");
const TEXTS = gameData.texts || {};
const unwrapJsonValues = group => Object.fromEntries(Object.entries(group).map(([key, value]) => [
  key,
  value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.value)
    ? value.value
    : value
]));

function text(path, replacements = {}) {
  const value = path.split(".").reduce((current, key) => current && current[key], TEXTS);
  const template = typeof value === "string" ? value : path;
  return template.replace(/\{(\w+)\}/g, (match, key) => replacements[key] ?? match);
}

const {
  AIR,
  CONFIG,
  WORLD_OBJECTS,
  MAX_ASTEROID_DRIFT_SPEED,
  SHIP_NOSE_OFFSET,
  MIN_CAMERA_SCALE,
  MAX_CAMERA_SCALE,
  SAVE_SLOT_COUNT,
  SAVE_KEY_PREFIX,
  AUTOSAVE_KEY,
  SAVE_EXPORT_FORMAT,
  SAVE_EXPORT_KEY
} = unwrapJsonValues(gameData.config);

const MAX_SHIP_SPEED = MAX_ASTEROID_DRIFT_SPEED * 3;
const TRAJECTORY_LENGTH = CONFIG.GRID_SIZE * 15;
const MIN_BUILD_CAMERA_SCALE = MIN_CAMERA_SCALE * 5;

const {
  IMAGE_SPRITES,
  MASTER_SOUND_VOLUME,
  SOUND_VOLUMES,
  SOUND_FILES
} = unwrapJsonValues(gameData.assets);

const {
  INVENTORY,
  BUILD_MENU_TABS,
  BUILDING_STATS,
  COST_RESOURCE_ORDER,
  BASE_UNLOCKED_BUILDINGS,
  BUILD_COSTS,
  RESEARCH_TIERS,
  BUILDING_DESCRIPTIONS
} = unwrapJsonValues(gameData.buildings);

const {
  TANK_COLORS,
  TANK_OPTIONS,
  STARTER_SHIP_MODULES,
  COLLECTOR_SOLID_POOL,
  ASTEROID_RESOURCE_TABLE
} = unwrapJsonValues(gameData.resources);
const INITIAL_RESOURCES = JSON.parse(JSON.stringify(gameData.resources.INITIAL_RESOURCES));
const res = JSON.parse(JSON.stringify(INITIAL_RESOURCES));
const LIQUID_RESOURCES = new Set(unwrapJsonValues(gameData.resources).LIQUID_RESOURCES);
const SOLID_RESOURCES = new Set(unwrapJsonValues(gameData.resources).SOLID_RESOURCES);
const RESOURCE_RATE_KEYS = unwrapJsonValues(gameData.resources).RESOURCE_RATE_KEYS;

const { PLANET_TYPES, STAR_TYPES } = unwrapJsonValues(gameData.celestial);
const { ENEMY_FLEET_DESIGNS } = unwrapJsonValues(gameData.enemies);


const VIEW = {
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: Math.max(1, window.devicePixelRatio || 1)
};

function resizeCanvas() {
  VIEW.w = window.innerWidth;
  VIEW.h = window.innerHeight;
  VIEW.dpr = Math.max(1, window.devicePixelRatio || 1);

  canvas.width = Math.round(VIEW.w * VIEW.dpr);
  canvas.height = Math.round(VIEW.h * VIEW.dpr);
  canvas.style.width = VIEW.w + "px";
  canvas.style.height = VIEW.h + "px";

  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "middle";
}

resizeCanvas();



const loadedImages = {};

const soundCache = {};
const loopSounds = {};
const lastSoundAt = {};
const activeBackgroundSounds = new Set();
const activeLayeredSounds = {};
const nextLayeredSoundAt = {};
let nextBackgroundSoundAt = 0;
const USER_VOLUME_STORAGE_KEY = "spaceIndustry.masterVolume";
const SOUND_OUTPUT_GAIN = 0.25;
const storedUserMasterVolumeRaw = localStorage.getItem(USER_VOLUME_STORAGE_KEY);
const storedUserMasterVolume = Number(storedUserMasterVolumeRaw);
let userMasterVolume = storedUserMasterVolumeRaw !== null && Number.isFinite(storedUserMasterVolume)
  ? Math.max(0, Math.min(1, storedUserMasterVolume))
  : 0.5;
let volumeSliderDragging = false;
let audioUnlocked = false;
let menuThrusterSound = null;
const logoImage = new Image();
logoImage.src = "Graphics/Logo.png";

function getSoundVolume(name) {
  const individualFactor = Math.max(0, Number(SOUND_VOLUMES[name]) || 0);
  return Math.max(0, Math.min(1, MASTER_SOUND_VOLUME * userMasterVolume * SOUND_OUTPUT_GAIN * individualFactor));
}

function setUserMasterVolume(value) {
  userMasterVolume = Math.max(0, Math.min(1, Number(value) || 0));
  localStorage.setItem(USER_VOLUME_STORAGE_KEY, String(userMasterVolume));

  for (const name in soundCache) {
    soundCache[name].volume = getSoundVolume(name);
  }
  for (const audio of activeBackgroundSounds) {
    audio.volume = getSoundVolume("background");
  }
  for (const name in activeLayeredSounds) {
    for (const audio of activeLayeredSounds[name]) {
      audio.volume = Math.max(0, Math.min(1, getSoundVolume(name) * (audio._volumeVariation || 1)));
    }
  }
  if (menuThrusterSound) {
    menuThrusterSound.volume = Math.max(0, Math.min(1, MASTER_SOUND_VOLUME * userMasterVolume * 0.045));
  }
}

function getSound(name) {
  if (typeof Audio === "undefined" || !SOUND_FILES[name]) return null;
  if (!soundCache[name]) {
    const audio = new Audio(SOUND_FILES[name]);
    audio.loop = false;
    audio.volume = getSoundVolume(name);
    audio.preload = "auto";
    soundCache[name] = audio;
  }
  return soundCache[name];
}

function unlockAudio() {
  if (audioUnlocked || typeof Audio === "undefined") return;
  audioUnlocked = true;
  updateBackgroundSound(true);
}

function playSound(name, minInterval = 80) {
  if (buildMode && name !== "mouse") return;
  const now = performance.now();
  if ((lastSoundAt[name] || 0) + minInterval > now) return;
  lastSoundAt[name] = now;

  const base = getSound(name);
  if (!base) return;

  const audio = base.cloneNode();
  audio.loop = false;
  audio.currentTime = 0;
  audio.volume = getSoundVolume(name);
  audio.play().catch(() => {});
}

function updateLoopSound(name, active) {
  const audio = getSound(name);
  if (!audio) return;

  audio.loop = true;
  audio.volume = getSoundVolume(name);

  if (active) {
    if (audio.paused) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    loopSounds[name] = true;
  } else if (loopSounds[name]) {
    audio.pause();
    audio.currentTime = 0;
    loopSounds[name] = false;
  }
}

function stopLayeredSound(name) {
  const sounds = activeLayeredSounds[name];
  if (sounds) {
    for (const audio of sounds) {
      audio.pause();
      audio.currentTime = 0;
    }
    sounds.clear();
  }
  nextLayeredSoundAt[name] = 0;
}

function updateLayeredSound(name, active, restartMs, maxLayers = 2) {
  if (!active || !audioUnlocked || typeof Audio === "undefined" || !SOUND_FILES[name]) {
    stopLayeredSound(name);
    return;
  }

  if (!activeLayeredSounds[name]) activeLayeredSounds[name] = new Set();
  if (activeLayeredSounds[name].size >= maxLayers) return;
  const now = performance.now();
  if ((nextLayeredSoundAt[name] || 0) > now) return;

  const audio = new Audio(SOUND_FILES[name]);
  audio.loop = false;
  audio.preload = "auto";
  audio._volumeVariation = 0.92 + Math.random() * 0.16;
  audio.volume = Math.max(0, Math.min(1, getSoundVolume(name) * audio._volumeVariation));
  activeLayeredSounds[name].add(audio);
  audio.addEventListener("ended", () => activeLayeredSounds[name].delete(audio), { once: true });
  audio.play().catch(() => activeLayeredSounds[name].delete(audio));
  nextLayeredSoundAt[name] = now + restartMs;
}

function updateBackgroundSound(active) {
  if (!active || !audioUnlocked || typeof Audio === "undefined" || !SOUND_FILES.background) {
    for (const audio of activeBackgroundSounds) {
      audio.pause();
      audio.currentTime = 0;
    }
    activeBackgroundSounds.clear();
    nextBackgroundSoundAt = 0;
    return;
  }

  const now = performance.now();
  if (nextBackgroundSoundAt > now) return;

  const audio = new Audio(SOUND_FILES.background);
  audio.loop = false;
  audio.volume = getSoundVolume("background");
  audio.preload = "auto";
  activeBackgroundSounds.add(audio);
  audio.addEventListener("ended", () => activeBackgroundSounds.delete(audio), { once: true });
  audio.play().catch(() => activeBackgroundSounds.delete(audio));

  nextBackgroundSoundAt = now + 5000;
}

function stopAllLoopSounds() {
  for (const name in SOUND_FILES) {
    if (name === "background") continue;
    updateLoopSound(name, false);
  }
  for (const name in activeLayeredSounds) stopLayeredSound(name);
  updateBackgroundSound(false);
  updateMenuThrusterSound(false);
}

function updateMenuThrusterSound(active) {
  if (typeof Audio === "undefined" || !audioUnlocked) return;

  if (!menuThrusterSound) {
    menuThrusterSound = new Audio(SOUND_FILES.thruster);
    menuThrusterSound.loop = true;
    menuThrusterSound.preload = "auto";
  }

  menuThrusterSound.volume = Math.max(0, Math.min(1, MASTER_SOUND_VOLUME * userMasterVolume * 0.045));

  if (active) {
    if (menuThrusterSound.paused) {
      menuThrusterSound.currentTime = 0;
      menuThrusterSound.play().catch(() => {});
    }
  } else if (!menuThrusterSound.paused) {
    menuThrusterSound.pause();
    menuThrusterSound.currentTime = 0;
  }
}

for (const name in IMAGE_SPRITES) {
  const img = new Image();
  img.src = IMAGE_SPRITES[name].src;
  loadedImages[name] = {
    image: img,
    frames: IMAGE_SPRITES[name].frames || 1,
    speed: IMAGE_SPRITES[name].speed || 200
  };
}















const RESEARCH_ITEMS = RESEARCH_TIERS.flatMap(tier => tier.items.map(item => ({ ...item, tier: tier.title })));
const RESEARCH_BY_NAME = Object.fromEntries(RESEARCH_ITEMS.map(item => [item.name, item]));





const resourceRates = {};
let lastResourceSnapshot = null;
let resourceRateTimer = 0;
const resourceRateDelta = {};




// Galaxy is generated after ship is created (needs ship position for start system)
// STAR is set to the player's starting system's star after generation
let STAR = { x: CONFIG.GALAXY_CENTER_X, y: CONFIG.GALAXY_CENTER_Y - 60000, radius: 1800 };
const worldStars = []; // populated by generateGalaxy()
const solarSystems = []; // each: { star, planets, belts, innerBelt, outerBelt, orbitAngle, orbitRadius, orbitSpeed }
let blackHole = null;

let nextModuleId = 1;
let buildMode = false;
let heldItem = AIR;
let mouseDown = false;
let rightMouseDown = false;
let rightMouseDemolishMode = null;
let dragging = false;
let mouse = { x: 0, y: 0 };
let dragStart = { x: 0, y: 0 };
let hoveredGrid = null;
let savedAngle = 0;
let flashMessages = [];
let nextFlashMessageId = 1;
let rotation = 0;
let turretsActive = false;
let lastTime = performance.now();
let worldPlayTime = 0;
let performanceHudFps = 0;
let performanceHudTps = 0;
let performanceHudFrames = 0;
let performanceHudTicks = 0;
let performanceHudWindowStart = performance.now();
let hoveredInventoryItem = null;
let activeBuildTabId = "power";
let lastBlueprintKey = "";
let appState = "start";
let appWindowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
let appWindowActive = !document.hidden && appWindowFocused;
let currentSaveName = "";
let currentSaveSlot = null;
let currentWorldSeed = 0;
let currentWorldSeedLabel = "";
let currentWorldIsEnd = false;
let blackHoleCompleted = localStorage.getItem("spaceIndustryBlackHoleCompleted") === "1";
let dysonPanelOpen = false;
let dysonPanelSystemIndex = -1;
let dysonSpheres = {};
let blackHoleEndingActive = false;
let blackHoleEndingTimer = 0;
let blackHoleEndingResult = null;
let blackHoleEndingReason = "";
let blackHoleResultPlayerName = "";
let enemyShipsDestroyed = 0;
let endRobotDiscoveryShown = false;
let seedDialogOpen = false;
let pendingNewGameSlot = null;
let pendingNewGameName = "";
let pendingSeedInput = "";
let adminSecretInput = "";
let uiDialog = null;
let activeDialogField = 0;
const TUTORIAL_SKIP_KEY = "spaceIndustryTutorialSkipped";
let tutorialSkipped = localStorage.getItem(TUTORIAL_SKIP_KEY) === "1";
let tutorialActive = false;
let tutorialOverlay = null;
let tutorialStepIndex = 0;
let tutorialMoveTime = 0;
let tutorialFlightTime = 0;
let tutorialAsteroidsMined = 0;
let tutorialMapTimer = 0;
let tutorialPrecisionTimer = 0;
let tutorialWorldReturnTimer = 0;
let tutorialStepDelayTimer = 0;
let tutorialTypewriterKey = "";
let tutorialTypewriterTime = 0;
let tutorialTypewriterDone = false;
let pendingTutorialEvent = null;
const tutorialSeen = new Set();
let saveSelectionMode = null;
let quitAfterSavePending = false;
let pendingSavePayload = null;
let pendingSaveName = "";
let pendingOverwriteSlot = null;
let selectedMenuSaveSlot = null;
let lastAutosaveAt = 0;
const saveSlotRects = [];
const statusBadgeRects = [];
let velocityMatchTarget = null;
let selectedFlightTarget = null;
let lockedApproachTarget = null;
let precisionThrust = false;
let importedShipGhost = null;
let precisionBeforeAssist = false;
let velocityAssistActive = false;
let velocityAssistDesiredDistance = null;
let matchRotateNose = true;
let recallSmallShips = false;
let shieldsActive = true;
let mapVisible = false;
let mapFocusSystem = null;
let autoBlueprintRepair = true;
let repairMode = true;
let landingModeActive = false;
let landingTarget = null;
let adminInstantBuild = false;
let researchWindowOpen = false;
let hoveredResearchItem = null;
let assemblerWindowModule = null;
let smelterWindowModule = null;
let electrolyserWindowModule = null;
let fuelProcessorWindowModule = null;
let farmWindowModule = null;
let turretControlWindowOpen = false;
const turretControlRects = [];
const turretTypeEnabled = {};
let turretPriorityEnemyId = null;
let repairTargetModuleId = null;
let nextSmallShipId = 1;
let nextAutoShipNumber = 1;
let activeSmallShipEdit = null;
let motherShipModulesBackup = null;
let hangarFindShipId = null;
let smallShipCargoLimitRects = [];
let highlightedHangarId = null;
let hangarHighlightUntil = 0;
const smallShips = [];
const enemyShips = [];
const combatBullets = [];
const salvageModules = [];
let nextEnemyShipId = 1;
let nextEnemyFleetId = 1;
let nextEnemySpawnAt = performance.now() + 90000;

const buildCamera = { x: 0, y: 0 };
const keys = {};
const unlockedResearch = new Set(BASE_UNLOCKED_BUILDINGS);
const newlyUnlockedResearch = new Set();
const placedModules = [
  { id: nextModuleId++, x: 0, y: 0, type: "Computer", w: 1, h: 1, rot: 0, buildCostPaid: false },
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
    buildCostPaid: false
  }))
];

const blueprints = [];
const demolishSet = new Set();
const asteroids = [];
const planets = [];

let commitPending = false;
let commitStartTime = 0;
let commitSnapshot = null;
let buildWorkSoundUntil = 0;
let nextAutoBlueprintBuildAttemptAt = 0;
