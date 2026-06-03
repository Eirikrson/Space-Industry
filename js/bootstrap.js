const SPACE_INDUSTRY_DATA_FILES = {
  config: "data/config.json",
  assets: "data/assets.json",
  buildings: "data/buildings.json",
  resources: "data/resources.json",
  celestial: "data/celestial.json",
  enemies: "data/enemies.json",
  texts: "data/texts.json"
};

async function loadSpaceIndustryData() {
  const entries = await Promise.all(Object.entries(SPACE_INDUSTRY_DATA_FILES).map(async ([key, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
    return [key, await response.json()];
  }));
  window.SPACE_INDUSTRY_DATA = Object.fromEntries(entries);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.body.appendChild(script);
  });
}

async function loadGameScripts() {
  await loadScript("js/app.js");
  const parts = await Promise.all(window.SPACE_INDUSTRY_SCRIPT_FILES.map(async src => {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Could not load ${src}: ${response.status}`);
    return `\n// ${src}\n${await response.text()}`;
  }));
  const script = document.createElement("script");
  script.textContent = parts.join("\n");
  document.body.appendChild(script);
}

loadSpaceIndustryData()
  .then(loadGameScripts)
  .catch(error => {
    console.error(error);
    const message = document.createElement("div");
    message.className = "load-error";
    message.textContent = "Space Industry konnte die JSON-Daten nicht laden. Bitte starte das Spiel mit Start-Game.bat.";
    document.body.appendChild(message);
  });

