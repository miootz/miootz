import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("resumes audio on the gesture and schedules both whistles on the same context", async () => {
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
  vi.stubGlobal("AudioContext", vi.fn(function () { throw new Error("Audio unavailable"); }));
  const { unlockWhistles } = await import("./whistle");
  expect(unlockWhistles).not.toThrow();
});
