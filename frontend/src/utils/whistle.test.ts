import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("resumes audio on the gesture and schedules both whistles on the same context", async () => {
  vi.stubGlobal("Audio", undefined);
  const start = vi.fn();
  const context = {
    state: "suspended",
    currentTime: 10,
    destination: {},
    resume: vi.fn(async () => { context.state = "running"; }),
    decodeAudioData: vi.fn(async (data) => data),
    createBufferSource: vi.fn(() => ({ buffer: null, connect: vi.fn(), start })),
  };
  const AudioContext = vi.fn(function () { return context; });
  const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  vi.stubGlobal("AudioContext", AudioContext);
  vi.stubGlobal("fetch", fetch);
  const { unlockWhistles, playHalfTimeWhistle, playFinalWhistle } = await import("./whistle");

  playHalfTimeWhistle();
  expect(AudioContext).not.toHaveBeenCalled();
  unlockWhistles();
  expect(context.resume).toHaveBeenCalledOnce();
  expect(context.resume).toHaveBeenCalledBefore(fetch);
  expect(fetch.mock.calls).toEqual([["/sounds/whistle-short.mp3"], ["/sounds/whistle-long.mp3"]]);

  playHalfTimeWhistle();
  playFinalWhistle();
  await vi.waitFor(() => expect(start.mock.calls).toEqual([[10], [10.45], [10]]));

  context.state = "interrupted";
  unlockWhistles();
  expect(AudioContext).toHaveBeenCalledOnce();
  expect(context.resume).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("keeps the clock gesture safe when constructing an audio context fails", async () => {
  vi.stubGlobal("Audio", undefined);
  vi.stubGlobal("AudioContext", vi.fn(function () { throw new Error("Audio unavailable"); }));
  const { unlockWhistles } = await import("./whistle");
  expect(unlockWhistles).not.toThrow();
});

it("requests playback audio and restores the previous session on exit", async () => {
  const session = { type: "auto" };
  vi.stubGlobal("navigator", { audioSession: session });
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("Audio", undefined);
  const { unlockWhistles, releaseWhistles } = await import("./whistle");
  unlockWhistles();
  expect(session.type).toBe("playback");
  unlockWhistles();
  releaseWhistles();
  expect(session.type).toBe("auto");
});

it("primes media during the gesture and falls back when Web Audio is unavailable", async () => {
  const elements: { muted: boolean; currentTime: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("Audio", vi.fn(function () {
    const element = { muted: false, currentTime: 0, play: vi.fn(async () => {}), pause: vi.fn() };
    elements.push(element);
    return element;
  }));
  vi.stubGlobal("AudioContext", undefined);
  const { unlockWhistles, playHalfTimeWhistle, previewWhistle } = await import("./whistle");
  unlockWhistles();
  expect(elements[0].muted).toBe(true);
  expect(elements[0].play).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(elements[0].muted).toBe(false);
  expect(elements[0].pause).toHaveBeenCalledOnce();
  vi.useFakeTimers();
  playHalfTimeWhistle();
  expect(elements[0].play).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(450);
  expect(elements[0].play).toHaveBeenCalledTimes(3);
  previewWhistle();
  expect(elements[0].play).toHaveBeenCalledTimes(4);
  vi.clearAllTimers();
  vi.useRealTimers();
});
