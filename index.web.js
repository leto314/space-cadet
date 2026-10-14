import registerRootComponent from "expo/src/launch/registerRootComponent";
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web/LoadSkiaWeb";

// Metro picks this file over index.js when bundling for web (standard .web.js platform resolution), so none of
// this — nor canvaskit-wasm — is ever pulled into the native (iOS/Android/Expo Go) bundle.
//
// react-native-skia's web build binds its entire `Skia` API object to `global.CanvasKit` at MODULE IMPORT TIME
// (see Skia.web.js: `export const Skia = JsiSkApi(global.CanvasKit)`) — a one-shot read, not a live reference.
// So the WASM must finish loading and set `global.CanvasKit` BEFORE anything that imports the skia package
// (App -> HomeScreen -> GlowCard) is ever required, or every draw call becomes a silent no-op forever. That's
// why `./App` is require()'d lazily below instead of statically imported at the top of this file.
async function start() {
  await LoadSkiaWeb({ locateFile: (file) => `https://unpkg.com/canvaskit-wasm@0.41.0/bin/full/${file}` });
  const App = require("./App").default;
  registerRootComponent(App);
}

start();
