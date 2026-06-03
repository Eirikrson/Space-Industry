const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || 8765);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg"
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const relPath = urlPath === "/" ? "Index.html" : urlPath.split("/").filter(Boolean).join(path.sep);
  const filePath = path.resolve(root, relPath);

  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(res, 404, "Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Space Industry läuft auf http://127.0.0.1:${port}/Index.html`);
  console.log("Dieses Fenster offen lassen, solange du spielst.");
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.log(`Port ${port} ist schon belegt. Öffne http://127.0.0.1:${port}/Index.html`);
    return;
  }
  console.error(error);
});
