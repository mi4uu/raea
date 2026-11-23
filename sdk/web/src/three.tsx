// raea in a browser page on three.js (docs/web-export.md "three.js as a second, light web host"): a registered
// composition played live as play() plays it, its React in the browser and its page as real DOM, but its 3D drawn by
// three.js on WebGL through raea's own three.js host (sdk/r3f/src/three: Scene3d, and Effects for the frame effects and
// Bevy's TonyMcMapface curve). No wasm and no WebGPU: it runs wherever WebGL does, phones included. What three.js
// can't draw (r3f/src/three/kinds.ts "engine": Bevy's shaders, volumetric fog) is named in the console and left out;
// such a page needs raea-web (play()).
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import { Clock, getCompositions, type InputTimeline, type RegisteredComposition } from "raea";
import { Scene3d } from "@raea/r3f/three/scene";
import { Effects } from "@raea/r3f/three/effects";
import { UNDER3D_CSS, clearUnder3d } from "./collect";
import { Input, TouchPad, type TouchOptions } from "./input";

export interface ThreePlayOptions {
  /** where it plays: filled by the canvas and the page over it */
  stage: HTMLElement;
  /** the composition's id (else the first registered) */
  composition?: string;
  /** hold this one frame instead of playing (a poster, or a frame to compare with `raea render --frame N`) */
  hold?: number;
  /** a game: frames run on past the composition's length instead of looping back to its start (true by default) */
  endless?: boolean;
  /** Bevy's TonyMcMapface curve, drawn in a pass after the scene (true, raea's look); false draws three's AgX, its
   *  nearest, with no extra pass (lighter for slow phones) */
  tony?: boolean;
  /** the pixel ratio, at most (2 by default) */
  maxPixelRatio?: number;
  /** an on-screen stick and buttons on touch screens, read as a gamepad (false: none) */
  touch?: TouchOptions | false;
  /** a small counter in the corner: frames a second and the ms each takes to draw */
  fps?: boolean;
  onFirstFrame?: () => void;
  onError?: (e: unknown) => void;
}

export interface ThreePlaying {
  stop(): void;
  /** frames drawn and the time each took to draw */
  stats(): { frames: number; msPerFrame: number };
  /** the host's three.js scene, renderer and camera, for poking at from a console */
  readonly three: { scene: THREE.Scene; renderer: THREE.WebGLRenderer; host: Scene3d };
}

/** frames a game runs before its fold wraps: a day at 60 fps */
const ENDLESS = 60 * 60 * 60 * 24;

/** Plays the registered composition in `stage`, drawn by three.js. */
export function playThree(o: ThreePlayOptions): ThreePlaying {
  const comps = getCompositions();
  if (!comps.length) throw new Error("raea web: the edit registered no composition (registerRoot)");
  const comp: RegisteredComposition = (o.composition ? comps.find((c) => c.id === o.composition) : comps[0]) ?? (() => { throw new Error(`raea web: no composition "${o.composition}" (${comps.map((c) => c.id).join(", ")})`); })();
  const length = o.endless === false ? comp.durationInFrames : Math.max(comp.durationInFrames, ENDLESS);
  const tony = o.tony !== false;

  const style = document.createElement("style");
  style.textContent = `${UNDER3D_CSS}.raea-three-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}.raea-three-page{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}`;
  document.head.append(style);
  const canvas = document.createElement("canvas");
  canvas.className = "raea-three-canvas";
  const page = document.createElement("div");
  page.className = "raea-three-page";
  o.stage.append(canvas, page);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const host = new Scene3d();
  host.settings.tony = tony;
  const composer = new Effects(renderer);
  let width = 1;
  let height = 1;
  /** the page's box in composition pixels (the stage's shape) */
  let pageW = comp.width;
  let pageH = comp.height;
  const fit = () => {
    const r = o.stage.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    renderer.setPixelRatio(Math.min(o.maxPixelRatio ?? 2, devicePixelRatio || 1));
    renderer.setSize(width, height, false);
    // the page is laid out in the composition's pixels and scaled to fit the stage, so a HUD written for 1920x1080
    // keeps its proportions on a phone; its box takes the stage's shape, so what's pinned to an edge stays on it
    const s = Math.min(width / comp.width, height / comp.height);
    pageW = width / s;
    pageH = height / s;
    page.style.width = `${pageW}px`;
    page.style.height = `${pageH}px`;
    page.style.transform = `scale(${s})`;
  };
  fit();
  const resized = new ResizeObserver(fit);
  resized.observe(o.stage);

  // the pointer in the page's own pixels
  const input = new Input(o.stage, () => ({ width: pageW, height: pageH }));
  if (o.touch && matchMedia("(pointer: coarse)").matches) input.touch = new TouchPad(o.stage, o.touch);
  const meter = o.fps ? fpsMeter(o.stage) : undefined;
  const root = createRoot(page);
  const timeline: InputTimeline = {};
  const C = comp.component;
  const hold = o.hold === undefined ? undefined : Math.max(0, Math.floor(o.hold));
  // a held frame is the one a game reaches with nobody playing: its earlier frames have no input
  let frame = hold ?? 0;
  let last = performance.now(), acc = 0, raf = 0, stopped = false, first = false;
  let drawn = 0, spent = 0;
  let under: THREE.Color | undefined;

  const draw = (dt: number) => {
    flushSync(() =>
      root.render(
        <Clock frame={frame} fps={comp.fps} width={comp.width} height={comp.height} durationInFrames={length} input={timeline} defaultProps={comp.defaultProps}>
          <C {...comp.defaultProps} />
        </Clock>,
      ),
    );
    const t0 = performance.now();
    host.sync(page, frame / comp.fps);
    // the page's own background behind its 3D, which raea's engine clears to; the page's element is see-through
    const clear = clearUnder3d(page);
    if (!host.scene.background || host.scene.background === under) {
      under = clear ? (under ?? new THREE.Color()).setStyle(clear) : undefined;
      host.scene.background = under ?? null;
    }
    host.fit(width, height);
    host.apply(renderer);
    if (!tony && host.settings.toneMapping === THREE.AgXToneMapping) renderer.toneMapping = THREE.AgXToneMapping;
    const cam = host.camera;
    const on = composer.set(host.effects, host.scene, cam, width, height, (cam.userData.focus as number) ?? 10, tony && host.settings.tony);
    if (on) composer.render(host.scene, dt);
    else renderer.render(host.scene, cam);
    if (host.any) {
      drawn++;
      spent += performance.now() - t0;
      if (!first) {
        first = true;
        o.onFirstFrame?.();
      }
    }
  };
  // something loaded later (a model, a panorama): draw the frame again
  host.onLoad = () => {
    if (!stopped) draw(0);
  };

  const tick = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    meter?.frame(now, drawn ? spent / drawn : 0);
    const step = 1000 / comp.fps;
    const elapsed = Math.min(250, now - last);
    acc += elapsed;
    last = now;
    let stepped = !first;
    while (hold === undefined && acc >= step) {
      acc -= step;
      timeline[frame] = input.now();
      frame = (frame + 1) % length;
      delete timeline[frame];
      stepped = true;
    }
    if (hold !== undefined) acc = 0;
    if (!stepped) return;
    try {
      draw(elapsed / 1000);
    } catch (e) {
      stopped = true;
      cancelAnimationFrame(raf);
      if (o.onError) o.onError(e);
      else throw e;
    }
  };
  raf = requestAnimationFrame(tick);

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    resized.disconnect();
    root.unmount();
    composer.dispose();
    renderer.dispose();
    input.touch?.el.remove();
    meter?.el.remove();
    canvas.remove();
    page.remove();
    style.remove();
  }
  return { stop, stats: () => ({ frames: drawn, msPerFrame: drawn ? spent / drawn : 0 }), three: { scene: host.scene, renderer, host } };
}

/** frames a second, counted over each half second, and the mean time a frame takes to draw */
function fpsMeter(stage: HTMLElement) {
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;left:8px;bottom:8px;z-index:3;font:600 12px ui-monospace,monospace;color:#fff;background:#000a;padding:3px 7px;border-radius:4px;pointer-events:none";
  stage.append(el);
  let since = performance.now();
  let frames = 0;
  return {
    el,
    frame(now: number, ms: number) {
      frames++;
      if (now - since < 500) return;
      el.textContent = `${Math.round((frames * 1000) / (now - since))} fps · ${ms.toFixed(1)} ms`;
      since = now;
      frames = 0;
    },
  };
}
