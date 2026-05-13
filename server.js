/**
 * 本地开发服务器
 * 功能：静态文件 + API 保存 POI / 路线数据
 * 启动：node server.js
 * 端口：8090
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8090;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function servStatic(req, res) {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  const filePath = path.join(ROOT, decodeURIComponent(url));

  // 安全检查：不允许访问项目目录外的文件
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function handleAPI(req, res) {
  // POST /api/save-pois  → 写入 data/pois.json
  // POST /api/save-routes → 写入 data/routes.json
  const saveMap = {
    "/api/save-pois": path.join(ROOT, "data", "pois.json"),
    "/api/save-routes": path.join(ROOT, "data", "routes.json"),
  };

  const target = saveMap[req.url];
  if (!target) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown API" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      // 验证 JSON 格式
      const data = JSON.parse(body);
      const pretty = JSON.stringify(data, null, 2);

      // 备份旧文件
      if (fs.existsSync(target)) {
        const backup = target + ".bak";
        fs.copyFileSync(target, backup);
      }

      fs.writeFileSync(target, pretty, "utf-8");
      console.log(`✅ 已保存 ${path.basename(target)} (${pretty.length} bytes)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, size: pretty.length }));
    } catch (err) {
      console.error("保存失败:", err.message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "POST" && req.url.startsWith("/api/")) {
    handleAPI(req, res);
  } else {
    servStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`\n🗻 冈仁波齐转山 · 开发服务器`);
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   http://localhost:${PORT}/admin.html`);
  console.log(`   http://localhost:${PORT}/poi-editor.html`);
  console.log(`\n   API:`);
  console.log(`   POST /api/save-pois   → data/pois.json`);
  console.log(`   POST /api/save-routes → data/routes.json\n`);
});
