const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline/promises");

const BOT_DIR = __dirname;

async function chooseMode() {
  if (process.argv.includes("--creative")) return "creative";
  if (process.argv.includes("--survival")) return "survival";

  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    while (true) {
      const answer = (await terminal.question(
        "Modus waehlen: [S] Survival oder [C] Creative: "
      )).trim().toLowerCase();
      if (answer === "s" || answer === "survival") return "survival";
      if (answer === "c" || answer === "creative") return "creative";
      console.log("Bitte S oder C eingeben.");
    }
  } finally {
    terminal.close();
  }
}

function runBot(mode) {
  const script = mode === "creative" ? "creative-bot.js" : "survival-bot.js";
  const forwardedArgs = process.argv.slice(2)
    .filter(arg => arg !== "--creative" && arg !== "--survival");
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
