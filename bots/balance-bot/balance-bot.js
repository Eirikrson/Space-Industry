const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline/promises");

const BOT_DIR = __dirname;

async function chooseMode() {
  if (process.argv.includes("--creative")) return "creative";
  if (process.argv.includes("--survival")) return "survival";
  if (process.argv.includes("--meta")) return "meta";

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    while (true) {
      const answer = (await terminal.question(
        "Modus waehlen: [S] Survival, [C] Creative oder [M] Meta: "
      )).trim().toLowerCase();
      if (answer === "s" || answer === "survival") return "survival";
      if (answer === "c" || answer === "creative") return "creative";
      if (answer === "m" || answer === "meta") return "meta";
      console.log("Bitte S, C oder M eingeben.");
    }
  } finally {
    terminal.close();
  }
}

function runBot(mode) {
  const scripts = {
    creative: "creative-bot.js",
    survival: "survival-bot.js",
    meta: "meta-bot.js"
  };
  const script = scripts[mode];
  const forwardedArgs = process.argv.slice(2)
    .filter(arg => !["--creative", "--survival", "--meta"].includes(arg));
  const child = spawn(process.execPath, [path.join(BOT_DIR, script), ...forwardedArgs], {
    cwd: path.resolve(BOT_DIR, "..", ".."),
    stdio: "inherit",
    env: process.env
  });
  child.on("error", error => {
    console.error(`Der ${mode}-Bot konnte nicht gestartet werden:`, error);
    process.exitCode = 1;
  });
  child.on("exit", code => {
    process.exitCode = code ?? 1;
  });
}

chooseMode()
  .then(runBot)
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
