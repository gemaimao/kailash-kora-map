// elevation_chart.js – Interactive elevation profile controller
// This module is imported by app.js and attaches UI to the overlay <div id="elevation-chart">

export function initElevationChart(flightPath) {
  const container = document.getElementById('elevation-chart');
  if (!container) return;
  container.innerHTML = '';
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 200;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // Prepare data: cumulative time (seconds) and elevation (meters)
  const points = [];
  let cumTime = 0;
  for (let i = 0; i < flightPath.length; i++) {
    const pt = flightPath[i];
    const dur = pt.duration || 5; // fallback seconds
    cumTime += dur;
    points.push({ t: cumTime, e: pt.elevation || 5000, index: i });
  }

  // Determine scaling functions
  const tMax = points[points.length - 1].t;
  const eVals = points.map(p => p.e);
  const eMin = Math.min(...eVals);
  const eMax = Math.max(...eVals);
  const padding = 20;
  const toX = t => padding + (t / tMax) * (width - 2 * padding);
  const toY = e => height - padding - ((e - eMin) / (eMax - eMin)) * (height - 2 * padding);

  // Draw axes
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    // X axis
    ctx.beginPath();
    ctx.moveTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    // Y axis
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.stroke();

    // Polyline
    ctx.strokeStyle = '#ffcd55';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = toX(p.t);
      const y = toY(p.e);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Handles
    points.forEach(p => {
      const x = toX(p.t);
      const y = toY(p.e);
      ctx.fillStyle = '#ffcd55';
      ctx.strokeStyle = '#000';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }

  draw();

  // Interaction – drag nearest handle
  let dragging = null; // reference to point object
  const radius = 8;

  function getMousePos(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  function hitTest(pos) {
    for (let p of points) {
      const dx = pos.x - toX(p.t);
      const dy = pos.y - toY(p.e);
      if (dx * dx + dy * dy <= radius * radius) return p;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', e => {
    const p = getMousePos(e);
    const hit = hitTest(p);
    if (hit) {
      dragging = hit;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const p = getMousePos(e);
    // Update elevation (y) – clamp within canvas
    let newY = Math.min(Math.max(p.y, padding), height - padding);
    const newE = eMin + ((height - padding - newY) / (height - 2 * padding)) * (eMax - eMin);
    dragging.e = newE;
    // Optional: adjust time (x) for speed control – enable horizontal drag
    // Here we allow both axes, but constrain time within total range
    let newX = Math.min(Math.max(p.x, padding), width - padding);
    const newT = (newX - padding) / (width - 2 * padding) * tMax;
    dragging.t = newT;
    // Re‑sort points by time to keep curve monotonic
    points.sort((a, b) => a.t - b.t);
    draw();
  });

  canvas.addEventListener('pointerup', e => {
    if (dragging) {
      // Apply changes back to flightPath
      const updated = flightPath.map(pt => Object.assign({}, pt));
      points.forEach(p => {
        const idx = p.index;
        updated[idx].elevation = Math.round(p.e);
        // Derive new duration proportionally from time differences
        if (idx > 0) {
          const prevT = points.find(q => q.index === idx - 1).t;
          const segDur = p.t - prevT;
          updated[idx].duration = Math.max(1, Math.round(segDur));
        }
      });
      const event = new CustomEvent('elevationChartChanged', { detail: updated });
      container.dispatchEvent(event);
      dragging = null;
    }
    canvas.releasePointerCapture(e.pointerId);
  });
}
