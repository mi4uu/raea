// The person's input as one frame's FrameInput (raea's Clock reads it through useGameState and useInput): keys held by
// their KeyboardEvent.key names, the primary pointer in composition pixels, and the first gamepad by Bevy's names. On a
// touch screen an on-screen stick and buttons stand in for that gamepad (TouchPad), so a game written for a pad plays
// on a phone unchanged. A key or button pressed and released between two frames still counts on the next.
import type { FrameInput } from "raea";

interface Comp {
  width: number;
  height: number;
}

type Pad = { buttons: string[]; axes: Record<string, number> };

// keys the page would otherwise scroll or act on
const SWALLOW = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

/** the standard gamepad mapping's buttons, by Bevy's GamepadButton names */
export const PAD_BUTTONS = ["South", "East", "West", "North", "LeftTrigger", "RightTrigger", "LeftTrigger2", "RightTrigger2", "Select", "Start", "LeftThumb", "RightThumb", "DPadUp", "DPadDown", "DPadLeft", "DPadRight", "Mode"];

/** a letter as one key whatever Shift did to it between keydown and keyup ("w" and "W") */
const keyOf = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

export class Input {
  private held = new Set<string>();
  private tapped = new Set<string>();
  private pointer?: { x: number; y: number; down: boolean };
  private pointerTapped = false;
  /** an on-screen pad, when the page made one */
  touch?: TouchPad;

  constructor(private stage: HTMLElement, private comp: () => Comp) {
    window.addEventListener("keydown", (e) => {
      if (SWALLOW.has(e.key)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(keyOf(e.key));
      this.tapped.add(keyOf(e.key));
    });
    window.addEventListener("keyup", (e) => this.held.delete(keyOf(e.key)));
    window.addEventListener("blur", () => {
      this.held.clear();
      if (this.pointer) this.pointer.down = false;
    });
    const at = (e: PointerEvent, down: boolean) => {
      const r = this.stage.getBoundingClientRect();
      const c = this.comp();
      this.pointer = { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height, down };
    };
    stage.addEventListener("pointerdown", (e) => {
      at(e, true);
      this.pointerTapped = true;
    });
    stage.addEventListener("pointermove", (e) => at(e, this.pointer?.down ?? false));
    window.addEventListener("pointerup", (e) => at(e, false));
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** this frame's input; call once a frame, as the frame is stepped */
  now(): Partial<FrameInput> {
    const out: Partial<FrameInput> & { live?: boolean } = { keys: [...new Set([...this.held, ...this.tapped])], live: true };
    this.tapped.clear();
    if (this.pointer) out.pointer = { ...this.pointer, down: this.pointer.down || this.pointerTapped };
    this.pointerTapped = false;
    const pad = this.touch?.now() ?? realPad();
    if (pad) out.gamepads = [pad] as FrameInput["gamepads"];
    return out;
  }
}

function realPad(): Pad | undefined {
  const pad = navigator.getGamepads?.().find((p) => p?.connected);
  if (!pad) return undefined;
  const buttons = pad.buttons.flatMap((b, i) => (b.pressed && PAD_BUTTONS[i] ? [PAD_BUTTONS[i]] : []));
  // the DOM's sticks are y down, Bevy's y up
  const axes = { LeftStickX: pad.axes[0] ?? 0, LeftStickY: -(pad.axes[1] ?? 0), RightStickX: pad.axes[2] ?? 0, RightStickY: -(pad.axes[3] ?? 0) };
  return { buttons, axes };
}

// ---- the on-screen pad

export interface TouchButton {
  /** what the button says */
  label: string;
  /** the gamepad button it presses, by Bevy's name (South, East, West, North, RightTrigger2, Start ...) */
  button: string;
}

export interface TouchOptions {
  /** the buttons on the right, the first the biggest; the left half of the screen is the stick */
  buttons: TouchButton[];
  /** a small button at the top middle, e.g. { label: "↻", button: "Start" } */
  corner?: TouchButton;
}

/** "Jump:South,Paw:West,Run:RightTrigger2" as buttons */
export function touchButtons(spec: string): TouchButton[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [label, button] = s.split(":").map((x) => x.trim());
      if (!label || !button || !PAD_BUTTONS.includes(button)) throw new Error(`touch button "${s}": LABEL:BUTTON, the button one of ${PAD_BUTTONS.join(", ")}`);
      return { label, button };
    });
}

const TOUCH_CSS = `.raea-touch{position:absolute;inset:0;pointer-events:none;z-index:2;-webkit-user-select:none;user-select:none}
.raea-touch .zone{position:absolute;left:0;top:0;bottom:0;width:50%;pointer-events:auto;touch-action:none}
.raea-touch .stick{position:fixed;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;background:rgba(20,18,40,.35);border:3px solid rgba(255,255,255,.45);opacity:0;transition:opacity .12s}
.raea-touch .stick.on{opacity:1}
.raea-touch .knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;background:rgba(255,255,255,.85)}
.raea-touch .buttons{position:absolute;right:max(20px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));display:flex;flex-direction:row-reverse;flex-wrap:wrap-reverse;gap:14px;align-items:flex-end;max-width:240px;pointer-events:auto}
.raea-touch button{font:800 17px system-ui,sans-serif;color:#fff;background:rgba(20,18,40,.75);border:3px solid rgba(255,255,255,.7);border-radius:50%;width:72px;height:72px;touch-action:none;padding:0}
.raea-touch button.big{width:96px;height:96px}
.raea-touch button.on{background:#ffd45e;color:#1b1838;border-color:#ffd45e}
.raea-touch .corner{position:absolute;top:max(14px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:52px;height:52px;pointer-events:auto}`;

/** An on-screen stick (wherever the left thumb lands) and buttons, read as a gamepad. */
export class TouchPad {
  readonly el: HTMLDivElement;
  private x = 0;
  private y = 0;
  private held = new Set<string>();
  private tapped = new Set<string>();

  constructor(stage: HTMLElement, o: TouchOptions) {
    const style = document.createElement("style");
    style.textContent = TOUCH_CSS;
    document.head.append(style);
    this.el = document.createElement("div");
    this.el.className = "raea-touch";
    this.el.innerHTML = `<div class="zone"><div class="stick"><div class="knob"></div></div></div><div class="buttons"></div>`;
    stage.append(this.el);

    const zone = this.el.querySelector<HTMLElement>(".zone")!;
    const base = this.el.querySelector<HTMLElement>(".stick")!;
    const knob = this.el.querySelector<HTMLElement>(".knob")!;
    const RADIUS = 56;
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    const move = (cx: number, cy: number) => {
      let dx = cx - ox;
      let dy = cy - oy;
      const d = Math.hypot(dx, dy);
      if (d > RADIUS) {
        dx *= RADIUS / d;
        dy *= RADIUS / d;
      }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      this.x = dx / RADIUS;
      // screen down is the stick's back (Bevy's y up)
      this.y = -dy / RADIUS;
    };
    zone.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (id !== null) return;
      id = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${ox}px`;
      base.style.top = `${oy}px`;
      base.classList.add("on");
      move(ox, oy);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId === id) move(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      this.x = this.y = 0;
      knob.style.transform = "";
      base.classList.remove("on");
    };
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);

    const row = this.el.querySelector<HTMLElement>(".buttons")!;
    o.buttons.forEach((b, i) => row.append(this.button(b, i === 0 ? "big" : "")));
    if (o.corner) this.el.append(this.button(o.corner, "corner"));
  }

  private button(b: TouchButton, cls: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.textContent = b.label;
    el.className = cls;
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      this.held.add(b.button);
      this.tapped.add(b.button);
      el.classList.add("on");
    });
    const up = () => {
      this.held.delete(b.button);
      el.classList.remove("on");
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return el;
  }

  /** the pad this frame, or undefined while nothing on it is touched (a real gamepad then counts) */
  now(): Pad | undefined {
    const buttons = [...new Set([...this.held, ...this.tapped])];
    this.tapped.clear();
    if (this.x === 0 && this.y === 0 && !buttons.length) return realPad();
    return { buttons, axes: { LeftStickX: this.x, LeftStickY: this.y, RightStickX: 0, RightStickY: 0 } };
  }
}
