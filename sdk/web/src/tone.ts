// raea/tone in a browser page (docs/web-export.md "Sound"): Tone.js itself, plays through Web Audio as the game runs,
// plus raea's own additions with the same names: buses, vary and <Sfx>. What only raea's native mix makes (generated
// foley and instruments: sao, tokensynth, lyria, fish, fire) isn't here; a page that calls one gets an error naming it.
// export-three.ts maps `raea/tone` here.
import { useLayoutEffect, type ReactNode } from "react";
import * as T from "tone";

export * from "tone";

/**
 * raea levels a game's mix to its <Mix lufs> (-14 by default), lifting what a game's own chain keeps quiet. A page has
 * no such pass: the buses add a fixed lift, and a limiter on the way out keeps the peaks under the ceiling.
 */
const LIFT_DB = 6;
const CEILING_DB = -1.5;

let out: T.Limiter | null = null;
const master = () => (out ??= new T.Limiter(CEILING_DB).toDestination());
const named = new Map<string, T.Channel>();

/** a named bus into the master */
export function bus(name: string): T.Channel {
  let b = named.get(name);
  if (!b) {
    b = new T.Channel({ volume: LIFT_DB }).connect(master());
    named.set(name, b);
  }
  return b;
}

export const buses = {
  get music() {
    return bus("music");
  },
  get sfx() {
    return bus("sfx");
  },
  get voice() {
    return bus("voice");
  },
  get ambience() {
    return bus("ambience");
  },
  get ui() {
    return bus("ui");
  },
};

type Playable = { volume: T.Param<"decibels">; triggerAttackRelease: (...args: never[]) => unknown };

/** each event's own jitter: pitch in semitones, volume in dB */
export function vary<I extends Playable>(instrument: I, v: { pitch?: number; volume?: number }): I {
  const play = instrument.triggerAttackRelease.bind(instrument) as (...args: unknown[]) => unknown;
  const base = instrument.volume.value;
  const jitter = (range = 0) => (Math.random() * 2 - 1) * range;
  (instrument as { triggerAttackRelease: unknown }).triggerAttackRelease = (...args: unknown[]) => {
    // (note, duration, time) or (duration, time): the time is the last number after the first argument
    const time = args.slice(1).filter((a): a is number => typeof a === "number").at(-1);
    instrument.volume.setValueAtTime(base + jitter(v.volume), time ?? T.now());
    if (typeof args[0] === "string" && v.pitch) args[0] = T.Frequency(args[0] as string).transpose(jitter(v.pitch)).toFrequency();
    return play(...args);
  };
  return instrument;
}

/** a game's one-shot: `play(time)` on each frame `when` holds, once the page may make sound */
export function Sfx({ when, play }: { when: boolean | number | null | undefined; play: (time: number, frame: number) => void; name?: string }): ReactNode {
  useLayoutEffect(() => {
    if (!when || T.getContext().state !== "running") return;
    play(T.now() + 0.03, 0);
  });
  return null;
}

/** raea's render marks where Tone's events go; a page plays them as they happen */
export function ToneOut(): ReactNode {
  return null;
}

const native = (name: string) => () => {
  throw new Error(`raea/tone: ${name} is made by raea's native mix and isn't in a web page`);
};
export const tokensynth = native("tokensynth");
export const sao = native("sao");
export const lyria = native("lyria");
export const fish = native("fish");
export const fire = native("fire");
export const snapshot = native("snapshot");
export const reset = () => {};

/** sound starts on the first gesture (a key, a click, a finger lifted) */
export function startOnGesture() {
  const go = () => {
    if (T.getContext().state === "running") return;
    void T.start();
  };
  for (const e of ["keydown", "pointerup", "touchend"]) addEventListener(e, go, { passive: true });
}
