// 初始化 Cesium
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhZDY0YWY3Yy1mZmQ1LTQ2MjgtYTRjZi01OTM0NzQ3YjljOGMiLCJpZCI6NDM2NzA2LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzk4MDU4MjZ9.80efk41binldWGgit3mGqqZ3keritykzZUoNw0qoQc0';

const viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,       // 关闭原生动画栏
    timeline: false,        // 关闭原生时间线
    baseLayerPicker: false, 
    fullscreenButton: false,
    geocoder: false,        
    homeButton: false,      
    infoBox: true,          // 开启原生信息框 (点击POI出现摄像头跟踪)
    sceneModePicker: false, 
    selectionIndicator: true, // 开启原生点击绿框
    navigationHelpButton: false 
});

// 监听 POI 选中事件，如果 POI 包含自定义 3D 相机视角则自动飞往该视角
viewer.selectedEntityChanged.addEventListener(function(selectedEntity) {
    if (Cesium.defined(selectedEntity) && selectedEntity.id && selectedEntity.id.startsWith('poi_')) {
        const id = selectedEntity.id.replace('poi_', '');
        const poi = allPoisData.find(p => p.id === id);
        if (poi && typeof poi.camLng === 'number' && typeof poi.camLat === 'number' && typeof poi.camHeight === 'number') {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(poi.camLng, poi.camLat, poi.camHeight),
                orientation: {
                    heading: Cesium.Math.toRadians(typeof poi.heading === 'number' ? poi.heading : 0.0),
                    pitch: Cesium.Math.toRadians(typeof poi.pitch === 'number' ? poi.pitch : -35.0),
                    roll: Cesium.Math.toRadians(typeof poi.roll === 'number' ? poi.roll : 0.0)
                },
                duration: 2.0
            });
        }
    }
});

// 默认开启抗锯齿
viewer.scene.postProcessStages.fxaa.enabled = true;
// 开启深度测试，防止山体背后的图标透视穿模
viewer.scene.globe.depthTestAgainstTerrain = true;

// 全局飞行状态控制
let isPlaying = false;
let flightPath = [];
let fullRoute = [];
let fullRoutePositions = [];
let currentWaypoint = 0;
let currentSegmentStartTime = 0;
let currentSegmentDuration = 0;
let currentSegmentStartIdx = 0;
let currentSegmentEndIdx = 0;
const SMOOTH_FACTOR = 5;
let allPoisData = []; // 全局存储 POI 数据，用于雷达测距
let nearbyPois = [];  // 当前进入雷达探测范围的所有 POI
let currentNearbyIndex = 0; // 当前正在展示的 POI 索引
const poiPopups = []; // 存储气泡弹窗以防 ReferenceError

// 手动校准偏差（新版KML已贴地，无需偏移）
const OFFSET_LNG = 0.0;
const OFFSET_LAT = 0.0;

// 提前拉取数据
fetch('../data/routes.json').then(r => r.json()).then(data => {
    flightPath = data.main_flight || [];
    fullRoute = data.main || []; 
    
    // 直接使用原始的真实地理坐标（新版数据为 [lng, lat] 格式）
    const rawPositions = fullRoute.map(pt => {
        return Cesium.Cartesian3.fromDegrees(pt[0] + OFFSET_LNG, pt[1] + OFFSET_LAT);
    });
    
    // 新版 KML 路线已经高达 12500+ 个点，无需再进行 CatmullRomSpline 平滑插值
    // 直接使用原始高精度坐标点，并避免因为坐标点重复导致 Cesium 底层报错
    fullRoutePositions = rawPositions;
    
    // 1. 全局路线底色 (使用 clampToGround 完美贴合地形起伏，始终完全显示以展示整体路线)
    viewer.entities.add({
        name: 'Kailash Kora Route',
        polyline: {
            positions: rawPositions,
            width: 4,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.1,
                color: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.4) // 半透明底色光晕
            }),
            clampToGround: true
        }
    });

    // 2. 动态飞行轨迹（完美丝滑版，随漫游实时生长）
    let progressPositions = [];
    viewer.entities.add({
        name: 'Kora Route Progress',
        polyline: {
            positions: new Cesium.CallbackProperty(() => {
                if (!isPlaying || currentSegmentDuration === 0) {
                    return progressPositions.length >= 2 ? progressPositions : undefined;
                }
                
                const now = Date.now();
                let progress = (now - currentSegmentStartTime) / currentSegmentDuration;
                if (progress > 1.0) progress = 1.0;
                
                // 修复：移除遗留的 SMOOTH_FACTOR 乘数，与漫游实际索引精细对齐，防止绘制提前或超限
                const exactIdx = Math.floor(currentSegmentStartIdx + (currentSegmentEndIdx - currentSegmentStartIdx) * progress);
                
                const newPositions = fullRoutePositions.slice(0, exactIdx + 1);
                if (newPositions.length >= 2) {
                    progressPositions = newPositions;
                }
                return progressPositions.length >= 2 ? progressPositions : undefined;
            }, false),
            width: 8,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.3,
                color: Cesium.Color.fromCssColorString('#f59e0b') // 实体明黄光晕进度线
            }),
            clampToGround: true
        }
    });
});

// =========================================================
// 安全初始化地形，然后绘制神山所有的 POI 地标
// =========================================================
// 内存中生成一个漂亮的金色圆形地标点（用于传统扁平POI）
function createDefaultMarkerCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    
    // 阴影发光效果
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    
    // 白色外边圈
    ctx.beginPath();
    ctx.arc(12, 12, 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    
    // 金黄色核心点
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(12, 12, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffcd55';
    ctx.fill();
    
    return canvas;
}

/**
 * 动态拼接 SVG 战术异形路牌并返回 Data URL
 * @param {string} name 地标名称（如 "马鞍石"）
 * @param {string} type 语义类型（如 "自然奇观"）
 * @param {string} innerIconSvg 核心语义图形（SVG 路径字符串）
 * @param {string} themeColor 主题发光颜色
 */
function generateRoadSignBillboard(name, type, innerIconSvg, themeColor = "#f59e0b") {
    const width = 140;
    const height = 64;
    
    // 异形盾牌路牌外观的 SVG Path
    const pathD = "M 12 0 " +
                  "L 128 0 " +
                  "C 134 0, 140 6, 140 12 " +
                  "L 140 44 " +
                  "C 140 50, 134 56, 128 56 " +
                  "L 78 56 " +
                  "L 70 64 " +  // 下方指示尖角
                  "L 62 56 " +
                  "L 12 56 " +
                  "C 6 56, 0 50, 0 44 " +
                  "L 0 12 " +
                  "C 0 6, 6 0, 12 0 Z";

    // 纯代码拼接 SVG，包含阴影、渐变、文字排版与左侧图标嵌入
    const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" flood-opacity="0.5" flood-color="#000000"/>
        </filter>
        
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b" stop-opacity="0.95" />
            <stop offset="100%" stop-color="#0f172a" stop-opacity="0.95" />
        </linearGradient>

        <g filter="url(#shadow)">
            <path d="${pathD}" fill="url(#bgGrad)" stroke="${themeColor}" stroke-width="1.5"/>
        </g>
        
        <!-- 左侧核心语义图形容器 (展示马鞍、马头等图形) -->
        <g transform="translate(12, 14)" stroke="${themeColor}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            ${innerIconSvg}
        </g>
        
        <!-- 右侧文本排版 -->
        <text x="44" y="24" font-family="'PingFang SC', -apple-system, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">${name}</text>
        <text x="44" y="40" font-family="'PingFang SC', -apple-system, sans-serif" font-size="9" font-weight="bold" fill="${themeColor}" letter-spacing="1">${type.toUpperCase()}</text>
    </svg>`;

    // 将 SVG 字符串安全转换为 Base64 格式的 Data URL
    const utf8Bytes = encodeURIComponent(svgString).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode('0x' + p1);
    });
    return 'data:image/svg+xml;base64,' + btoa(utf8Bytes);
}

function loadPoisAndStart(terrainProvider) {
    if (terrainProvider) {
        viewer.terrainProvider = terrainProvider;
    }
    
    fetch('../data/pois.json').then(r => r.json()).then(pois => {
        allPoisData = pois.filter(p => p.lng && p.lat && p.id);
        const poiPositions = allPoisData.map(poi => Cesium.Cartographic.fromDegrees(poi.lng + OFFSET_LNG, poi.lat + OFFSET_LAT));
        
        const renderPois = (positions) => {
            for (let i = 0; i < allPoisData.length; i++) {
                const poi = allPoisData[i];
                const poiId = poi.id.replace('msn_', '');
                const fixedLng = poi.lng + OFFSET_LNG;
                const fixedLat = poi.lat + OFFSET_LAT;
                
                const groundHeight = (positions && positions[i]) ? (positions[i].height || 5000) : 5000;
                const altitude = groundHeight + 130;
                
                const isFlat = !!poi.flat;
                
                if (!isFlat) {
                    viewer.entities.add({
                        polyline: {
                            positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                                fixedLng, fixedLat, groundHeight,
                                fixedLng, fixedLat, altitude
                            ]),
                            width: 1.5,
                            material: new Cesium.PolylineDashMaterialProperty({
                                color: Cesium.Color.WHITE.withAlpha(0.6),
                                dashLength: 6.0
                            })
                        }
                    });
                }

                // 扁平/传统 POI 支持：如果是空白图标，无图标直接用黄色/金色文本标签显示以防冰雪看不清；否则加载对应的 PNG 图标
                const entityConfig = {
                    id: 'poi_' + poi.id,
                    name: poi.name,
                    description: poi.bubble || poi.note || '',
                    position: Cesium.Cartesian3.fromDegrees(fixedLng, fixedLat, isFlat ? groundHeight : altitude)
                };

                if (isFlat && poiId === 'wht-blank') {
                    entityConfig.label = {
                        text: poi.name,
                        font: 'bold 13px "PingFang SC", "Microsoft YaHei", Arial, sans-serif',
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        fillColor: Cesium.Color.fromCssColorString('#ffcd55'), // 亮黄/金黄色
                        outlineColor: Cesium.Color.BLACK,
                        outlineWidth: 3.5,
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: 10000000.0,
                        scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 15000, 0.4)
                    };
                } else {
                    let billboardImage = `../assets/kailashpic/${poiId}.png`;
                    let useSvgSign = false;
                    let svgIconPath = "";
                    let svgType = "";
                    let svgColor = "#f59e0b";
                    
                    if (poi.id === "msn_009") { // 马鞍石
                        useSvgSign = true;
                        svgIconPath = `<path d="M 2 12 Q 12 4 22 12 Q 22 18 12 18 Q 2 18 2 12 Z M 12 18 L 12 22 M 6 15 L 6 22 M 18 15 L 18 22" />`;
                        svgType = "自然奇观";
                        svgColor = "#fbbf24";
                    } else if (poi.id === "msn_010") { // 马头明王旅馆
                        useSvgSign = true;
                        svgIconPath = `<path d="M 12 2 L 6 9 L 6 22 L 18 22 L 18 9 Z M 9 12 A 3 3 0 0 1 15 12 M 12 6 L 12 9 M 9 16 H 15" />`;
                        svgType = "补给休憩处";
                        svgColor = "#ef4444";
                    } else if (poi.id === "msn_018") { // 卓玛拉山口
                        useSvgSign = true;
                        svgIconPath = `<path d="M 2 20 L 8 10 L 14 18 L 22 6 L 26 20 Z M 8 10 L 22 6 M 2 20 H 26" />`;
                        svgType = "全程最高点";
                        svgColor = "#3b82f6";
                    } else if (poi.id === "msn_029") { // 色龙寺
                        useSvgSign = true;
                        svgIconPath = `<path d="M 12 2 L 12 6 M 7 9 H 17 M 6 14 H 18 M 8 14 V 22 H 16 V 14 Z M 12 17 A 1.5 1.5 0 1 1 12 20" />`;
                        svgType = "内圈修行寺院";
                        svgColor = "#a855f7";
                    }

                    if (useSvgSign) {
                        billboardImage = generateRoadSignBillboard(poi.name, svgType, svgIconPath, svgColor);
                    }

                    entityConfig.billboard = {
                        image: billboardImage,
                        scale: isFlat ? 0.6 : (useSvgSign ? 0.85 : 0.65),
                        scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 10000, 0.2),
                        verticalOrigin: isFlat ? Cesium.VerticalOrigin.CENTER : Cesium.VerticalOrigin.BOTTOM,
                        heightReference: isFlat ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
                        disableDepthTestDistance: 10000000.0
                    };
                }

                viewer.entities.add(entityConfig);

                if (!poi.flat) {
                    const popup = document.createElement('div');
                    popup.className = 'poi-popup hidden';
                    popup.innerHTML = `<div class="poi-popup-content">${poi.bubble || ''}</div>`;
                    document.getElementById('cesiumContainer').appendChild(popup);
                    poiPopups.push({ id: poi.id, element: popup, lng: fixedLng, lat: fixedLat, height: altitude });
                }
            }
            document.getElementById('tour-status').innerText = '漫游已就绪';
            
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(81.2865 + OFFSET_LNG, 30.9300 + OFFSET_LAT, 5800),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-12.0),
                    roll: 0.0
                },
                duration: 4.0
            });
        };

        if (terrainProvider) {
            Cesium.sampleTerrainMostDetailed(terrainProvider, poiPositions).then(renderPois).catch(e => {
                console.error("POI 高程采样失败:", e);
                renderPois(null);
            });
        } else {
            renderPois(null);
        }
    }).catch(e => console.error("加载 POI 数据失败:", e));
}

Cesium.createWorldTerrainAsync().then(terrainProvider => {
    loadPoisAndStart(terrainProvider);
}).catch(e => {
    console.error("地形引擎初始化失败，正在以默认模式启动：", e);
    loadPoisAndStart(null);
});

// 更新 HUD 面板内容
function updateHudContent() {
    if (nearbyPois.length === 0) return;
    const activePoi = nearbyPois[currentNearbyIndex];
    
    const tagEl = document.getElementById('poi-tag');
    const titleEl = document.getElementById('poi-title');
    const descEl = document.getElementById('poi-desc');
    
    if (tagEl) tagEl.innerHTML = activePoi.type || '途经点';
    if (titleEl) titleEl.innerHTML = activePoi.name || '未知点位';
    
    let contentHtml = '';
    if (activePoi.bubble) {
        let cleanBubble = activePoi.bubble;
        // 移除多余的转义双引号首尾
        if (cleanBubble.startsWith('"') && cleanBubble.endsWith('"')) {
            cleanBubble = cleanBubble.substring(1, cleanBubble.length - 1);
        }
        contentHtml += `<div class="hud-bubble" style="line-height: 1.6; font-size: 14px;">${cleanBubble}</div>`;
    }
    
    // 支持渲染多张图片和视频
    let mediaHtml = '';
    if (activePoi.imageUrl) {
        const urls = activePoi.imageUrl.split(/[,，]/).map(u => u.trim()).filter(Boolean);
        urls.forEach(url => {
            mediaHtml += `<img src="${url}" style="width: 100%; max-width: 100%; border-radius: 8px; margin-top: 10px; display: block;" />`;
        });
    }
    if (activePoi.videoUrl) {
        mediaHtml += `<video src="${activePoi.videoUrl}" controls style="width: 100%; max-width: 100%; border-radius: 8px; margin-top: 10px; display: block;"></video>`;
    }
    contentHtml += mediaHtml;

    if (activePoi.note) {
        contentHtml += `<div class="hud-note" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; font-size: 13px; color: #ddd; line-height: 1.5;">${activePoi.note}</div>`;
    }
    
    if (descEl) {
        descEl.innerHTML = contentHtml || '暂无详细描述。';
    }
    
    // 如果超过 1 个点，显示轮播控制器
    const controls = document.getElementById('poi-carousel-controls');
    if (controls) {
        if (nearbyPois.length > 1) {
            controls.classList.remove('hidden');
            document.getElementById('poi-page-indicator').innerText = `${currentNearbyIndex + 1} / ${nearbyPois.length}`;
        } else {
            controls.classList.add('hidden');
        }
    }
}

// 辅助函数：找到路线上最近的点索引 (修复经纬度交叉比对 Bug)
function findClosestIndex(route, lat, lng) {
    let minD = Infinity;
    let idx = 0;
    for (let i = 0; i < route.length; i++) {
        // route[i][0] 为经度，route[i][1] 为纬度
        const d = Math.pow(route[i][0] - lng, 2) + Math.pow(route[i][1] - lat, 2);
        if (d < minD) { minD = d; idx = i; }
    }
    return idx;
}

// 自定义飞行递归引擎
function flyNext() {
    if (!isPlaying || currentWaypoint >= flightPath.length) {
        // 漫游结束，显示全屏谢幕
        const overlay = document.getElementById('fullscreen-overlay');
        if (overlay && currentWaypoint >= flightPath.length) {
            document.getElementById('overlay-title').innerText = '愿转山者吉祥';
            document.getElementById('overlay-desc').innerHTML = '感谢长久以来<br>为神山圣湖在地文化贡献信仰之力与纪录的所有人！';
            document.getElementById('btn-overlay-start').style.display = 'none';
            document.getElementById('btn-overlay-replay').style.display = 'inline-block';
            overlay.classList.remove('hidden');
        }
        
        isPlaying = false;
        // 不再改变按钮文本
        return;
    }
    
    const pt = flightPath[currentWaypoint];
    
    // ==========================================
    // HUD 雷达同步系统：密集点位抓取机制
    // ==========================================
    if (allPoisData.length > 0) {
        let foundNearby = [];
        
        for (const poi of allPoisData) {
            // 计算当前航点与该 POI 之间的空间直线距离（水平距离）
            const dist = Cesium.Cartesian3.distance(
                Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat),
                Cesium.Cartesian3.fromDegrees(poi.lng + OFFSET_LNG, poi.lat + OFFSET_LAT)
            );
            // 将半径 1500 米内的所有 POI 装入候选列表
            if (dist < 1500) {
                foundNearby.push(poi);
            }
        }
        
        const hudPanel = document.getElementById('poi-info-panel');
        
        // 检查探测到的列表是否发生变化，如果变化则重置索引
        const newIds = foundNearby.map(p => p.id).join(',');
        const oldIds = nearbyPois.map(p => p.id).join(',');
        
        if (newIds !== oldIds) {
            nearbyPois = foundNearby;
            currentNearbyIndex = 0; // 进入新区域，从第一个开始展示
        }
        
        if (nearbyPois.length > 0) {
            updateHudContent();
            hudPanel.classList.remove('hidden');
        } else {
            // 飞离范围后，自动隐藏 HUD
            hudPanel.classList.add('hidden');
        }
    }

    // 修复找不到索引导致动态线出不来的 Bug：改用距离最近点搜索
    if (fullRoute && fullRoute.length > 0) {
        const lastPt = currentWaypoint > 0 ? flightPath[currentWaypoint - 1] : pt;
        currentSegmentStartIdx = findClosestIndex(fullRoute, lastPt.lat, lastPt.lng);
        currentSegmentEndIdx = findClosestIndex(fullRoute, pt.lat, pt.lng);
        
        // 计算两点之间的物理距离
        const distMeters = Cesium.Cartesian3.distance(
            Cesium.Cartesian3.fromDegrees(lastPt.lng, lastPt.lat),
            Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat)
        );
        
        // 平滑速度控制：设定舒适观看速度为 40米/秒，点位密集时最少给 2.5 秒缓冲
        let dynamicDuration = Math.max(2.5, distMeters / 40.0);
        
        // 在原有设定值和动态值之间取较大者，确保绝不“狂奔”
        pt._actualDuration = Math.max(pt.duration * 1.5, dynamicDuration);

        currentSegmentStartTime = Date.now();
        currentSegmentDuration = pt._actualDuration * 1000; // 与 flyTo 动画时间完美同步
    }
    
    // 核心修复：相机高度 = 真实的地球表面海拔 + 530米的相对净空高度
    const elevationVal = typeof pt.elevation === 'number' ? pt.elevation : 5000;
    const absoluteAltitude = elevationVal + pt.range; 
    
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, absoluteAltitude),
        orientation: {
            heading: Cesium.Math.toRadians(pt.heading),
            pitch: Cesium.Math.toRadians(pt.pitch), // -32度
            roll: 0.0
        },
        duration: pt._actualDuration || (pt.duration * 1.5),
        easingFunction: Cesium.EasingFunction.LINEAR_NONE, // 匀速平滑过渡，不卡顿
        complete: () => {
            currentWaypoint++;
            flyNext();
        }
    });
}

// 全局辅助：自动激活 BGM 播放，只要用户有任何交互即触发并持续播放
function startBgm() {
    const bgmAudio = document.getElementById('bgmAudio');
    const bgmBtn = document.getElementById('btn-bgm');
    if (bgmAudio && !isBgmPlaying) {
        bgmAudio.play().then(() => {
            isBgmPlaying = true;
            if (bgmBtn) {
                bgmBtn.style.opacity = '1';
            }
        }).catch(e => {
            console.warn("BGM 自动播放受限，将在下一次用户交互时尝试:", e);
        });
    }
}

// 辅助函数：根据相机当前视点，计算路线中最近的飞行航点索引，以便无缝重对齐
function findClosestFlightPathIndex() {
    if (!flightPath || flightPath.length === 0) return 0;
    const camPos = viewer.camera.positionCartographic;
    const camLng = Cesium.Math.toDegrees(camPos.longitude);
    const camLat = Cesium.Math.toDegrees(camPos.latitude);
    
    let minD = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < flightPath.length; i++) {
        const d = Math.pow(flightPath[i].lng - camLng, 2) + Math.pow(flightPath[i].lat - camLat, 2);
        if (d < minD) {
            minD = d;
            closestIdx = i;
        }
    }
    return closestIdx;
}

// 全屏定格遮罩按钮逻辑
document.getElementById('btn-overlay-start').addEventListener('click', () => {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
    startBgm();
});

document.getElementById('btn-overlay-replay').addEventListener('click', () => {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
    currentWaypoint = 0;
    startBgm();
    document.getElementById('btn-start-tour').click();
});

// 绑定按钮事件：点击后开始巡航
document.getElementById('btn-start-tour').addEventListener('click', async () => {
    if (flightPath.length === 0) return;
    
    startBgm(); // 尝试触发音乐播放

    if (isPlaying) return; // 已经在播放了
    
    isPlaying = true;
    
    // 自动定位到距离相机当前拖拽位置最近的那个航点，防止视角瞬间瞬移或错位
    const closestIdx = findClosestFlightPathIndex();
    currentWaypoint = closestIdx;
    
    // 获取目标点数据进行地形纠偏及高度计算
    if (!flightPath[currentWaypoint].elevation) {
        try {
            if (viewer.terrainProvider && !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider)) {
                const positions = flightPath.map(pt => Cesium.Cartographic.fromDegrees(pt.lng, pt.lat));
                const updatedPositions = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions);
                for(let i = 0; i < updatedPositions.length; i++) {
                    flightPath[i].elevation = updatedPositions[i].height || 5000;
                }
            } else {
                for(let i = 0; i < flightPath.length; i++) {
                    flightPath[i].elevation = 5000;
                }
            }
        } catch (error) {
            console.error("高程计算失败：", error);
            for(let i = 0; i < flightPath.length; i++) {
                if (flightPath[i].elevation === undefined) {
                    flightPath[i].elevation = 5000;
                }
            }
        }
    }
    
    const pt = flightPath[currentWaypoint];
    const elevationVal = typeof pt.elevation === 'number' ? pt.elevation : 5000;
    const absoluteAltitude = elevationVal + pt.range;

    // 使用 3.5 秒的缓入缓出过渡飞行，将视角平滑地从自由探索拉回到正确的航线视角上
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, absoluteAltitude),
        orientation: {
            heading: Cesium.Math.toRadians(pt.heading),
            pitch: Cesium.Math.toRadians(pt.pitch),
            roll: 0.0
        },
        duration: 3.5, // 缓动过渡时长
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT, // 缓入缓出
        complete: () => {
            if (isPlaying) {
                currentWaypoint++;
                flyNext();
            }
        }
    });
});

// 720 自由探索（即停止巡航）
document.getElementById('btn-free-explore').addEventListener('click', () => {
    startBgm(); // 尝试触发音乐播放
    isPlaying = false;
    viewer.camera.cancelFlight();
});

// 打赏模态框逻辑
const tipModal = document.getElementById('tipModal');
const closeTipModal = document.getElementById('closeTipModal');
const btnDonate = document.querySelector('.bar-btn-donate');

if (btnDonate && tipModal && closeTipModal) {
    btnDonate.addEventListener('click', () => {
        tipModal.classList.remove('hidden');
    });
    closeTipModal.addEventListener('click', () => {
        tipModal.classList.add('hidden');
    });
    // 点击空白区域关闭
    window.addEventListener('click', (e) => {
        if (e.target === tipModal) {
            tipModal.classList.add('hidden');
        }
    });
}

// 赞助商联系方式模态框逻辑
const sponsorsModal = document.getElementById('sponsorsModal');
const closeSponsorsModal = document.getElementById('closeSponsorsModal');
const adBanner = document.querySelector('.ad-banner');

if (adBanner && sponsorsModal && closeSponsorsModal) {
    adBanner.addEventListener('click', () => {
        sponsorsModal.classList.remove('hidden');
    });
    closeSponsorsModal.addEventListener('click', () => {
        sponsorsModal.classList.add('hidden');
    });
    // 点击空白区域关闭
    window.addEventListener('click', (e) => {
        if (e.target === sponsorsModal) {
            sponsorsModal.classList.add('hidden');
        }
    });
}

// 互动留言发布逻辑
const publishModal = document.getElementById('publishModal');
const btnPublishMsg = document.getElementById('btn-publish-msg');
const closePublishModal = document.getElementById('closePublishModal');
const btnSubmitMsg = document.getElementById('btn-submit-msg');
const pubStatus = document.getElementById('pub-status');

if (btnPublishMsg && publishModal && closePublishModal) {
    btnPublishMsg.addEventListener('click', () => {
        publishModal.classList.remove('hidden');
        pubStatus.style.display = 'none';
    });
    closePublishModal.addEventListener('click', () => {
        publishModal.classList.add('hidden');
    });
    window.addEventListener('click', (e) => {
        if (e.target === publishModal) {
            publishModal.classList.add('hidden');
        }
    });
}

// 获取动态留言并渲染
async function fetchAndRenderMessages() {
    try {
        const response = await fetch('/api/messages');
        if (response.ok) {
            const data = await response.json();
            if (data.messages && data.messages.length > 0) {
                const slider = document.querySelector('.ad-text-slider');
                const modalList = document.getElementById('modal-message-list');
                data.messages.forEach(msg => {
                    const contactStr = msg.contact ? ` (${msg.contact})` : '';
                    const htmlStr = `<strong>${msg.nickname}</strong>: ${msg.content}${contactStr}`;
                        
                    // 添加到跑马灯
                    if (slider) {
                        const div = document.createElement('div');
                        div.className = 'ad-slide';
                        div.innerHTML = htmlStr;
                        slider.appendChild(div);
                    }
                    
                    // 添加到模态框
                    if (modalList) {
                        const li = document.createElement('li');
                        li.innerHTML = htmlStr;
                        modalList.appendChild(li);
                    }
                });
            }
        }
    } catch (e) {
        console.log('留言拉取失败', e);
    }
}

// 页面加载完成后拉取留言
document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderMessages();
});

// 提交留言
if (btnSubmitMsg) {
    btnSubmitMsg.addEventListener('click', async () => {
        const nickname = document.getElementById('pub-nickname').value.trim();
        const contact = document.getElementById('pub-contact').value.trim();
        const type = document.getElementById('pub-type').value;
        const content = document.getElementById('pub-content').value.trim();
        const captcha = document.getElementById('pub-captcha').value.trim();

        if (!nickname || !content) {
            pubStatus.innerText = '昵称和内容为必填项！';
            pubStatus.style.color = 'red';
            pubStatus.style.display = 'block';
            return;
        }

        // 防刷人机简单阻挡验证
        if (captcha !== '冈仁波齐' && captcha !== '岗仁波齐' && captcha !== '冈仁波齐峰') {
            pubStatus.innerText = '验证码错误，请输入正确的四字神山名称！(提示：冈仁波齐)';
            pubStatus.style.color = 'red';
            pubStatus.style.display = 'block';
            return;
        }

        btnSubmitMsg.innerText = '提交中...';
        btnSubmitMsg.disabled = true;

        try {
            const latitude = window.emergencyCoordinates ? window.emergencyCoordinates.latitude : null;
            const longitude = window.emergencyCoordinates ? window.emergencyCoordinates.longitude : null;
            
            const response = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname, contact, type, content, captcha, latitude, longitude })
            });

            if (response.ok) {
                pubStatus.innerText = type === '紧急求助' ? 
                    '紧急求助已提交！我们将立即通过微信推送给管理员，并在3D地图中进行定位！' : 
                    '提交成功！留言已进入待审核队列，管理员审核通过后将在公网展示。';
                pubStatus.style.color = type === '紧急求助' ? 'red' : 'green';
                pubStatus.style.display = 'block';
                
                // 动态追加到 DOM，立即显示
                const slider = document.querySelector('.ad-text-slider');
                if (slider) {
                    const contactStr = contact ? ` (${contact})` : '';
                    const htmlStr = `<strong>[${type}] ${nickname}</strong>: ${content}${contactStr}`;
                    
                    const div = document.createElement('div');
                    div.className = 'ad-slide';
                    div.innerHTML = htmlStr;
                    
                    const targetChild = slider.children[5];
                    if (targetChild) {
                        slider.insertBefore(div, targetChild);
                    } else {
                        slider.appendChild(div);
                    }
                    
                    const modalList = document.getElementById('modal-message-list');
                    if (modalList) {
                        const li = document.createElement('li');
                        li.innerHTML = htmlStr;
                        modalList.prepend(li);
                    }
                }

                // 2秒后关闭弹窗
                setTimeout(() => {
                    publishModal.classList.add('hidden');
                    btnSubmitMsg.innerText = '提 交 发 布';
                    btnSubmitMsg.disabled = false;
                    document.getElementById('pub-nickname').value = '';
                    document.getElementById('pub-contact').value = '';
                    document.getElementById('pub-content').value = '';
                    document.getElementById('pub-captcha').value = '';
                    document.getElementById('gps-info-container').style.display = 'none';
                    window.emergencyCoordinates = null;
                }, 3000);
            } else {
                const err = await response.json();
                throw new Error(err.error || '提交失败');
            }
        } catch (e) {
            pubStatus.innerText = '发布失败：' + e.message;
            pubStatus.style.color = 'red';
            pubStatus.style.display = 'block';
            btnSubmitMsg.innerText = '提 交 发 布';
            btnSubmitMsg.disabled = false;
        }
    });
}

// 背景音乐逻辑
const bgmBtn = document.getElementById('btn-bgm');
const bgmAudio = document.getElementById('bgmAudio');
let isBgmPlaying = false;

if (bgmBtn && bgmAudio) {
    bgmBtn.addEventListener('click', () => {
        if (isBgmPlaying) {
            bgmAudio.pause();
            bgmBtn.style.opacity = '0.5';
        } else {
            bgmAudio.play().catch(e => console.error("BGM 播放失败:", e));
            bgmBtn.style.opacity = '1';
        }
        isBgmPlaying = !isBgmPlaying;
    });
    // 默认样式降低透明度表示未播放
    bgmBtn.style.opacity = '0.5';
}

// 绑定轮播翻页事件
document.getElementById('btn-poi-prev').addEventListener('click', () => {
    if (nearbyPois.length <= 1) return;
    currentNearbyIndex = (currentNearbyIndex - 1 + nearbyPois.length) % nearbyPois.length;
    updateHudContent();
});

document.getElementById('btn-poi-next').addEventListener('click', () => {
    if (nearbyPois.length <= 1) return;
    currentNearbyIndex = (currentNearbyIndex + 1) % nearbyPois.length;
    updateHudContent();
});

// ==========================================
// 控制面板拖拽/滑动高度调节 & 最小化逻辑
// ==========================================
const dragHandle = document.getElementById('drag-handle');
const uiPanel = document.getElementById('ui-panel');
const poiBody = document.querySelector('.poi-body');
const poiResizer = document.getElementById('poi-resizer');

// 1. 顶部手柄 (#drag-handle) 拖拽拉高与折叠逻辑 (支持 PC 鼠标与移动端触摸)
if (dragHandle && uiPanel && poiBody) {
    let startY = 0;
    let startHeight = 0;
    let isDragging = false;
    let hasMoved = false;

    const initDrag = (e) => {
        isDragging = true;
        hasMoved = false;
        startY = e.clientY || (e.touches && e.touches[0].clientY);
        
        // 如果当前是最小化状态，起始高度视为最小高度 (60px)
        const isMinimized = uiPanel.classList.contains('minimized');
        startHeight = isMinimized ? 60 : (poiBody.offsetHeight || 220);

        document.documentElement.addEventListener('mousemove', doDrag, false);
        document.documentElement.addEventListener('touchmove', doDrag, { passive: false });
        document.documentElement.addEventListener('mouseup', stopDrag, false);
        document.documentElement.addEventListener('touchend', stopDrag, false);

        if (e.cancelable) {
            e.preventDefault();
        }
    };

    const doDrag = (e) => {
        if (!isDragging) return;
        
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const deltaY = startY - clientY; // 往上拉 deltaY 为正值，增加高度
        
        if (Math.abs(deltaY) > 5) {
            hasMoved = true;
        }

        if (hasMoved) {
            // 如果是在最小化状态往上拉，立即展开面板
            if (uiPanel.classList.contains('minimized') && deltaY > 10) {
                uiPanel.classList.remove('minimized');
            }
            
            let newHeight = startHeight + deltaY;
            
            // 限制拉伸高度范围
            const minHeight = 60;
            const maxHeight = window.innerHeight * 0.7;
            if (newHeight < minHeight) newHeight = minHeight;
            if (newHeight > maxHeight) newHeight = maxHeight;
            
            poiBody.style.height = `${newHeight}px`;
        }

        if (e.cancelable) {
            e.preventDefault();
        }
    };

    const stopDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        document.documentElement.removeEventListener('mousemove', doDrag, false);
        document.documentElement.removeEventListener('touchmove', doDrag, false);
        document.documentElement.removeEventListener('mouseup', stopDrag, false);
        document.documentElement.removeEventListener('touchend', stopDrag, false);

        const endY = e.clientY || (e.changedTouches && e.changedTouches[0].clientY) || startY;
        const totalDeltaY = endY - startY; // 往下拉为正值

        if (!hasMoved) {
            // 纯点击手柄：直接切换最小化状态
            uiPanel.classList.toggle('minimized');
            if (uiPanel.classList.contains('minimized')) {
                poiBody.style.height = ''; // 折叠时清空内联高度样式
            }
        } else {
            // 拖动释放：如果向下拖动距离过大，则折叠最小化
            if (totalDeltaY > 80) {
                uiPanel.classList.add('minimized');
                poiBody.style.height = '';
            } else if (totalDeltaY < -30) {
                uiPanel.classList.remove('minimized');
            }
        }
    };

    dragHandle.addEventListener('mousedown', initDrag, false);
    dragHandle.addEventListener('touchstart', initDrag, { passive: false });
}

// 2. 底部拖拽条 (#poi-resizer) 调节高度逻辑 (仅 PC Web 端生效)
if (poiResizer && poiBody) {
    let startY = 0;
    let startHeight = 0;
    let isDragging = false;

    const initDrag = (e) => {
        isDragging = true;
        startY = e.clientY || (e.touches && e.touches[0].clientY);
        startHeight = parseInt(document.defaultView.getComputedStyle(poiBody).height, 10) || 220;
        
        document.documentElement.addEventListener('mousemove', doDrag, false);
        document.documentElement.addEventListener('touchmove', doDrag, false);
        document.documentElement.addEventListener('mouseup', stopDrag, false);
        document.documentElement.addEventListener('touchend', stopDrag, false);
        
        poiResizer.style.background = 'rgba(255, 255, 255, 0.4)';
        
        if (e.cancelable) {
            e.preventDefault();
        }
    };

    const doDrag = (e) => {
        if (!isDragging) return;
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const deltaY = clientY - startY; // 往下拉增加高度
        let newHeight = startHeight + deltaY;
        
        const minHeight = 120;
        const maxHeight = window.innerHeight * 0.7;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
        
        poiBody.style.height = `${newHeight}px`;
    };

    const stopDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        document.documentElement.removeEventListener('mousemove', doDrag, false);
        document.documentElement.removeEventListener('touchmove', doDrag, false);
        document.documentElement.removeEventListener('mouseup', stopDrag, false);
        document.documentElement.removeEventListener('touchend', stopDrag, false);
        
        poiResizer.style.background = '';
    };

    poiResizer.addEventListener('mousedown', initDrag, false);
    poiResizer.addEventListener('touchstart', initDrag, false);
}

// =========================================================
// 新增：定位、导航、紧急救援功能
// =========================================================

// 全局变量缓存定位信息
window.emergencyCoordinates = null;
let myLocationEntity = null;
let rescueBeaconEntity = null;

// 1. 发布模态框类型切换监听
const pubTypeSelect = document.getElementById('pub-type');
const gpsInfoContainer = document.getElementById('gps-info-container');
const gpsStatusText = document.getElementById('gps-status-text');

if (pubTypeSelect && gpsInfoContainer && gpsStatusText) {
    pubTypeSelect.addEventListener('change', () => {
        if (pubTypeSelect.value === '紧急求助') {
            gpsInfoContainer.style.display = 'block';
            gpsStatusText.innerText = '⏳ 正在尝试获取您当前的精确GPS位置...';
            window.emergencyCoordinates = null;
            
            if (!navigator.geolocation) {
                gpsStatusText.innerText = '❌ 您的浏览器或设备不支持 GPS 定位！';
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    window.emergencyCoordinates = { latitude: lat, longitude: lng };
                    gpsStatusText.innerHTML = `✅ 定位成功：经度 ${lng.toFixed(6)}, 纬度 ${lat.toFixed(6)}<br><span style="font-size:10px; color:#22c55e;">位置坐标已绑定，提交后将直接通知管理员！</span>`;
                },
                (err) => {
                    console.error("求救定位失败:", err);
                    gpsStatusText.innerText = `⚠️ 定位获取失败 (${err.message})，您可以继续提交，我们将以“无位置模式”发送求救。`;
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
            );
        } else {
            gpsInfoContainer.style.display = 'none';
            window.emergencyCoordinates = null;
        }
    });
}

// 2. 地图控制面板上的“我的定位”按钮逻辑
const btnMyLocation = document.getElementById('btn-my-location');
if (btnMyLocation) {
    btnMyLocation.addEventListener('click', () => {
        btnMyLocation.disabled = true;
        const oldHtml = btnMyLocation.innerHTML;
        btnMyLocation.innerHTML = '<span class="btn-icon-emoji">⏳</span><span>定位中...</span>';
        
        if (!navigator.geolocation) {
            alert("您的浏览器或设备不支持 GPS 定位！");
            btnMyLocation.disabled = false;
            btnMyLocation.innerHTML = oldHtml;
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                
                // 清除旧的定位点
                if (myLocationEntity) {
                    viewer.entities.remove(myLocationEntity);
                }
                
                // 绘制带发光蓝色点位的定位实体
                myLocationEntity = viewer.entities.add({
                    name: '我的位置',
                    position: Cesium.Cartesian3.fromDegrees(lng, lat, 0.0),
                    point: {
                        pixelSize: 14,
                        color: Cesium.Color.BLUE,
                        outlineColor: Cesium.Color.WHITE,
                        outlineWidth: 3,
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        disableDepthTestDistance: 10000000.0
                    },
                    ellipse: {
                        semiMajorAxis: 100.0,
                        semiMinorAxis: 100.0,
                        material: Cesium.Color.BLUE.withAlpha(0.2),
                        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                    }
                });
                
                // 计算与神山中心点的距离（大本营塔尔钦：81.2865, 30.9736）
                const kailashCartesian = Cesium.Cartesian3.fromDegrees(81.2865, 30.9736);
                const myCartesian = Cesium.Cartesian3.fromDegrees(lng, lat);
                const distKm = Cesium.Cartesian3.distance(kailashCartesian, myCartesian) / 1000;
                
                if (distKm < 150) { // 150公里内认为身处转山区域，进行视角飞越
                    viewer.camera.flyTo({
                        destination: Cesium.Cartesian3.fromDegrees(lng, lat, 6000),
                        orientation: {
                            heading: Cesium.Math.toRadians(0.0),
                            pitch: Cesium.Math.toRadians(-30.0),
                            roll: 0.0
                        },
                        duration: 3.0
                    });
                    alert(`🧭 定位成功！您当前已进入转山区域，GPS坐标已标记在地图上。`);
                } else {
                    alert(`🧭 定位成功！您当前位置（距离神山 ${Math.round(distKm)} 公里）超出转山核心图区。已在地球上标记蓝点（您可以缩小地球查看）。`);
                }
                
                btnMyLocation.disabled = false;
                btnMyLocation.innerHTML = oldHtml;
            },
            (err) => {
                console.error("GPS定位失败:", err);
                alert(`定位失败：请确保设备已开启 GPS，并已授权浏览器获取位置权限。(${err.message})`);
                btnMyLocation.disabled = false;
                btnMyLocation.innerHTML = oldHtml;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

// 3. 页面加载时：解析 URL 的 focusLng / focusLat 救援定位参数并飞越
function checkUrlParametersAndFocus() {
    const urlParams = new URLSearchParams(window.location.search);
    const focusLng = parseFloat(urlParams.get('focusLng'));
    const focusLat = parseFloat(urlParams.get('focusLat'));
    
    if (!isNaN(focusLng) && !isNaN(focusLat)) {
        // 延迟等视角初始化完成后再飞过去
        setTimeout(() => {
            if (rescueBeaconEntity) {
                viewer.entities.remove(rescueBeaconEntity);
            }
            
            // 绘制闪烁的红色救援警报点
            rescueBeaconEntity = viewer.entities.add({
                name: '🚨 紧急救援求助位置',
                position: Cesium.Cartesian3.fromDegrees(focusLng, focusLat, 0.0),
                point: {
                    pixelSize: 18,
                    color: Cesium.Color.RED,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 3,
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: 10000000.0
                },
                ellipse: {
                    semiMajorAxis: 200.0,
                    semiMinorAxis: 200.0,
                    material: Cesium.Color.RED.withAlpha(0.35),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
                }
            });
            
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(focusLng, focusLat, 4500),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0),
                    pitch: Cesium.Math.toRadians(-45.0),
                    roll: 0.0
                },
                duration: 4.0
            });
            
            // 在 HUD 面板提示管理员/用户
            const hudPanel = document.getElementById('poi-info-panel');
            if (hudPanel) {
                document.getElementById('poi-tag').innerText = '🚨 紧急救援点';
                document.getElementById('poi-title').innerText = '求救定位位置';
                document.getElementById('poi-desc').innerHTML = `
                    <div style="color: #ff5555; font-weight: bold; font-size: 14px; line-height: 1.6;">
                        已在3D地图上自动定位到此紧急救援求救点。<br>
                        位置坐标：经度 ${focusLng.toFixed(6)}, 纬度 ${focusLat.toFixed(6)}。<br>
                        请立即联系转山大本营或安排救援力量前往此位置实施搜救！
                    </div>
                `;
                hudPanel.classList.remove('hidden');
            }
        }, 5000);
    }
}

// 启动执行
checkUrlParametersAndFocus();

