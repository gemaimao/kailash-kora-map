const fs = require('fs');
const path = require('path');
const vm = require('vm');

try {
  const filePath = path.join(__dirname, 'flight-editor.html');
  const html = fs.readFileSync(filePath, 'utf8');
  
  const startTag = '<script>';
  const endTag = '</script>';
  const startIndex = html.indexOf(startTag);
  const endIndex = html.indexOf(endTag, startIndex);
  
  if (startIndex === -1 || endIndex === -1) {
    console.error('Could not find script tags in flight-editor.html');
    process.exit(1);
  }
  
  let scriptContent = html.substring(startIndex + startTag.length, endIndex);
  
  // Create mock browser environment
  const mockDocument = {
    getElementById: (id) => {
      // Mock elements
      return {
        addEventListener: () => {},
        style: {},
        getContext: () => ({
          clearRect: () => {},
          scale: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          stroke: () => {},
          fill: () => {},
          arc: () => {},
          fillText: () => {},
          save: () => {},
          translate: () => {},
          rotate: () => {},
          restore: () => {},
          createLinearGradient: () => ({ addColorStop: () => {} }),
          closePath: () => {}
        }),
        getBoundingClientRect: () => ({ width: 1000, height: 260 }),
        classList: { toggle: () => {}, remove: () => {}, add: () => {} }
      };
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  
  const mockWindow = {
    addEventListener: () => {},
    devicePixelRatio: 1,
    DOMContentLoaded: 'DOMContentLoaded'
  };

  const mockCesium = {
    Ion: { defaultAccessToken: '' },
    Viewer: function() {
      return {
        cesiumWidget: { screenSpaceEventHandler: { removeInputAction: () => {} } },
        scene: { postProcessStages: { fxaa: {} }, globe: {}, canvas: {} },
        canvas: { addEventListener: () => {} },
        camera: {
          setView: () => {},
          moveEnd: { addEventListener: () => {} },
          changed: { addEventListener: () => {} }
        },
        entities: {
          add: () => ({}),
          remove: () => {}
        }
      };
    },
    Math: { toRadians: () => 0, toDegrees: () => 0 },
    ScreenSpaceEventType: { LEFT_DOUBLE_CLICK: 0, LEFT_CLICK: 1 },
    ScreenSpaceEventHandler: function() {
      return { setInputAction: () => {} };
    },
    createWorldTerrainAsync: () => Promise.resolve({}),
    Cartesian3: { fromDegrees: () => ({}) },
    Cartesian2: function() {},
    Color: {
      RED: { withAlpha: () => {} },
      ORANGE: { withAlpha: () => {} },
      GOLD: {},
      WHITE: {},
      BLACK: {},
      fromCssColorString: () => ({ withAlpha: () => {} })
    },
    PolylineDashMaterialProperty: function() {},
    HeightReference: { CLAMP_TO_GROUND: {} },
    VerticalOrigin: { CENTER: {}, BOTTOM: {} },
    HorizontalOrigin: { CENTER: {} },
    CallbackProperty: function() {}
  };

  const context = vm.createContext({
    document: mockDocument,
    window: mockWindow,
    Cesium: mockCesium,
    console: {
      log: console.log,
      warn: console.warn,
      error: console.error
    },
    fetch: (url) => {
      const isPois = url.includes('pois.json');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(isPois ? [] : { main: [], secondary: [], main_flight: [] })
      });
    },
    setTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {}
  });

  console.log('Running extracted JS in mocked context...');
  vm.runInContext(scriptContent, context);
  console.log('VM execution completed. Checking for initialization errors...');
  
  // Try calling init() to check for runtime errors during app start
  if (typeof context.init === 'function') {
    context.init().then(() => {
      console.log('SUCCESS: init() completed with no runtime errors!');
    }).catch(err => {
      console.error('RUNTIME ERROR inside init():', err);
    });
  } else {
    console.error('init function not found on context');
  }

} catch (e) {
  console.error('VM CRASHED during evaluation:', e);
}
