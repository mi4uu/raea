# Games on the web: WebAssembly and WebGPU

A raea game, played in a browser tab: the same edit.tsx, the same fold, the same rows, drawn by the same engine.

## The shape of it

On the Mac a game runs as React inside JavaScriptCore, its page painted by Blitz and its 3D drawn by raea-render's engine on
Bevy, both on the GPU. In a browser most of that is already there:

- **React runs in the browser's own JavaScript engine.** The game's bundle is a normal React app; its page (titles,
  keycaps, captions in the DOM) is real DOM, laid out and painted by the browser.
- **The 3D is raea-render's engine, compiled to WebAssembly, on WebGPU.** It draws into a canvas behind the page. Bevy and wgpu
  both target wasm32 and WebGPU.
- **The 3D gets each frame's scene the way live play gives it** (runtime/scene LiveScene): the frame's
  3D parts, read from the page (every `<div data-3d>` the SDK's components render), turned into rows, and only what
  changed set on the engine (Engine::set_rows, remove_rows, draw).
- **Sound is Web Audio.** raea/tone is Tone.js's API already: in the browser it is Tone.js, with the instruments
  and foley the export generated (TokenSynth, SAO) as files beside the page.
- **The narrator is pre-spoken.** Pocket TTS in a tab is a download of hundreds of megabytes. The export says every
  line the game can say (each line from each place it can be resumed after an interruption, each aside at each of its
  takes) and ships them with their word timings, so `speechAt` answers from the file.

What stays native-only: Blitz and Stylo (the page is the browser's), the media stack (decode, encode, VideoToolbox),
the mixer, Core ML and ONNX Runtime, SQLite and the native calls, the GPU kernels and the readback.

## Milestones

1. **raea-render's 3D engine builds for wasm32.** A `native` feature (on by default) carries the page engine (raea), media,
   mixer, GPU kernel, gputrace and everything that only exists to render or analyse on the Mac; without it, raea-render is the
   relational core and the 3D engine (rows, timeline, scene3d, materials, models, skinning, fog, outlines).
   Done when `cargo check -p raea-render --target wasm32-unknown-unknown --no-default-features --features web` passes.
2. **raea-web**: a wasm-bindgen crate opening Engine::new_live on a WebGPU canvas, with open / setRows / removeRows /
   draw from JavaScript, and LiveScene (frame items to rows) moved where both raea-runtime-react and raea-web can use it.
3. **The browser runtime of raea**: the clock (a fixed 60 steps a second off requestAnimationFrame, so a fold
   steps as it does natively), useGameState, useInput (keys, the pointer), staticFile (the export's asset URLs),
   Composition and registerRoot, and the 3D components' frame collected from the DOM each step.
4. **Sound and speech**: raea/tone as Tone.js with the exported samples; raea/speech from the
   pre-spoken lines and their timings.
5. **`raea export-web EDIT.tsx -o DIR`**: index.html, the bundle, raea_web.wasm and the assets, ready for any
   static host. The Hero's Journey at raea.io/play.

## Notes

- Use rustup's toolchain for wasm (`~/.cargo/bin/cargo`): Homebrew's rustc comes first on PATH here and has no
  wasm32 standard library.
- A browser gives WebGPU on recent Chrome, Edge and Safari; the export should say so on a browser without it rather
  than fall back to a slower path.

## Rows are the contract; Bevy is the reference

The page and the engine agree on rows, nothing else: the page's `data-3d` parts become rows (runtime/scene's LiveScene,
the same code native live play runs), and raea-web sets them on raea-render as the native engine does. So a frame in
a browser is the frame `raea render` draws, and Bevy's own examples stay the reference for what a row means (docs/
control.feature). Any other host that draws rows is a host of the same edits.

## Measured (meadow-low, 11-06)

Chrome on the M5 Pro Mac, headless (tools in the site lab: webshot.ts), the meadow's composition at 1920x1080 with its
paint look's 4 px cells:

| | before | now | budget |
|---|---|---|---|
| raea_web.wasm, wasm-opt'd and brotli'd | 10.3 MB | 7.9 MB | 8 MB |
| first live frame | 4.8 s | 1.3-1.5 s | 3 s |
| a frame | 219 ms | 14-17 ms | 16.7 ms (60 fps) |

What got it there, biggest first:

- **Clouds baked into cards.** A `<Volume>` cloud simulates and raymarches every frame (two thirds of a frame here, and
  the 4 s of simulation before the first). Each cloud is rendered once natively, lit and in the look, as meadow-low's
  camera sees it, and the page shows the picture on an `<ImagePlane cutout>` facing the camera: no surface where it's
  clear, a shadow in its shape.
- **A mesh's vertex data written once.** `<BufferMesh>` checked and wrote its arrays as text every React render (half
  a frame for a terrain and its flowers); it's kept per mesh's arrays now.
- **Drawn at the look's cell size.** `play({ pixel: 4 })` draws at a quarter of the composition's size, a `<Look>`'s
  cell becomes one drawn pixel, and the canvas is that size, scaled up by the browser with hard pixels
  (`image-rendering: pixelated`): the GPU shades a sixteenth of the pixels and blits nothing.
- **One shadow cascade** (`<Shadows cascades={1}>`), for phones.
- **The web profile** (root Cargo.toml): opt-level s, fat LTO, one codegen unit, abort, stripped. z is 7.2 MB but its
  frames are 6x slower (the ECS's systems want inlining); 3 is 9.0 MB at the same frame as s. Bevy's built-in font,
  JPEG, SMAA's and area lights' tables and gamepads are raea-render's `native` features, so a page goes without them.

A browser frame against `raea render --frame 0` of the same composition (`play({ hold: 0 })`, both box-filtered to
480x270, the page's labels cropped off): SSIM 0.9985 drawn at the composition's size (`pixel: 1`), so the engine in a
page draws what it draws natively; 0.903 at `pixel: 4`, where a cell is one drawn pixel instead of the mean of 4x4
(the same scene, framing and light; the grass's texture is sampled differently).

Still to measure: an iPad in Safari (30 fps) and the poster's first paint (1.5 s).

## raea's own kinds in the browser

The kinds three.js can't draw (sdk/r3f/src/three/kinds.ts "engine": SurfaceShader, FramePass, Compute, BevyComponent,
BevyResource, VolumetricFog, FogVolume) and <Entities> are drawn here by raea's own engine. `sdk/web/tools/parity.sh`
renders each case in sdk/web/test/parity with `raea render` and with raea-web in headless Chrome on WebGPU and compares
them by SSIM: all seven at least 0.976, five at 0.9998 or more (docs/r3f.feature R3F10). A page's files (a glTF, a
picture) are fetched from `assets/` beside the page, Bevy's asset folder on the web. Each GitHub release carries
raea-web's module (`raea_web.js`, `raea_web_bg.wasm`), built by tools/release-web.sh.

## Sound

In a page raea/tone is Tone.js (the page's bundler maps `raea/tone` to `tone`), so an edit's sound is written once in
Tone's API: a render mixes it on raea's core, a page plays it through Web Audio. A browser starts audio only after a
gesture, and a touch counts as one only when the finger lifts (pointerup, touchend), never on pointerdown: the page
starts Tone on any of them and keeps listening until the context runs. The meadow's bed (wind and birds) is
site-lab/raea/chair/meadow-sound.ts.

Two gaps of raea/tone against Tone.js, found writing it (worked around there, to build properly):

- A ramp starts at its callback's time, not at the event before it, so several ramps scheduled in one callback start
  together and the last wins.
- A Synth's `frequency` automation doesn't move a note that's sounding (the chirps' sweeps are MembraneSynth's own).

## three.js: the light web host

`playThree` (sdk/web/src/three.tsx) plays a composition as `play` does, with the same Clock, input and fold, but its
3D is drawn by three.js on WebGL through raea's own three.js host (sdk/r3f/src/three: Scene3d, and Effects for the
frame effects and Bevy's TonyMcMapface table). It needs no wasm and no WebGPU, so it plays wherever WebGL does,
phones included. What three.js can't draw (kinds.ts "engine": Bevy's shaders, volumetric fog) is named in the console
and left out; such an edit needs raea-web.

```sh
bun sdk/web/tools/export-three.ts EDIT.tsx -o DIR [--composition ID] [--title TITLE]
    [--touch "Paw:West,Jump:South,Run:RightTrigger2"] [--corner "↻:Start"] [--no-touch] [--no-tony] [--fps] [--serve [PORT]]
```

It writes a static page:

- `index.html`
- one minified `game.js`, carrying a single copy each of three, React and Tone.js
- the project's `assets/`
- `LICENSE-raea.md` and `NOTICE.txt`

The page takes four query parameters:

| Parameter | What it does |
|---|---|
| `?frame=N` | Holds that frame, to compare with `raea render --frame N` |
| `?tony=0` | Uses three's AgX curve with no extra pass, for slow phones |
| `?fps=1` / `?fps=0` | Shows or hides the frame counter (on by default with `--fps`) |

- **The page is laid out in the composition's pixels.** It is scaled to fit the stage, and its box takes the stage's
  shape, so a HUD written for 1920x1080 keeps its proportions on a phone and what is pinned to an edge stays on it.
- **Input** comes from sdk/web/src/input.ts: keys, the pointer in the page's pixels, and the first gamepad. On a touch
  screen, `--touch` adds an on-screen stick (the left half of the screen) and buttons, read as that gamepad, so a game
  written for a pad plays on a phone unchanged.
- **Sound.** `raea/tone` is Tone.js plus raea's `bus`, `buses`, `vary` and `<Sfx>` (sdk/web/src/tone.ts). The buses
  lift what <Mix> would level, into a limiter at the mix's ceiling.

Measured 11-23 on a game (Cat Planet: a vertex-coloured kitten of ~8,000 fur tufts, 62 props, instanced trees,
furniture, grass and flowers) in Chrome on the M5 Pro Mac at 1920x1080:

- **Frames 60 and 900 against `raea render --frame`.** Mean luma 0.397 against 0.393, and 0.384 against 0.380. The
  HUD's text is identical, and so are the game's state after 900 folded frames and the camera.
- **Speed.** 120 fps, with 1.2 ms of CPU a frame for the sync and draw.
- **Size.** `game.js` is 599 KB gzipped, against raea-web's 7.9 MB of wasm.

Writing it found three things, each fixed here:

- **raea-web drew no <Instances> copies.** sdk/web's collector never sent an element's `data-at`, and
  engine/web/src/scene.rs set every part's `at` to None. Both now carry the placements, as `s` carries a shape: sent
  when it changes and kept by id.
- **Scene3d rolled a camera whose up isn't +Y.** It placed the camera by `lookAt` alone; it now takes Camera3d's
  `rotation` when the page gives it.
- **sdk/web imported `@raea/playable/host/input`,** which isn't in this repo. sdk/web/src/input.ts is that input.

## Next

- **R3F both ways.** Authoring in React Three Fiber compiled to rows, so an R3F scene plays on raea's engines; and an
  edit exported back out as R3F components, so a team can take a raea scene into its own three.js app. One edit,
  several targets.
