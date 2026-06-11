# Spatial Narrative Builder Skill

Use this skill to implement, customize, or debug 3D spatial storytelling systems that synchronize a 3D camera viewer (e.g., CesiumJS) with a custom 2D canvas timeline controller.

---

## Skill Configuration

```yaml
name: spatial-narrative-builder
description: Design, implement, and debug 3D Spatial Narrative Engines featuring stacked multi-lane canvas charts, real-time timeline scrubbing, and subproject asset fallback proxies.
```

---

## 1. Stacked Multi-Lane Canvas Mixer (2D Timeline)

When building a multi-lane controller where multiple distinct variables (e.g., flight altitude, flight speed, and dwell wait times) share a common horizontal coordinate space (time or distance):

### 1.1 Render Setup
*   Divide a single `<canvas>` vertically into bounding boxes representing lanes.
*   Assign specific height percentages (e.g., Lane 1: 55% for altitude, Lane 2: 20% for speed, Lane 3: 20% for dwell time, with margins in between).
*   Maintain a clear horizontal scale mapping. Convert the horizontal pixel coordinate `X` to the cumulative distance or timeline index of the route:
    $$X_{pixel} = Margin_{left} + \frac{Distance_{current}}{Distance_{total}} \times (Width_{canvas} - Margin_{left} - Margin_{right})$$

### 1.2 Multi-Lane Hit Detection (`pointerdown`)
```javascript
// Example hit testing across stacked lanes
canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 1. Identify index along horizontal axis
    const activeIdx = findNearestWaypointIndexByX(mouseX);

    // 2. Identify lane based on vertical position
    if (mouseY >= laneElevation.top && mouseY <= laneElevation.bottom) {
        // Handle Elevation adjustment
        startDragging(activeIdx, 'elevation', e);
    } else if (mouseY >= laneSpeed.top && mouseY <= laneSpeed.bottom) {
        // Handle Speed adjustment
        startDragging(activeIdx, 'speed', e);
    } else if (mouseY >= laneWait.top && mouseY <= laneWait.bottom) {
        // Handle Dwell/Wait adjustment
        startDragging(activeIdx, 'wait', e);
    } else {
        // Empty space click starts timeline scrubbing
        startScrubbing(mouseX);
    }
});
```

---

## 2. Synchronized 3D Timeline Scrubbing (WYSIWYG)

To sync the 2D playhead line with the 3D viewport position during mouse dragging (scrubbing):

### 2.1 Interpolation Algorithm
Calculate the position and view parameters for any arbitrary point `d` (where `d` is the distance along the route from `0.0` to `dMax`):
1.  Locate the two surrounding keyframe waypoints `P[i]` and `P[i+1]` such that `P[i].distance <= d <= P[i+1].distance`.
2.  Compute the localized interpolation factor:
    $$t = \frac{d - P[i].distance}{P[i+1].distance - P[i].distance}$$
3.  Perform linear interpolation for position (longitude, latitude, altitude):
    $$\text{lng} = P[i].\text{lng} + (P[i+1].\text{lng} - P[i].\text{lng}) \times t$$
    $$\text{lat} = P[i].\text{lat} + (P[i+1].\text{lat} - P[i].\text{lat}) \times t$$
4.  Perform angle interpolation (heading, pitch, fov) using shortest-path angle wrapping to prevent camera spins.

### 2.2 Boundary Fallback Check
Ensure that when `d` is out of bounds (e.g. `d <= 0` or `d >= dMax`), a clean fallback object is returned instead of raising a Null reference error:
```javascript
function getInterpolatedPoint(d) {
    if (waypoints.length === 0) return null;
    if (waypoints.length === 1 || d <= 0) {
        return { ...waypoints[0] };
    }
    const maxDist = waypoints[waypoints.length - 1].cumulativeDistance;
    if (d >= maxDist) {
        return { ...waypoints[waypoints.length - 1] };
    }
    // Perform interpolation and return...
}
```

---

## 3. Multi-selection & Shift-Click Range Logic

To let users edit multiple nodes at once, use double-key modifiers (`Ctrl`/`Cmd` and `Shift`):

```javascript
// Shift & Ctrl range selection on sidebar list
function handleItemClick(clickedIndex, event) {
    if (event.shiftKey && activeIndex !== -1) {
        // Select range from activeIndex to clickedIndex
        const start = Math.min(activeIndex, clickedIndex);
        const end = Math.max(activeIndex, clickedIndex);
        selectedIds = [];
        for (let i = start; i <= end; i++) {
            selectedIds.push(waypoints[i].id);
        }
    } else if (event.ctrlKey || event.metaKey) {
        // Toggle individual selection
        const id = waypoints[clickedIndex].id;
        const idx = selectedIds.indexOf(id);
        if (idx > -1) {
            selectedIds.splice(idx, 1);
        } else {
            selectedIds.push(id);
        }
    } else {
        // Standard single select
        activeIndex = clickedIndex;
        selectedIds = [waypoints[clickedIndex].id];
    }
    renderUI();
}
```

---

## 4. 50-step Transaction Undo History Stack

Any operation that mutates state (dragging a point, deleting a waypoint, adding a camera state, applying a preset) must be backed up before the change:

```javascript
let historyStack = [];
const MAX_HISTORY = 50;

function pushHistoryState() {
    // Perform deep copy of the state array to avoid reference leaks
    const stateCopy = JSON.parse(JSON.stringify(waypoints));
    historyStack.push(stateCopy);
    
    if (historyStack.length > MAX_HISTORY) {
        historyStack.shift(); // Evict oldest
    }
    updateUndoButtonState();
}

function undoLastAction() {
    if (historyStack.length === 0) return;
    const previousState = historyStack.pop();
    waypoints = previousState;
    
    renderAll();
    saveDataToServer(); // Optional auto-save
    updateUndoButtonState();
}
```

---

## 5. Subproject Sandboxing & Server Fallback Routing

When serving multiple subprojects that share the same codebase assets but isolate their route JSONs:

### 5.1 Directory Structure
```
/kailash-kora-map (root)
  |-- flight-editor.html (shared page)
  |-- server.js (shared server)
  |-- 3d/ (shared asset folders)
  |-- kailash-debug/ (subproject folder)
       |-- data/
            |-- routes.json (subproject specific)
            |-- pois.json (subproject specific)
```

### 5.2 Server-Side Express Static Routing Fallback
Intercept missing requests on subprojects and proxy them back to the root files so you don't copy JS/CSS:
```javascript
// Express middleware for subproject fallback
app.use('/:project', (req, res, next) => {
    const project = req.params.project;
    
    // Skip API routes and root assets
    if (project === 'api' || req.path.includes('/api/')) return next();
    
    const localPath = path.join(__dirname, project, req.path);
    if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        // Serve subproject customized file
        return res.sendFile(localPath);
    }
    
    // Fallback: Serve root shared file
    const rootPath = path.join(__dirname, req.path);
    if (fs.existsSync(rootPath) && fs.statSync(rootPath).isFile()) {
        return res.sendFile(rootPath);
    }
    
    next();
});
```
This forces the browser context to stay inside `/[project]/`, so all AJAX calls made using relative path URLs like `api/save-routes` automatically target `/[project]/api/save-routes`.
