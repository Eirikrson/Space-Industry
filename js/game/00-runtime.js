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
let audioUnlocked = false;
let menuThrusterSound = null;
const logoImage = new Image();
logoImage.src = "Graphics/Logo.png";

function getSoundVolume(name) {
  return MASTER_SOUND_VOLUME * (SOUND_VOLUMES[name] ?? 1);
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
  updateLoopSound("background", true);
}

function playSound(name, minInterval = 80) {
  if (name !== "mouse") return;

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
  return;

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

function stopAllLoopSounds() {
  for (const name in SOUND_FILES) {
    updateLoopSound(name, false);
  }
  updateMenuThrusterSound(false);
}

function updateMenuThrusterSound(active) {
  if (typeof Audio === "undefined" || !audioUnlocked) return;

  if (!menuThrusterSound) {
    menuThrusterSound = new Audio(SOUND_FILES.thruster);
    menuThrusterSound.loop = true;
    menuThrusterSound.preload = "auto";
  }

  menuThrusterSound.volume = MASTER_SOUND_VOLUME * 0.045;

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
const solarSystems = []; // each: { star, planets, innerBelt, outerBelt, orbitAngle, orbitRadius, orbitSpeed }
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
let flashMsg = "";
let flashUntil = 0;
let rotation = 0;
let turretsActive = false;
let lastTime = performance.now();
let worldPlayTime = 0;
let hoveredInventoryItem = null;
let activeBuildTabId = "power";
let lastBlueprintKey = "";
let appState = "start";
let appWindowFocused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
let appWindowActive = !document.hidden && appWindowFocused;
let currentSaveName = "";
let currentWorldSeed = 0;
let currentWorldSeedLabel = "";
let currentWorldIsEnd = false;
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
const tutorialSeen = new Set();
let saveSelectionMode = null;
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
let matchRotateNose = true;
let recallSmallShips = false;
let shieldsActive = true;
let mapVisible = false;
let mapFocusSystem = null;
let trajectoryVisible = false;
let autoBlueprintRepair = true;
let repairMode = true;
let landingModeActive = false;
let landingTarget = null;
let adminInstantBuild = false;
let researchWindowOpen = false;
let hoveredResearchItem = null;
let assemblerWindowModule = null;
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
