/**
 * 本地开发服务器
 * 功能：静态文件 + API 保存 POI / 路线数据 + 自动 Git 推送
 * 启动：node server.js
 * 端口：8090
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec, execFile } = require("child_process");

const PORT = 8090;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".czml": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function servStatic(req, res) {
  let url = req.url.split("?")[0];
  if (url === "/") url = "/index.html";
  
  const decodedUrl = decodeURIComponent(url);
  let filePath = path.join(ROOT, decodedUrl);

  // If filePath is a directory, append index.html
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch (e) {}

  // Strip project folder prefix if it's a registered project and the file doesn't exist locally
  const parts = decodedUrl.split("/").filter(Boolean);
  if (parts.length > 0) {
    const firstSegment = parts[0];
    const projPath = path.join(ROOT, "projects.json");
    let projects = [];
    if (fs.existsSync(projPath)) {
      try {
        projects = JSON.parse(fs.readFileSync(projPath, "utf-8"));
      } catch (e) {}
    }
    if (projects.includes(firstSegment)) {
      if (!fs.existsSync(filePath)) {
        const rewrittenUrl = "/" + parts.slice(1).join("/");
        filePath = path.join(ROOT, rewrittenUrl);
        // If the rewritten path is a directory, append index.html
        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, "index.html");
          }
        } catch (e) {}
      }
    }
  }

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

/* ---------- 自动 Git 推送（防抖 3 秒）+ 状态追踪 ---------- */
let gitPushTimer = null;
let gitState = { status: "idle", message: "", updatedAt: 0 };

function scheduleGitPush(changedFile) {
  if (gitPushTimer) clearTimeout(gitPushTimer);
  gitState = { status: "pending", message: "3 秒后推送...", updatedAt: Date.now() };
  gitPushTimer = setTimeout(() => {
    const relFile = path.relative(ROOT, changedFile);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    gitState = { status: "pushing", message: "正在推送到 GitHub...", updatedAt: Date.now() };
    console.log("📡 正在推送到 GitHub...");

    // 先 add，再检查是否有 staged 变更，有才 commit+push
    exec(`git -C "${ROOT}" add "${relFile}"`, (addErr) => {
      if (addErr) {
        gitState = { status: "error", message: "git add 失败: " + addErr.message.slice(0, 80), updatedAt: Date.now() };
        console.error("❌ git add 失败:", addErr.message);
        return;
      }
      exec(`git -C "${ROOT}" diff --cached --quiet`, (diffErr) => {
        if (!diffErr) {
          // exit code 0 = 无变更
          gitState = { status: "success", message: "无变更，已是最新", updatedAt: Date.now() };
          console.log("ℹ️  无变更，跳过推送");
          return;
        }
        // 有变更，执行 commit + push
        const commitMsg = `[admin] auto-save: ${relFile} @ ${now}`;
        exec(`git -C "${ROOT}" commit -m "${commitMsg}" && git -C "${ROOT}" push origin main`, (err, stdout, stderr) => {
          if (err) {
            gitState = { status: "error", message: "推送失败: " + (stderr || err.message).slice(0, 80), updatedAt: Date.now() };
            console.error("❌ Git push 失败:", stderr || err.message);
          } else {
            gitState = { status: "success", message: "✅ 已推送到 GitHub", updatedAt: Date.now() };
            console.log("✅ 已推送到 GitHub:\n", stdout.trim());
          }
        });
      });
    });
  }, 3000); // 3 秒防抖
}

function rotateBackups(filePath) {
  if (!fs.existsSync(filePath)) return;
  const maxBackups = 5;
  for (let i = maxBackups - 1; i >= 1; i--) {
    const src = filePath + `.bak.${i}`;
    const dst = filePath + `.bak.${i + 1}`;
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dst);
      } catch (e) {
        console.error(`Backup rotation failed: ${src} -> ${dst}`, e);
      }
    }
  }
  try {
    fs.copyFileSync(filePath, filePath + ".bak.1");
  } catch (e) {
    console.error(`Failed to create backup .bak.1 for ${filePath}`, e);
  }
}

function handleAPI(req, res) {
  let urlPath = req.url.split("?")[0];
  const queryStr = req.url.split("?")[1] || "";
  const params = new URLSearchParams(queryStr);
  const isInner = params.get("route") === "inner";
  let project = "";
  let apiType = ""; // "pois" or "routes"
  
  if (urlPath.endsWith("/api/save-pois")) {
    apiType = "pois";
    project = urlPath.substring(0, urlPath.length - "/api/save-pois".length);
  } else if (urlPath.endsWith("/api/save-routes")) {
    apiType = "routes";
    project = urlPath.substring(0, urlPath.length - "/api/save-routes".length);
  }
  
  if (project.startsWith("/")) {
    project = project.substring(1);
  }
  if (project.endsWith("/")) {
    project = project.substring(0, project.length - 1);
  }

  if (!apiType) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown API" }));
    return;
  }

  const fileName = apiType === "pois" ? "pois.json" : (isInner ? "routes_inner.json" : "routes.json");
  const target = project
    ? path.join(ROOT, project, "data", fileName)
    : path.join(ROOT, "data", fileName);

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      // 验证 JSON 格式
      const data = JSON.parse(body);
      const pretty = JSON.stringify(data, null, 2);

      // 确保父目录存在
      const parentDir = path.dirname(target);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // 备份旧文件并进行版本轮转
      if (fs.existsSync(target)) {
        const legacyBackup = target + ".bak";
        try {
          fs.copyFileSync(target, legacyBackup);
        } catch (e) {}
        rotateBackups(target);
      }

      // 原子性安全写入：先写入临时文件，再重命名覆盖
      const tempPath = target + ".tmp";
      fs.writeFileSync(tempPath, pretty, "utf-8");
      fs.renameSync(tempPath, target);

      console.log(`✅ 已保存 ${path.basename(target)} to ${target} (${pretty.length} bytes)`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, size: pretty.length }));

      // 异步推送，不阻塞响应
      scheduleGitPush(target);
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

  const urlPath = req.url.split("?")[0];

  if (req.method === "POST" && urlPath === "/api/visit") {
    const statsPath = path.join(ROOT, "data", "stats.json");
    let stats = { totalVisits: 0 };
    if (fs.existsSync(statsPath)) {
      try {
        stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
      } catch (e) {
        console.error("读取 stats.json 失败:", e.message);
      }
    }
    stats.totalVisits = (stats.totalVisits || 0) + 1;
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf-8");
    
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ visitCount: stats.totalVisits }));
    return;
  }

  // POST /api/compile-narrative -> Compile YAML DSL to CZML/GeoJSON
  if (req.method === "POST" && (urlPath === "/api/compile-narrative" || urlPath.endsWith("/api/compile-narrative"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const yamlContent = payload.yamlContent;
        if (!yamlContent) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing yamlContent" }));
          return;
        }

        const draftPath = path.join(ROOT, "data", "narrative_draft.yaml");
        fs.writeFileSync(draftPath, yamlContent, "utf-8");

        let projectId = "longmarch_campaign";
        const match = yamlContent.match(/id:\s*["']?([a-zA-Z0-9_-]+)["']?/);
        if (match && match[1]) {
          projectId = match[1];
        }

        const cmd = `python3 -m geonarrative.cli "${draftPath}" -o "${path.join(ROOT, "data", "compiled")}"`;
        exec(cmd, (err, stdout, stderr) => {
          if (err) {
            console.error("Compilation error:", stderr || err.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: stderr || err.message, log: stdout }));
          } else {
            console.log(`✅ Compiled successfully! Project: ${projectId}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              czmlUrl: `/data/compiled/${projectId}.czml`,
              geojsonUrl: `/data/compiled/${projectId}.geojson`
            }));
            
            // Auto git push compiled outputs & draft
            scheduleGitPush(draftPath);
            scheduleGitPush(path.join(ROOT, "data", "compiled", `${projectId}.czml`));
            scheduleGitPush(path.join(ROOT, "data", "compiled", `${projectId}.geojson`));
          }
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/create-project → 创建并初始化新子项目
  if (req.method === "POST" && (urlPath === "/api/create-project" || urlPath.endsWith("/api/create-project"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const projectName = payload.projectName ? payload.projectName.trim().toLowerCase() : "";
        
        if (!projectName || !/^[a-z0-9-_]+$/.test(projectName)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "项目名称无效。只能包含小写字母、数字、连字符和下划线。" }));
          return;
        }

        const projPath = path.join(ROOT, "projects.json");
        let projects = [];
        if (fs.existsSync(projPath)) {
          projects = JSON.parse(fs.readFileSync(projPath, "utf-8"));
        }
        
        if (projects.includes(projectName)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "该项目英文名称已存在。" }));
          return;
        }

        projects.push(projectName);
        fs.writeFileSync(projPath, JSON.stringify(projects, null, 2), "utf-8");

        // 创建子项目目录
        const projectDataDir = path.join(ROOT, projectName, "data");
        fs.mkdirSync(projectDataDir, { recursive: true });

        // 复制默认模版数据文件，或者初始化为空数据
        const defaultRoutes = path.join(ROOT, "data", "routes.json");
        if (!payload.empty && fs.existsSync(defaultRoutes)) {
          fs.copyFileSync(defaultRoutes, path.join(projectDataDir, "routes.json"));
        } else {
          fs.writeFileSync(path.join(projectDataDir, "routes.json"), JSON.stringify({ main: [], secondary: [], main_flight: [] }, null, 2));
        }

        const defaultPois = path.join(ROOT, "data", "pois.json");
        if (!payload.empty && fs.existsSync(defaultPois)) {
          fs.copyFileSync(defaultPois, path.join(projectDataDir, "pois.json"));
        } else {
          fs.writeFileSync(path.join(projectDataDir, "pois.json"), JSON.stringify([], null, 2));
        }

        console.log(`🆕 新子项目已成功创建并初始化: ${projectName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: projectName }));

        scheduleGitPush(projPath);
        scheduleGitPush(path.join(projectDataDir, "routes.json"));
        scheduleGitPush(path.join(projectDataDir, "pois.json"));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/delete-project → 删除子项目并清理目录
  if (req.method === "POST" && (urlPath === "/api/delete-project" || urlPath.endsWith("/api/delete-project"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const projectName = payload.projectName ? payload.projectName.trim().toLowerCase() : "";
        
        if (!projectName) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "项目名称为空。" }));
          return;
        }

        // 禁止删除默认项目
        if (projectName === "" || projectName === "default" || projectName === "默认项目") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "默认项目禁止删除。" }));
          return;
        }

        const projPath = path.join(ROOT, "projects.json");
        let projects = [];
        if (fs.existsSync(projPath)) {
          projects = JSON.parse(fs.readFileSync(projPath, "utf-8"));
        }
        
        const idx = projects.indexOf(projectName);
        if (idx === -1) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "该子项目不存在或已被删除。" }));
          return;
        }

        // 从 projects.json 中移出
        projects.splice(idx, 1);
        fs.writeFileSync(projPath, JSON.stringify(projects, null, 2), "utf-8");

        // 删除子项目物理目录
        const projectDir = path.join(ROOT, projectName);
        if (fs.existsSync(projectDir)) {
          fs.rmSync(projectDir, { recursive: true, force: true });
        }

        console.log(`🗑️ 子项目已成功删除: ${projectName}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, name: projectName }));

        scheduleGitPush(projPath);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/rollback → 回退项目数据至上一保存版本
  if (req.method === "POST" && (urlPath === "/api/rollback" || urlPath.endsWith("/api/rollback"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const projectName = payload.projectName ? payload.projectName.trim().toLowerCase() : "";
        const fileType = payload.fileType || "routes"; // "routes" or "pois"
        const isInner = payload.isInner === true;
        
        const fileName = fileType === "pois" ? "pois.json" : (isInner ? "routes_inner.json" : "routes.json");
        const target = projectName
          ? path.join(ROOT, projectName, "data", fileName)
          : path.join(ROOT, "data", fileName);

        const bakPath = target + ".bak.1";
        if (fs.existsSync(bakPath)) {
          // atomic restore from backup
          const tempPath = target + ".tmp";
          fs.copyFileSync(bakPath, tempPath);
          fs.renameSync(tempPath, target);
          
          // Rotate backups backward (e.g. bak.2 becomes bak.1 etc)
          for (let i = 1; i < 5; i++) {
            const nextBak = target + `.bak.${i + 1}`;
            const curBak = target + `.bak.${i}`;
            if (fs.existsSync(nextBak)) {
              fs.copyFileSync(nextBak, curBak);
            }
          }
          // delete bak.5 if exists
          try { if (fs.existsSync(target + ".bak.5")) fs.rmSync(target + ".bak.5"); } catch (e) {}
          
          console.log(`✅ 已成功回退 ${path.basename(target)} 至本地备份版本`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, source: "backup" }));
          
          scheduleGitPush(target);
          return;
        }
        
        // Git Fallback
        const relFile = path.relative(ROOT, target);
        exec(`git -C "${ROOT}" checkout HEAD~1 -- "${relFile}"`, (gitErr) => {
          if (gitErr) {
            console.error("❌ Git回退失败:", gitErr.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "回退失败：既没有本地备份，Git回退也失败。" }));
          } else {
            console.log(`✅ 已成功通过 Git 回退 ${relFile} 至上一版本`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, source: "git" }));
            
            scheduleGitPush(target);
          }
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/generate-icon → 本地算力生成/处理 POI 立体图标
  if (req.method === "POST" && (urlPath === "/api/generate-icon" || urlPath.endsWith("/api/generate-icon"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const poiId = payload.poiId ? payload.poiId.trim() : "";
        const prompt = payload.prompt ? payload.prompt.trim() : "Tibetan temple icon";
        const bgMode = payload.bgMode ? payload.bgMode.trim() : "black";
        
        // 提取项目名称
        let project = urlPath.substring(0, urlPath.indexOf("/api/generate-icon"));
        if (project.startsWith("/")) project = project.substring(1);
        if (project.endsWith("/")) project = project.substring(0, project.length - 1);

        if (!poiId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing poiId" }));
          return;
        }

        // 拼接输出路径
        const relativeIconPath = project 
          ? `${project}/assets/icons/${poiId}.png`
          : `assets/icons/${poiId}.png`;
        const absoluteIconPath = path.join(ROOT, relativeIconPath);

        // 确保父文件夹存在
        fs.mkdirSync(path.dirname(absoluteIconPath), { recursive: true });

        console.log(`🤖 开始本地算力生成图标. ID: ${poiId}, Prompt: "${prompt}", Path: ${relativeIconPath}`);
        
        execFile("python3", [
          path.join(ROOT, "scripts", "local_ai_helper.py"),
          "--action", "generate-icon",
          "--prompt", prompt,
          "--poi-id", poiId,
          "--bg-mode", bgMode,
          "--output", absoluteIconPath
        ], (err, stdout, stderr) => {
          if (err) {
            console.error("❌ 图标生成失败:", stderr || err.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: stderr || err.message }));
          } else {
            console.log(`✅ 图标生成成功: ${relativeIconPath}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, iconUrl: "/" + relativeIconPath }));
            
            // 异步自动推送 Git
            scheduleGitPush(absoluteIconPath);
          }
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/upload-voice-ref → 接收 Base64 编码的参考音频并保存到本地
  if (req.method === "POST" && (urlPath === "/api/upload-voice-ref" || urlPath.endsWith("/api/upload-voice-ref"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const waypointId = payload.waypointId ? payload.waypointId.trim() : "";
        const fileName = payload.fileName ? payload.fileName.trim() : "";
        const base64Data = payload.base64Data ? payload.base64Data.trim() : "";

        // 提取项目名称
        let project = urlPath.substring(0, urlPath.indexOf("/api/upload-voice-ref"));
        if (project.startsWith("/")) project = project.substring(1);
        if (project.endsWith("/")) project = project.substring(0, project.length - 1);

        if (!waypointId || !fileName || !base64Data) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing waypointId, fileName, or base64Data" }));
          return;
        }

        const ext = path.extname(fileName) || ".wav";
        const relativeRefPath = project
          ? `${project}/media/references/${waypointId}_ref${ext}`
          : `media/references/${waypointId}_ref${ext}`;
        const absoluteRefPath = path.join(ROOT, relativeRefPath);

        // 确保文件夹存在
        fs.mkdirSync(path.dirname(absoluteRefPath), { recursive: true });

        // 解码并保存
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(absoluteRefPath, buffer);

        console.log(`📤 已成功保存参考人声样本. Waypoint: ${waypointId} -> ${relativeRefPath}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          audioUrl: "/" + relativeRefPath
        }));
      } catch (err) {
        console.error("❌ 上传参考人声失败:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/generate-tts → 本地算力合成/克隆航点语音解说
  if (req.method === "POST" && (urlPath === "/api/generate-tts" || urlPath.endsWith("/api/generate-tts"))) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const waypointId = payload.waypointId ? payload.waypointId.trim() : "";
        const text = payload.text ? payload.text.trim() : "";
        const voice = payload.voice ? payload.voice.trim() : "default";
        const refAudio = payload.refAudio ? payload.refAudio.trim() : "";
        const refText = payload.refText ? payload.refText.trim() : "";

        // 提取项目名称
        let project = urlPath.substring(0, urlPath.indexOf("/api/generate-tts"));
        if (project.startsWith("/")) project = project.substring(1);
        if (project.endsWith("/")) project = project.substring(0, project.length - 1);

        if (!waypointId || !text) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing waypointId or text" }));
          return;
        }

        // 拼接输出路径
        const relativeAudioPath = project 
          ? `${project}/media/narratives/${waypointId}.mp3`
          : `media/narratives/${waypointId}.mp3`;
        const absoluteAudioPath = path.join(ROOT, relativeAudioPath);

        // 确保父文件夹存在
        fs.mkdirSync(path.dirname(absoluteAudioPath), { recursive: true });

        console.log(`🤖 开始本地算力合成语音. Waypoint: ${waypointId}, Text: "${text.slice(0, 15)}..."`);

        const execArgs = [
          path.join(ROOT, "scripts", "local_ai_helper.py"),
          "--action", "generate-tts",
          "--text", text,
          "--voice", voice,
          "--output", absoluteAudioPath
        ];

        if (refAudio) {
          const cleanRefAudio = refAudio.startsWith("/") ? refAudio.substring(1) : refAudio;
          const absoluteRefAudio = path.join(ROOT, cleanRefAudio);
          execArgs.push("--ref-audio", absoluteRefAudio);
        }
        if (refText) {
          execArgs.push("--ref-text", refText);
        }

        execFile("python3", execArgs, (err, stdout, stderr) => {
          if (err) {
            console.error("❌ 语音合成失败:", stderr || err.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: stderr || err.message }));
          } else {
            // 解析 python 输出中的 JSON_RESULT
            let result = { success: true, duration: 5.0 };
            const match = stdout.match(/JSON_RESULT:(\{.*\})/);
            if (match) {
              try {
                result = JSON.parse(match[1]);
              } catch (e) {
                console.error("解析 python 结果 JSON 失败:", e);
              }
            }
            
            console.log(`✅ 语音合成成功. Duration: ${result.duration}s -> ${relativeAudioPath}`);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              audioUrl: "/" + relativeAudioPath,
              duration: result.duration
            }));

            // 异步自动推送 Git
            scheduleGitPush(absoluteAudioPath);
          }
        });
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /api/git-status → 返回当前 git push 状态
  if (req.method === "GET" && (urlPath === "/api/git-status" || urlPath.endsWith("/api/git-status"))) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(gitState));
    return;
  }

  if (req.method === "POST" && (urlPath.startsWith("/api/") || urlPath.includes("/api/"))) {
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
