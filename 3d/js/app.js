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
    
    // 1. 全局路线底色 (使用 clampToGround 完美贴合地形起伏)
    viewer.entities.add({
        name: 'Kora Route Base',
        polyline: {
            positions: fullRoutePositions,
            width: 4,
            material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.6),
                dashLength: 20
            }),
            clampToGround: true
        }
    });

    // 2. 动态飞行轨迹（完美丝滑版）
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
                
                const exactIdx = Math.floor((currentSegmentStartIdx + (currentSegmentEndIdx - currentSegmentStartIdx) * progress) * SMOOTH_FACTOR);
                
                const newPositions = fullRoutePositions.slice(0, exactIdx + 1);
                if (newPositions.length >= 2) {
                    progressPositions = newPositions;
                }
                return progressPositions.length >= 2 ? progressPositions : undefined;
            }, false),
            width: 12,
            material: new Cesium.PolylineGlowMaterialProperty({
                glowPower: 0.3,
                color: Cesium.Color.fromCssColorString('#f59e0b')
            }),
            clampToGround: true
        }
    });
});

// =========================================================
// 安全初始化地形，然后绘制神山所有的 POI 地标
// =========================================================
Cesium.createWorldTerrainAsync().then(terrainProvider => {
    viewer.terrainProvider = terrainProvider; // 注入全球地形
    
    fetch('../data/pois.json').then(r => r.json()).then(pois => {
        allPoisData = pois.filter(p => p.lng && p.lat && p.id);
        const poiPositions = allPoisData.map(poi => Cesium.Cartographic.fromDegrees(poi.lng + OFFSET_LNG, poi.lat + OFFSET_LAT));
        
        // 地形引擎彻底就绪，安全采样所有 POI 的真实地表高程！
        Cesium.sampleTerrainMostDetailed(terrainProvider, poiPositions).then(updatedPositions => {
            for (let i = 0; i < allPoisData.length; i++) {
                const poi = allPoisData[i];
                const poiId = poi.id.replace('msn_', '');
                const fixedLng = poi.lng + OFFSET_LNG;
                const fixedLat = poi.lat + OFFSET_LAT;
                
                const groundHeight = updatedPositions[i].height || 5000;
                const altitude = groundHeight + 130;
                
                // 绘制纯 2D 效果的垂直虚线，完美匹配 2D 纸片图标
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

                // 绘制悬浮大图标
                const iconUrl = `https://raw.githubusercontent.com/gemaimao/assets/main/kailashpic/${poiId}.png`;
                viewer.entities.add({
                    name: poi.name || "POI",
                    position: Cesium.Cartesian3.fromDegrees(fixedLng, fixedLat, altitude),
                    billboard: {
                        image: iconUrl,
                        scale: 0.65,  // 图标增大
                        scaleByDistance: new Cesium.NearFarScalar(100, 1.0, 10000, 0.2),
                        verticalOrigin: Cesium.VerticalOrigin.BOTTOM, // 让图标站在光柱顶部
                        disableDepthTestDistance: undefined
                    }
                });
            }
            document.getElementById('tour-status').innerText = '漫游已就绪';
            
            // 立刻飞往“起飞前景大图”视角
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(81.2865 + OFFSET_LNG, 30.9300 + OFFSET_LAT, 5800),
                orientation: {
                    heading: Cesium.Math.toRadians(0.0), // 正北
                    pitch: Cesium.Math.toRadians(-12.0), // 微微低头
                    roll: 0.0
                },
                duration: 4.0
            });
        }).catch(e => console.error("POI 高程采样失败:", e));
    }).catch(e => console.error("加载 POI 数据失败:", e));
}).catch(e => console.error("地形引擎初始化失败:", e));

// 更新 HUD 面板内容
function updateHudContent() {
    if (nearbyPois.length === 0) return;
    const activePoi = nearbyPois[currentNearbyIndex];
    document.getElementById('poi-type-badge').innerHTML = activePoi.type || '途经点';
    document.getElementById('poi-title').innerHTML = activePoi.name || '未知点位';
    document.getElementById('poi-desc').innerHTML = activePoi.bubble || activePoi.note || '暂无详细描述。';
    
    // 如果超过 1 个点，显示轮播控制器
    const controls = document.getElementById('poi-carousel-controls');
    if (nearbyPois.length > 1) {
        controls.classList.remove('hidden');
        document.getElementById('poi-page-indicator').innerText = `${currentNearbyIndex + 1} / ${nearbyPois.length}`;
    } else {
        controls.classList.add('hidden');
    }
}

// 辅助函数：找到路线上最近的点索引
function findClosestIndex(route, lat, lng) {
    let minD = Infinity;
    let idx = 0;
    for (let i = 0; i < route.length; i++) {
        const d = Math.pow(route[i][0] - lat, 2) + Math.pow(route[i][1] - lng, 2);
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
        document.getElementById('btn-stop-tour').innerText = '⏸ 720探索';
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
    const absoluteAltitude = pt.elevation + pt.range; 
    
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

// 全屏定格遮罩按钮逻辑
document.getElementById('btn-overlay-start').addEventListener('click', () => {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
});

document.getElementById('btn-overlay-replay').addEventListener('click', () => {
    document.getElementById('fullscreen-overlay').classList.add('hidden');
    currentWaypoint = 0;
    document.getElementById('btn-start-tour').click();
});

// 绑定按钮事件：点击后开始巡航
document.getElementById('btn-start-tour').addEventListener('click', async () => {
    if (flightPath.length === 0) return;
    if (isPlaying) return; // 已经在播放了
    
    // 如果是漫游结束，或者没开始过，则从 0 开始
    if (currentWaypoint >= flightPath.length) {
        currentWaypoint = 0;
    }
    
    isPlaying = true;
    
    // 隐藏巡航按钮，显示探索按钮
    document.getElementById('btn-start-tour').classList.add('hidden');
    const stopBtn = document.getElementById('btn-stop-tour');
    stopBtn.classList.remove('hidden');
    stopBtn.querySelector('span').innerText = '探索';
    
    if (currentWaypoint === 0 && !flightPath[0].elevation) {
        try {
            const positions = flightPath.map(pt => Cesium.Cartographic.fromDegrees(pt.lng, pt.lat));
            const updatedPositions = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, positions);
            for(let i = 0; i < updatedPositions.length; i++) {
                flightPath[i].elevation = updatedPositions[i].height || 5000;
            }
        } catch (error) {
            console.error("高程计算失败", error);
        }
    }
    
    flyNext();
});

// 暂停/恢复 巡航
document.getElementById('btn-stop-tour').addEventListener('click', () => {
    isPlaying = !isPlaying;
    const btnSpans = document.getElementById('btn-stop-tour').querySelectorAll('span');
    if (btnSpans.length > 1) {
        btnSpans[1].innerText = isPlaying ? '探索' : '恢复';
    }
    const btnEmoji = document.getElementById('btn-stop-tour').querySelector('.btn-icon-emoji');
    if (btnEmoji) {
        btnEmoji.innerText = isPlaying ? '⏸️' : '▶️';
    }
    
    if (isPlaying) {
        flyNext();
    } else {
        viewer.camera.cancelFlight();
    }
});

// 打赏模态框逻辑
const tipModal = document.getElementById('tipModal');
const closeTipModal = document.getElementById('closeTipModal');
const btnDonate = document.querySelector('.btn-donate');

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
                if (slider) {
                    data.messages.forEach(msg => {
                        const contactStr = msg.contact ? ` (${msg.contact})` : '';
                        const htmlStr = `<strong>[${msg.type}] ${msg.nickname}</strong>: ${msg.content}${contactStr}`;
                        
                        // 添加到跑马灯
                        const div = document.createElement('div');
                        div.className = 'ad-slide';
                        div.innerHTML = htmlStr;
                        slider.appendChild(div);
                        
                        // 添加到模态框
                        const modalList = document.getElementById('modal-message-list');
                        if (modalList) {
                            const li = document.createElement('li');
                            li.innerHTML = htmlStr;
                            modalList.appendChild(li);
                        }
                    });
                }
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

        if (!nickname || !content) {
            pubStatus.innerText = '昵称和内容为必填项！';
            pubStatus.style.color = 'red';
            pubStatus.style.display = 'block';
            return;
        }

        btnSubmitMsg.innerText = '提交中...';
        btnSubmitMsg.disabled = true;

        try {
            const response = await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname, contact, type, content })
            });

            if (response.ok) {
                pubStatus.innerText = '发布成功！已加入滚动队列。';
                pubStatus.style.color = 'green';
                pubStatus.style.display = 'block';
                
                // 动态追加到 DOM，立即显示
                const slider = document.querySelector('.ad-text-slider');
                if (slider) {
                    const contactStr = contact ? ` (${contact})` : '';
                    const htmlStr = `<strong>[${type}] ${nickname}</strong>: ${content}${contactStr}`;
                    
                    const div = document.createElement('div');
                    div.className = 'ad-slide';
                    div.innerHTML = htmlStr;
                    slider.appendChild(div);
                    
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
                }, 2000);
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

// 控制面板滑动/点击最小化逻辑
const dragHandle = document.getElementById('drag-handle');
const uiPanel = document.getElementById('ui-panel');
if (dragHandle && uiPanel) {
    // 支持点击切换
    dragHandle.addEventListener('click', () => {
        uiPanel.classList.toggle('minimized');
    });

    // 支持滑动折叠/展开
    let startY = 0;
    dragHandle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
    });
    dragHandle.addEventListener('touchend', (e) => {
        let endY = e.changedTouches[0].clientY;
        let deltaY = endY - startY;
        if (deltaY > 30) {
            // 向下滑动，折叠
            uiPanel.classList.add('minimized');
        } else if (deltaY < -30) {
            // 向上滑动，展开
            uiPanel.classList.remove('minimized');
        }
    });
}
