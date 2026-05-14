# 720yun-style Annotation Editing Mechanism Design

## 1. Core Concept
Transform the current 2D map experience into a **Narrative Journey Engine**. Instead of just markers on a map, we treat the pilgrimage as a **Timeline of Viewports and Bubbles**.

## 2. Enhanced Data Schema (`narrative.json`)
We should move away from separate POI/Route files and towards a unified Narrative structure that the playback engine consumes.

```json
{
  "trajectory": {
    "points": [[lat, lng], ...],
    "interpolation": "spline" 
  },
  "keyframes": [
    {
      "id": "drira-puk",
      "progress": 0.45,
      "type": "POI",
      "marker": { "icon": "temple", "label": "Drira Puk" },
      "camera": {
        "center": [31.10, 81.30],
        "zoom": 14.5,
        "pitch": 45,       // If using Mapbox/Three.js
        "bearing": 0
      },
      "bubble": {
        "title": "芝热寺",
        "content": "面对冈仁波齐北壁...",
        "media": { "type": "image", "url": "assets/drira.jpg" },
        "dwell": 10 // seconds
      }
    },
    {
      "progress": 0.5,
      "type": "VIEW", // A camera-only keyframe to control movement flow
      "camera": { "zoom": 13, "pitch": 0 }
    }
  ]
}
```

## 3. Editor UI/UX Design

### A. Timeline Editor (The "Heart")
- **Bottom Bar**: A horizontal timeline representing 0% to 100% of the route.
- **Markers**: Icons on the timeline representing POIs.
- **Interaction**: Drag markers left/right to adjust *when* they trigger during playback.

### B. Viewport Controller ("What You See")
- **Record View Button**: While browsing the map in the editor, click to capture the current `center`, `zoom`, and `rotation`.
- **Assign to POI**: Link the captured view to a specific POI or a new keyframe.

### C. Route Tracing Tool
- **Magnetic Snapping**: Snap new route points to existing roads (if possible) or clean up jagged lines.
- **Velocity Control**: Ability to set "Slow Down" zones (e.g., steep climbs like Dolma La).

### D. Bubble Builder
- **Rich Text Support**: Markdown or simple HTML for better storytelling.
- **Media Integration**: Drop zone for images/audio.

## 4. Technical Implementation Path

### Phase 1: Unified State Management
- Refactor `app.js` to use a central `NarrativeStore`.
- Implement a `Player` class that handles the `requestAnimationFrame` loop and emits events (`onProgress`, `onKeyframe`).

### Phase 2: The "Record & Play" Editor
- Build a new `admin/narrator.html`.
- **Canvas Overlay**: Allow drawing routes and placing markers directly on the map.
- **Live Preview Window**: A small window showing exactly what the user will see.

### Phase 3: Advanced Camera Control
- **Camera Interpolation**: Use `Leaflet.PanTo` with custom duration or move to `Mapbox GL JS` / `Cesium` for true 3D camera angles (pitch/bearing).
- **Auto-Orbit**: Camera slowly rotates around a POI while the bubble is open.

### Phase 4: Media & Bubbles
- Implement a "Bubble Component" that supports transitions (fade in/out) and interactive elements (links, audio play).

---

## Next Steps
1. **Prototype the Timeline**: Add a visual timeline to the current `editor.html`.
2. **View Capturing**: Implement a "Capture Map State" button that outputs the current `L.Map` parameters to JSON.
3. **Integrate into `app.js`**: Update the playback logic to consume the new `camera` and `dwell` parameters from the keyframes.
