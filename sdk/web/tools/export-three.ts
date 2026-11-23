// A raea composition as a static web page drawn by three.js (sdk/web/src/three.tsx): index.html, one game.js, the
// project's assets/ and the licences, for any static host. No wasm and no WebGPU, so it plays on phones.
//
//   bun sdk/web/tools/export-three.ts EDIT.tsx -o DIR [--composition ID] [--title TITLE]
//       [--touch "Jump:South,Paw:West,Run:RightTrigger2"] [--corner "↻:Start"] [--no-touch] [--no-tony] [--fps] [--serve [PORT]]
//
// The page takes ?frame=N (hold that frame, to compare with `raea render --frame N`), ?tony=0 (three's AgX curve, no
// extra pass) and ?fps=1 or ?fps=0 (the frame counter, on by default with --fps). `raea/tone` is Tone.js with raea's
// additions (src/tone.ts) and `raea/mix` passes its children through (src/mix.ts); three, react and tone come from the
// SDK's own copies, so the page carries one of each.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { BunPlugin } from "bun";

const SDK = resolve(import.meta.dir, "../..");
const RAEA = resolve(SDK, "..");

// ---- arguments

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  args.splice(i, 1);
  return true;
};
const value = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
};
const usage = `bun sdk/web/tools/export-three.ts EDIT.tsx -o DIR [--composition ID] [--title TITLE] [--touch "Label:Button,..."] [--corner "Label:Button"] [--no-touch] [--no-tony] [--fps] [--serve [PORT]]`;

const out = value("-o");
const composition = value("--composition");
const touchSpec = value("--touch") ?? "A:South,B:East";
const corner = value("--corner");
const noTouch = flag("--no-touch");
const noTony = flag("--no-tony");
const fps = flag("--fps");
let serve: number | undefined;
{
  const i = args.indexOf("--serve");
  if (i >= 0) {
    const p = Number(args[i + 1]);
    serve = Number.isInteger(p) && p > 0 ? p : 8790;
    args.splice(i, Number.isInteger(p) && p > 0 ? 2 : 1);
  }
}
const titleArg = value("--title");
const edit = args[0] && resolve(args[0]);
if (!edit || !out || args.length !== 1) {
  console.error(usage);
  process.exit(2);
}
if (!existsSync(edit)) throw new Error(`${edit}: no such file`);
const dir = resolve(out);
const project = projectOf(edit);
const title = titleArg ?? basename(edit).replace(/\.[jt]sx?$/, "");

/** the edit's project: the nearest folder above it with a package.json, a brief.ts or .git, else the edit's own */
function projectOf(file: string): string {
  for (let d = dirname(file); d !== dirname(d); d = dirname(d)) {
    if (["package.json", "brief.ts", ".git"].some((f) => existsSync(join(d, f)))) return d;
  }
  return dirname(file);
}

// ---- resolving raea's SDK as its tsconfig names it

const paths: Record<string, string[]> = JSON.parse(readFileSync(join(SDK, "tsconfig.base.json"), "utf8")).compilerOptions.paths;
const OWN: Record<string, string> = {
  "raea/tone": join(SDK, "web/src/tone.ts"),
  "raea/mix": join(SDK, "web/src/mix.ts"),
};
const EXTS = ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];
const file = (p: string) => EXTS.map((e) => p + e).find((c) => existsSync(c) && statSync(c).isFile());

function sdkPath(spec: string): string | undefined {
  if (OWN[spec]) return OWN[spec];
  if (paths[spec]) return file(join(SDK, paths[spec][0]));
  for (const [pat, [to]] of Object.entries(paths)) {
    if (!pat.endsWith("/*") || !spec.startsWith(pat.slice(0, -1))) continue;
    const hit = file(join(SDK, to.replace("*", spec.slice(pat.length - 1))));
    if (hit) return hit;
  }
}

const need = (pkg: string, from: string) => {
  try {
    return Bun.resolveSync(pkg, from);
  } catch {
    throw new Error(`${pkg} isn't installed in ${from}: run \`bun install\` there`);
  }
};

const resolver: BunPlugin = {
  name: "raea-three",
  setup(b) {
    b.onResolve({ filter: /^(raea|@raea\/[^/]+)(\/.*)?$/ }, (a) => {
      const p = sdkPath(a.path);
      if (!p) throw new Error(`can't resolve "${a.path}" in raea's SDK (from ${a.importer})`);
      return { path: p };
    });
    // one React, the SDK's own, for the edit and the host alike
    b.onResolve({ filter: /^(react|react-dom|scheduler)(\/.*)?$/ }, (a) => ({ path: need(a.path, join(SDK, "raea")) }));
    // one three, the version raea's three.js host is written against
    b.onResolve({ filter: /^three(\/.*)?$/ }, (a) => ({ path: need(a.path, join(SDK, "r3f")) }));
    b.onResolve({ filter: /^tone(\/.*)?$/ }, (a) => ({ path: need(a.path, join(SDK, "web")) }));
  },
};

// ---- the page

const options = {
  composition,
  tony: !noTony,
  fps: !!fps,
  touch: noTouch ? (false as const) : { buttons: touchButtonsOf(touchSpec), corner: corner ? touchButtonsOf(corner)[0] : undefined },
};

function touchButtonsOf(spec: string) {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [label, button] = s.split(":").map((x) => x.trim());
      if (!label || !button) throw new Error(`touch button "${s}": LABEL:BUTTON`);
      return { label, button };
    });
}

const ENTRY = `import ${JSON.stringify(edit)};
import { playThree } from "@raea/web/three";
import { startOnGesture } from "raea/tone";

const q = new URLSearchParams(location.search);
const status = document.getElementById("status");
const say = (t) => { status.textContent = t; status.style.display = t ? "block" : "none"; };
startOnGesture();
try {
  const o = ${JSON.stringify(options)};
  if (q.has("frame")) o.hold = Number(q.get("frame")) || 0;
  if (q.get("tony") === "0") o.tony = false;
  if (q.has("fps")) o.fps = q.get("fps") !== "0";
  window.raea = playThree({
    stage: document.getElementById("stage"),
    ...o,
    onFirstFrame: () => { say(""); document.body.dataset.ready = "1"; },
    onError: (e) => { say("The game stopped: " + String(e)); console.error(e); },
  });
} catch (e) {
  say("Couldn't start: " + String(e));
  console.error(e);
}
`;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>${title.replace(/[<&]/g, "")}</title>
<link rel="icon" href="data:,">
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;overscroll-behavior:none}
body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}
#stage{position:absolute;inset:0}
#status{position:absolute;left:16px;bottom:16px;color:#fff;font:14px system-ui,sans-serif;background:#0008;padding:8px 12px;border-radius:6px;white-space:pre-wrap;max-width:calc(100% - 56px)}
</style>
</head>
<body>
<div id="stage" tabindex="0"></div>
<div id="status">Loading…</div>
<script type="module" src="game.js"></script>
</body>
</html>
`;

// ---- build

const work = join(dir, ".build");
rmSync(dir, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const entry = join(work, "entry.js");
writeFileSync(entry, ENTRY);
const built = await Bun.build({
  entrypoints: [entry],
  target: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [resolver],
});
rmSync(work, { recursive: true, force: true });
if (!built.success) {
  console.error(built.logs.map(String).join("\n"));
  process.exit(1);
}
const js = await built.outputs[0].text();
writeFileSync(join(dir, "game.js"), js);
writeFileSync(join(dir, "index.html"), PAGE);
const assets = join(project, "assets");
if (existsSync(assets)) cpSync(assets, join(dir, "assets"), { recursive: true });
cpSync(join(RAEA, "LICENSE"), join(dir, "LICENSE-raea.md"));
writeFileSync(
  join(dir, "NOTICE.txt"),
  `This page is ${title}, made with raea (https://github.com/shinyobjectz/raea).

game.js carries parts of raea's SDK under the Functional Source License 1.1, ALv2 Future License (LICENSE-raea.md),
and these, each under the MIT licence:
  three.js (https://threejs.org), React (https://react.dev), Tone.js (https://tonejs.github.io),
  TonyMcMapface's table (Tomasz Stachowiak, https://github.com/h3r2tic/tony-mc-mapface).
`,
);

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`EXPORTED  ${dir}`);
console.log(`  game.js ${kb(js.length)} (gzip ${kb(gzipSync(js).length)})${existsSync(assets) ? `, assets/ from ${assets}` : ""}`);
console.log(`  composition ${composition ?? "(the first registered)"}, Tony ${options.tony ? "on" : "off"}, touch ${options.touch ? options.touch.buttons.map((b) => b.label).join(" ") : "off"}`);

// ---- serve

if (serve !== undefined) {
  const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", glb: "model/gltf-binary", gltf: "model/gltf+json", wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", woff2: "font/woff2", svg: "image/svg+xml", md: "text/markdown", txt: "text/plain" };
  const server = Bun.serve({
    port: serve,
    hostname: "0.0.0.0",
    async fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p.endsWith("/")) p += "index.html";
      const f = Bun.file(join(dir, p));
      if (!p.includes("..") && (await f.exists())) return new Response(f, { headers: { "content-type": TYPES[p.split(".").pop()!] ?? "application/octet-stream" } });
      return new Response("not found", { status: 404 });
    },
  });
  const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`SERVING   http://localhost:${server.port}${lan ? `  (on your network: http://${lan}:${server.port})` : ""}`);
}
