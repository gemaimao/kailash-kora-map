/* 冈仁波齐转山 · MVP
 * 两个核心功能：
 *  1. 沿外转山路线动态推进的朝圣点（基于 KMZ 真实路径）
 *  2. 关键 POI 的气泡窗内容展示
 */

const STATE = {
  pois: [],
  poiById: {},
  routePois: [],          // POI 对象列表（按转山顺序）
  uniqueRoutePois: [],    // 去重后的顺序 POI 列表
  mainRoute: [],          // KMZ 主线坐标 [[lat,lng], ...]
  secondaryRoutes: [],    // KMZ 支线 [{name, coords}, ...]
  segLengths: [],         // 主线每段距离
  totalLength: 0,
  poiProgressMap: {},     // { poiId: progress(0~1) } 每个 POI 在主线上的投影进度
  progress: 0,            // 0 ~ 1
  playing: false,
  rafId: null,
  baseDuration: 300000,   // 基础时长 5 分钟
  speedMultiplier: 1,     // 速度倍率
  autoFollow: true,       // 地图自动跟随朝圣点
  pilgrimMarker: null,
  trailLine: null,        // 已走过的路径线
  poiMarkers: {},
  activePoiId: null,
  lastTriggeredPoiIdx: -1, // 上次触发的 POI 索引
  poiClusters: [],         // [{startIdx, endIdx, ids:[]}] 密集簇
  dwellTimer: null,        // 驻留倒计时
  dwellRemaining: 0,       // 剩余秒数
  dwelling: false,         // 是否正在驻留
  epiloguePois: [],        // 尾声 POI 列表（内圈圣迹）
  epilogueActive: false,   // 尾声动画进行中
  epilogueLines: []        // 尾声连接线
};

/* ---------- 工具函数 ---------- */

function haversine(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 根据 progress(0~1) 在主线上插值，返回当前 latlng 和段索引 */
function progressToLatLng(p) {
  const pts = STATE.mainRoute;
  if (pts.length < 2) return { latlng: pts[0] || [0, 0], segIdx: 0 };
  const target = p * STATE.totalLength;
  let acc = 0;
  for (let i = 0; i < STATE.segLengths.length; i++) {
    const len = STATE.segLengths[i];
    if (acc + len >= target) {
      const t = len === 0 ? 0 : (target - acc) / len;
      const a = pts[i];
      const b = pts[i + 1];
      return {
        latlng: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        segIdx: i,
        segT: t
      };
    }
    acc += len;
  }
  return { latlng: pts[pts.length - 1], segIdx: STATE.segLengths.length - 1, segT: 1 };
}

/** 根据 progress 返回已走过的坐标数组（用于 trail 线） */
function trailCoords(p) {
  const pts = STATE.mainRoute;
  if (pts.length < 2) return [pts[0]];
  const target = p * STATE.totalLength;
  let acc = 0;
  const result = [pts[0]];
  for (let i = 0; i < STATE.segLengths.length; i++) {
    const len = STATE.segLengths[i];
    if (acc + len >= target) {
      const t = len === 0 ? 0 : (target - acc) / len;
      const a = pts[i];
      const b = pts[i + 1];
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      break;
    }
    acc += len;
    result.push(pts[i + 1]);
  }
  return result;
}

/* ---------- 数据加载 ---------- */

async function loadData() {
  const [poisRes, routeRes, basemapRes, routesRes] = await Promise.all([
    fetch("data/pois.json"),
    fetch("data/route.json"),
    fetch("data/basemap.json"),
    fetch("data/routes.json")
  ]);
  const pois = await poisRes.json();
  const route = await routeRes.json();
  STATE.basemap = await basemapRes.json();
  const routesData = await routesRes.json();

  STATE.pois = pois;
  STATE.poiById = Object.fromEntries(pois.map((p) => [p.id, p]));
  STATE.routePois = route.order.map((id) => STATE.poiById[id]).filter(Boolean);

  // 尾声 POI（内圈圣迹，主线结束后单独展示）
  STATE.epiloguePois = (route.epilogue || []).map((id) => STATE.poiById[id]).filter(Boolean);

  // KMZ 真实路径
  STATE.mainRoute = routesData.main;
  STATE.secondaryRoutes = routesData.secondary;

  // 预计算主线段距离
  STATE.segLengths = [];
  STATE.totalLength = 0;
  for (let i = 0; i < STATE.mainRoute.length - 1; i++) {
    const d = haversine(STATE.mainRoute[i], STATE.mainRoute[i + 1]);
    STATE.segLengths.push(d);
    STATE.totalLength += d;
  }

  // 去重顺序 POI
  const seen = new Set();
  STATE.uniqueRoutePois = [];
  STATE.routePois.forEach((poi) => {
    if (!seen.has(poi.id)) {
      seen.add(poi.id);
      STATE.uniqueRoutePois.push(poi);
    }
  });

  // 计算每个 POI 在主线上的投影进度
  STATE.poiProgressMap = {};
  STATE.uniqueRoutePois.forEach((poi) => {
    let bestDist = Infinity;
    let bestProgress = 0;
    let acc = 0;
    for (let i = 0; i < STATE.segLengths.length; i++) {
      const a = STATE.mainRoute[i];
      const b = STATE.mainRoute[i + 1];
      // 检查段端点
      const dA = haversine([poi.lat, poi.lng], a);
      const dB = haversine([poi.lat, poi.lng], b);
      // 投影到线段上的最近点
      const segLen = STATE.segLengths[i];
      if (segLen > 0) {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        let t = ((poi.lat - a[0]) * dx + (poi.lng - a[1]) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        const proj = [a[0] + dx * t, a[1] + dy * t];
        const dP = haversine([poi.lat, poi.lng], proj);
        if (dP < bestDist) {
          bestDist = dP;
          bestProgress = (acc + segLen * t) / STATE.totalLength;
        }
      }
      if (dA < bestDist) { bestDist = dA; bestProgress = acc / STATE.totalLength; }
      if (dB < bestDist) { bestDist = dB; bestProgress = (acc + segLen) / STATE.totalLength; }
      acc += segLen;
    }
    STATE.poiProgressMap[poi.id] = bestProgress;
  });

  // 按进度排序 uniqueRoutePois
  STATE.uniqueRoutePois.sort((a, b) => STATE.poiProgressMap[a.id] - STATE.poiProgressMap[b.id]);

  // 计算密集簇（进度差 < 3% 的连续 POI 归为一簇）
  STATE.poiClusters = [];
  const CLUSTER_GAP = 0.03;
  let ci = 0;
  while (ci < STATE.uniqueRoutePois.length) {
    const cluster = { startIdx: ci, endIdx: ci, ids: [STATE.uniqueRoutePois[ci].id] };
    while (ci + 1 < STATE.uniqueRoutePois.length) {
      const gap = STATE.poiProgressMap[STATE.uniqueRoutePois[ci + 1].id]
                - STATE.poiProgressMap[STATE.uniqueRoutePois[ci].id];
      if (gap < CLUSTER_GAP) {
        ci++;
        cluster.endIdx = ci;
        cluster.ids.push(STATE.uniqueRoutePois[ci].id);
      } else break;
    }
    STATE.poiClusters.push(cluster);
    ci++;
  }
}

/* ---------- 地图 ---------- */

let map;

function initMap() {
  const bm = STATE.basemap;
  const imgBounds = L.latLngBounds(bm.bounds[0], bm.bounds[1]);

  map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
    crs: L.CRS.EPSG3857,
    minZoom: 11,
    maxZoom: 16,
    maxBounds: imgBounds.pad(0.05),
    maxBoundsViscosity: 0.9,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    background: "#0d0d0f"
  }).fitBounds(imgBounds);

  // flex 布局下确保地图尺寸正确
  setTimeout(() => map.invalidateSize(), 200);
  window.addEventListener("resize", () => map.invalidateSize());

  // 瓦片底图
  L.tileLayer("assets/tiles/{z}/{x}/{y}.png", {
    minZoom: 11,
    maxZoom: 16,
    tileSize: 256,
    noWrap: true,
    bounds: imgBounds
  }).addTo(map);

  // 支线（细、暗）
  STATE.secondaryRoutes.forEach((sr) => {
    L.polyline(sr.coords, {
      color: "#8a7050",
      weight: 1.5,
      opacity: 0.45,
      dashArray: "3,5"
    }).addTo(map);
  });

  // 主线底层（全线显示，半透明）
  L.polyline(STATE.mainRoute, {
    color: "#d4a645",
    weight: 2.5,
    opacity: 0.3
  }).addTo(map);

  // 主线已走过的高亮 trail
  STATE.trailLine = L.polyline([], {
    color: "#f0c040",
    weight: 3,
    opacity: 0.95
  }).addTo(map);

  // POI 标记
  STATE.uniqueRoutePois.forEach((poi) => {
    const icon = L.divIcon({
      className: "",
      html: `<div class="poi-marker" data-id="${poi.id}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
    const marker = L.marker([poi.lat, poi.lng], { icon }).addTo(map);
    marker.on("click", () => {
      showPoi(poi.id);
    });
    STATE.poiMarkers[poi.id] = marker;
  });

  // 非主线 POI 标记（内圈圣迹等）
  STATE.pois.forEach((poi) => {
    if (STATE.poiMarkers[poi.id]) return; // 已有标记
    if (!poi.bubble) return; // 跳过空内容
    const icon = L.divIcon({
      className: "",
      html: `<div class="poi-marker offroute" data-id="${poi.id}"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5]
    });
    const marker = L.marker([poi.lat, poi.lng], { icon }).addTo(map);
    marker.on("click", () => showPoi(poi.id));
    STATE.poiMarkers[poi.id] = marker;
  });

  // 朝圣动态标记
  const pilgrimIcon = L.divIcon({
    className: "",
    html: `<div class="pilgrim-marker"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
  STATE.pilgrimMarker = L.marker(STATE.mainRoute[0], {
    icon: pilgrimIcon,
    zIndexOffset: 1000
  }).addTo(map);
}

/* ---------- POI 气泡卡 ---------- */

const card = document.getElementById("poiCard");
const cardName = document.getElementById("cardName");
const cardType = document.getElementById("cardType");
const cardSection = document.getElementById("cardSection");
const cardBubble = document.getElementById("cardBubble");
const cardNote = document.getElementById("cardNote");
const currentPoiName = document.getElementById("currentPoiName");

function showPoi(id) {
  const poi = STATE.poiById[id];
  if (!poi) return;

  // 更新激活标记样式
  if (STATE.activePoiId && STATE.poiMarkers[STATE.activePoiId]) {
    const prev = STATE.poiMarkers[STATE.activePoiId].getElement();
    if (prev) prev.querySelector(".poi-marker")?.classList.remove("active");
  }
  STATE.activePoiId = id;
  const cur = STATE.poiMarkers[id]?.getElement();
  if (cur) cur.querySelector(".poi-marker")?.classList.add("active");

  cardName.textContent = poi.name;
  cardType.textContent = poi.type || "";
  cardSection.textContent = poi.section || "";
  const bubbleText = poi.bubble || "";
  const formattedBubble = bubbleText.split('\n').map(line => {
    const enCount = (line.match(/[a-zA-Z]/g) || []).length;
    const cnCount = (line.match(/[\u4e00-\u9fff]/g) || []).length;
    if (enCount > cnCount * 2 && enCount > 10) {
      return `<span class="en-bubble-line">${line}</span>`;
    }
    return line;
  }).join('\n');
  cardBubble.innerHTML = formattedBubble;
  cardNote.textContent = poi.note ? "简注：" + poi.note : "";

  currentPoiName.textContent = poi.name;

  // 更新辅助信息与密集区提示
  const clusterEl = document.getElementById("poiCluster");
  const dot1 = document.getElementById("metaDot1");
  const dot2 = document.getElementById("metaDot2");
  
  const poiIdx = STATE.uniqueRoutePois.findIndex(p => p.id === id);
  const cluster = STATE.poiClusters.find(c => poiIdx >= c.startIdx && poiIdx <= c.endIdx);
  
  if (cluster && cluster.ids.length > 1) {
    const posInCluster = poiIdx - cluster.startIdx + 1;
    clusterEl.textContent = posInCluster + "/" + cluster.ids.length + " · 密集区";
    if (dot1) dot1.style.display = "inline";
  } else {
    clusterEl.textContent = "";
    if (dot1) dot1.style.display = "none";
  }

  // 如果没有类型或区域，隐藏对应的点
  if (dot2) {
    dot2.style.display = (poi.type && poi.section) ? "inline" : "none";
  }
}

function hidePoi() {
  if (STATE.activePoiId && STATE.poiMarkers[STATE.activePoiId]) {
    const prev = STATE.poiMarkers[STATE.activePoiId].getElement();
    if (prev) prev.querySelector(".poi-marker")?.classList.remove("active");
  }
  STATE.activePoiId = null;
}

/* ---------- 路线动态推进 ---------- */

const progressEl = document.getElementById("progress");
const playBtn = document.getElementById("playBtn");

function updateProgress(p, opts = {}) {
  STATE.progress = Math.max(0, Math.min(1, p));
  const { latlng } = progressToLatLng(STATE.progress);
  STATE.pilgrimMarker.setLatLng(latlng);

  // 更新 trail 线
  STATE.trailLine.setLatLngs(trailCoords(STATE.progress));

  // 同步滑杆
  if (!opts.fromSlider) {
    progressEl.value = String(Math.round(STATE.progress * 1000));
  }

  // 地图自动跟随：当朝圣点接近可视区域边缘时平滑移动
  if (STATE.autoFollow && STATE.playing) {
    const point = map.latLngToContainerPoint(latlng);
    const size = map.getSize();
    const margin = 0.2; // 边缘 20% 触发跟随
    const inX = point.x > size.x * margin && point.x < size.x * (1 - margin);
    const inY = point.y > size.y * margin && point.y < size.y * (1 - margin);
    if (!inX || !inY) {
      map.panTo(latlng, { animate: true, duration: 0.8, easeLinearity: 0.5 });
    }
  }

  // 基于进度触发 POI 气泡 + 驻留策略
  if (!STATE.dwelling) {
    const pois = STATE.uniqueRoutePois;
    for (let i = 0; i < pois.length; i++) {
      const poiP = STATE.poiProgressMap[pois[i].id];
      if (STATE.progress >= poiP && i > STATE.lastTriggeredPoiIdx) {
        STATE.lastTriggeredPoiIdx = i;
        showPoi(pois[i].id);
        // 触发驻留
        if (STATE.playing) {
          const cluster = STATE.poiClusters.find(c => i >= c.startIdx && i <= c.endIdx);
          if (cluster && cluster.ids.length > 1) {
            // 密集簇：暂停，等用户手动翻阅后继续
            startDwell(-1); // -1 表示无限等待，显示"←→ 翻阅 ‣ 继续"
          } else {
            // 稀疏点：按文字长度驻留
            const text = (pois[i].bubble || "") + (pois[i].note || "");
            const secs = Math.max(5, Math.min(15, Math.ceil(text.length * 0.06)));
            startDwell(secs);
          }
        }
        break; // 每次只触发一个
      }
    }
  }
}

function play() {
  if (STATE.playing) return;
  STATE.playing = true;
  playBtn.textContent = "⏸";

  // 如果背景音乐开启且尚未播放，则开始播放（利用播放键作为首次交互触发点）
  const bgm = document.getElementById("bgm");
  if (bgm && window.bgmEnabledByUser !== false && bgm.paused) {
    bgm.play().catch(() => {});
  }

  let last = performance.now();
  const tick = (now) => {
    if (!STATE.playing) return;
    const dt = now - last;
    last = now;
    const effectiveDuration = STATE.baseDuration / STATE.speedMultiplier;
    let p = STATE.progress + dt / effectiveDuration;
    if (p >= 1) {
      p = 1;
      updateProgress(p);
      pause();
      // 再次缩短延迟，几乎无感衔接
      setTimeout(() => {
        if (!STATE.playing) startEpilogue();
      }, 50);
      return;
    }
    updateProgress(p);
    STATE.rafId = requestAnimationFrame(tick);
  };
  STATE.rafId = requestAnimationFrame(tick);
}

function pause() {
  STATE.playing = false;
  playBtn.textContent = "▶";
  if (STATE.rafId) cancelAnimationFrame(STATE.rafId);

  // 不再随图同步暂停背景音乐，保持持续播放
}

playBtn.addEventListener("click", () => {
  hideBlessing();
  if (STATE.epilogueActive) {
    STATE.epilogueActive = false; // 中断尾声
    STATE.epilogueLines.forEach(l => map.removeLayer(l));
    STATE.epilogueLines = [];
  }
  if (STATE.dwelling) endDwell();
  if (STATE.progress >= 1) {
    STATE.lastTriggeredPoiIdx = -1;
    updateProgress(0);
  }
  if (STATE.playing) pause();
  else play();
});

progressEl.addEventListener("input", (e) => {
  if (STATE.playing) pause();
  const p = Number(e.target.value) / 1000;
  // 回滚时重置已触发 POI 索引
  const pois = STATE.uniqueRoutePois;
  STATE.lastTriggeredPoiIdx = -1;
  for (let i = 0; i < pois.length; i++) {
    if (STATE.poiProgressMap[pois[i].id] <= p) STATE.lastTriggeredPoiIdx = i;
  }
  updateProgress(p, { fromSlider: true });
});

/* ---------- 驻留策略 ---------- */

const dwellEl = document.getElementById("poiDwell");

function startDwell(secs) {
  pause();
  STATE.dwelling = true;
  clearInterval(STATE.dwellTimer);
  if (secs < 0) {
    // 密集簇：无限等待，用户翻阅后手动继续
    dwellEl.textContent = "";
  } else {
    STATE.dwellRemaining = secs;
    dwellEl.textContent = "自动继续 " + secs + "s";
    STATE.dwellTimer = setInterval(() => {
      STATE.dwellRemaining--;
      if (STATE.dwellRemaining <= 0) {
        endDwell();
        play();
      } else {
        dwellEl.textContent = "自动继续 " + STATE.dwellRemaining + "s";
      }
    }, 1000);
  }
}

function endDwell() {
  STATE.dwelling = false;
  clearInterval(STATE.dwellTimer);
  dwellEl.textContent = "";
}

/* ---------- 速度控制 ---------- */

const slowerBtn = document.getElementById("slowerBtn");
const fasterBtn = document.getElementById("fasterBtn");
const speedLabel = document.getElementById("speedLabel");
const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
let speedIdx = 2; // 默认 1×

function updateSpeedLabel() {
  STATE.speedMultiplier = SPEED_OPTIONS[speedIdx];
  speedLabel.textContent = SPEED_OPTIONS[speedIdx] + "×";
}

slowerBtn.addEventListener("click", () => {
  if (speedIdx > 0) speedIdx--;
  updateSpeedLabel();
});

fasterBtn.addEventListener("click", () => {
  if (speedIdx < SPEED_OPTIONS.length - 1) speedIdx++;
  updateSpeedLabel();
});

/* ---------- POI 前后导航 ---------- */

const prevPoiBtn = document.getElementById("prevPoiBtn");
const nextPoiBtn = document.getElementById("nextPoiBtn");

function currentPoiIndex() {
  if (!STATE.activePoiId) return -1;
  return STATE.uniqueRoutePois.findIndex(p => p.id === STATE.activePoiId);
}

prevPoiBtn.addEventListener("click", () => {
  if (STATE.dwelling) {
    clearInterval(STATE.dwellTimer); // 用户主动翻阅时停止自动倒计时
    dwellEl.textContent = "";
  }
  const idx = currentPoiIndex();
  const prev = idx > 0 ? idx - 1 : STATE.uniqueRoutePois.length - 1;
  const poi = STATE.uniqueRoutePois[prev];
  showPoi(poi.id);
  map.panTo([poi.lat, poi.lng], { animate: true });
});

nextPoiBtn.addEventListener("click", () => {
  if (STATE.dwelling) {
    clearInterval(STATE.dwellTimer);
    dwellEl.textContent = "";
  }
  const idx = currentPoiIndex();
  const next = idx < STATE.uniqueRoutePois.length - 1 ? idx + 1 : 0;
  const poi = STATE.uniqueRoutePois[next];
  // 如果前进到了更后面的 POI，更新触发索引
  if (next > STATE.lastTriggeredPoiIdx) STATE.lastTriggeredPoiIdx = next;
  showPoi(poi.id);
  map.panTo([poi.lat, poi.lng], { animate: true });
});

/* ---------- TTS 朗读 ---------- */

const ttsBtn = document.getElementById("ttsBtn");
const ttsLang = document.getElementById("ttsLang");
let ttsUtterance = null;

function detectLang(text) {
  if (!text) return { code: "zh-CN", label: "中文" };
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  return cn >= en ? { code: "zh-CN", label: "中文" } : { code: "en-US", label: "English" };
}

function ttsSpeak() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    ttsBtn.classList.remove("speaking");
    ttsBtn.textContent = "🔊";
    return;
  }
  const bubble = document.getElementById("cardBubble").textContent;
  const note = document.getElementById("cardNote").textContent;
  // 提取中文部分：按换行分割，只保留含中文字符的行
  const cnLines = bubble.split("\n").filter(line => /[\u4e00-\u9fff]/.test(line));
  const cnBubble = cnLines.join("\n");
  const text = (cnBubble + "\n" + note).trim();
  if (!text) return;

  const lang = { code: "zh-CN", label: "中文" };
  ttsLang.textContent = lang.label;

  ttsUtterance = new SpeechSynthesisUtterance(text);
  ttsUtterance.lang = lang.code;

  // 尝试寻找更高质量的语音包（如 Tingting, Enhanced, Google 等）
  const voices = window.speechSynthesis.getVoices();
  const zhVoices = voices.filter(v => v.lang.includes("zh") || v.lang.includes("CN"));
  const bestVoice = zhVoices.find(v => v.name.includes("Tingting") || v.name.includes("Enhanced") || v.name.includes("Premium")) 
                 || zhVoices.find(v => v.name.includes("Google"))
                 || zhVoices.find(v => v.name.includes("Microsoft"))
                 || zhVoices[0];
  
  if (bestVoice) ttsUtterance.voice = bestVoice;

  ttsUtterance.rate = 0.95; // 稍微快一点点，显得更自然
  ttsUtterance.pitch = 1.0;
  ttsUtterance.onstart = () => {
    ttsBtn.classList.add("speaking"); ttsBtn.textContent = "⏹";
    if (bgm && window.bgmEnabledByUser !== false) bgm.volume = 0.08;
  };
  ttsUtterance.onend = () => {
    ttsBtn.classList.remove("speaking"); ttsBtn.textContent = "🔊";
    if (bgm && window.bgmEnabledByUser !== false) bgm.volume = 0.3;
  };
  ttsUtterance.onerror = () => {
    ttsBtn.classList.remove("speaking"); ttsBtn.textContent = "🔊";
    if (bgm && window.bgmEnabledByUser !== false) bgm.volume = 0.3;
  };
  window.speechSynthesis.speak(ttsUtterance);
}

if (ttsBtn) ttsBtn.addEventListener("click", ttsSpeak);

/* ---------- 背景音乐 ---------- */

const bgm = document.getElementById("bgm");
const bgmBtn = document.getElementById("bgmBtn");
window.bgmEnabledByUser = true; // 全局状态：用户是否允许播放音乐

if (bgm && bgmBtn) {
  bgm.volume = 0.3;

  bgmBtn.addEventListener("click", () => {
    window.bgmEnabledByUser = !window.bgmEnabledByUser;
    
    if (window.bgmEnabledByUser) {
      bgmBtn.style.opacity = "1";
      bgm.play().catch(() => {});
    } else {
      bgmBtn.style.opacity = "0.4";
      bgm.pause();
    }
  });
}

async function updateVisitCount() {
  const NAMESPACE = "kailash-kora-map-2026"; // 统计命名空间
  const KEY = "visits";
  try {
    // 使用公共的 countapi.xyz (或其镜像)
    // 每次访问 hit 一次
    const res = await fetch(`https://api.countapi.xyz/hit/${NAMESPACE}/${KEY}`);
    const data = await res.json();
    if (data.value) {
      document.getElementById("visitCount").textContent = data.value;
    }
  } catch (err) {
    console.warn("公共计数器不可用，尝试备用方案:", err);
    // 备用方案：如果公共 API 挂了，尝试本地 API（万一是在本地运行）
    try {
      const res = await fetch("/api/visit", { method: "POST" });
      const data = await res.json();
      if (data.visitCount) {
        document.getElementById("visitCount").textContent = data.visitCount;
      }
    } catch (localErr) {
      document.getElementById("visitorCounter").style.display = "none";
    }
  }
}

/* ---------- 启动 ---------- */

(async function main() {
  try {
    updateVisitCount(); // 异步更新访客数
    await loadData();
    initMap();
    updateProgress(0);
    showPoi("tarchen");
  } catch (err) {
    console.error(err);
    alert("数据加载失败：" + err.message);
  }
})();

/* ---------- 尾声动画 ---------- */

async function startEpilogue() {
  console.log("EPILOGUE: Starting sequence. POIs count:", STATE.epiloguePois.length);
  if (!STATE.epiloguePois || STATE.epiloguePois.length === 0) {
    showBlessing();
    return;
  }

  STATE.epilogueActive = true;
  currentPoiName.textContent = "内圈圣迹巡礼：启动中...";
  STATE.epilogueLines = [];
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  // 记录上一个位置，默认为朝圣者当前位置
  let lastPos = STATE.pilgrimMarker.getLatLng();

  for (const poi of STATE.epiloguePois) {
    if (!STATE.epilogueActive) return;

    await delay(200); // 极短等待，几乎立刻出发
    if (!STATE.epilogueActive) return;

    // 画虚线连接：从上一个点连到当前内圈点
    const line = L.polyline(
      [[lastPos.lat, lastPos.lng], [poi.lat, poi.lng]],
      { color: "#ff8844", weight: 2, opacity: 0.6, dashArray: "6,10" }
    ).addTo(map);
    STATE.epilogueLines.push(line);

    // 飞向 POI
    map.flyTo([poi.lat, poi.lng], 14.5, { duration: 3, easeLinearity: 0.25 });
    await delay(3500);
    if (!STATE.epilogueActive) return;

    // 展示气泡
    showPoi(poi.id);
    
    lastPos = L.latLng(poi.lat, poi.lng); // 更新位置

    // 根据内容长度等待
    const text = (poi.bubble || "") + (poi.note || "");
    const readTime = Math.max(5000, Math.min(10000, text.length * 20));
    await delay(readTime);
  }

  if (!STATE.epilogueActive) return;

  // 清除所有连接虚线
  STATE.epilogueLines.forEach(l => map.removeLayer(l));
  STATE.epilogueLines = [];

  // 最终定格：几乎不等待，直接平滑回归
  await delay(500);
  if (!STATE.epilogueActive) return;

  // 冈仁波齐中心坐标 (约 31.066, 81.312)
  map.flyTo([31.066, 81.312], 12.5, { duration: 4 });
  await delay(4500);

  currentPoiName.textContent = "冈仁波齐";
  showBlessing();
  STATE.epilogueActive = false;
}

function showBlessing() {
  const overlay = document.getElementById("epilogueOverlay");
  if (overlay) overlay.classList.add("visible");
}

function hideBlessing() {
  const overlay = document.getElementById("epilogueOverlay");
  if (overlay) {
    overlay.classList.remove("visible");
    const year = overlay.querySelector(".blessing-year");
    const wish = overlay.querySelector(".blessing-wish");
    const credit = overlay.querySelector(".blessing-credit");
    if (year) { year.style.animation = "none"; year.offsetHeight; year.style.animation = ""; }
    if (wish) { wish.style.animation = "none"; wish.offsetHeight; wish.style.animation = ""; }
    if (credit) { credit.style.animation = "none"; credit.offsetHeight; credit.style.animation = ""; }
  }
}

/* ---------- 赞赏弹窗 ---------- */

(function initTipModal() {
  const openBtn = document.getElementById("tipOpenBtn");
  const modal = document.getElementById("tipModal");
  if (!openBtn || !modal) return;

  openBtn.addEventListener("click", () => modal.classList.add("open"));
  modal.addEventListener("click", () => {
    modal.classList.remove("open");
  });
})();
