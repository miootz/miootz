/** Match whistle sounds (Pixabay, royalty-free). */

const WHISTLE_SHORT = "/sounds/whistle-short.mp3";
const WHISTLE_LONG = "/sounds/whistle-long.mp3";

let audio: AudioContext | undefined;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function loadWhistle(context: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;
  const loading = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Could not load whistle (${response.status})`);
    return context.decodeAudioData(await response.arrayBuffer());
  }).catch(() => {
    buffers.delete(url);
    return null;
  });
  buffers.set(url, loading);
  return loading;
}

/** Call directly from the Start or Resume gesture, before any network request. */
export function unlockWhistles(): void {
  if (typeof AudioContext === "undefined") return;
  try {
    audio ??= new AudioContext();
    if (audio.state !== "running") void audio.resume().catch(() => {});
    void loadWhistle(audio, WHISTLE_SHORT);
    void loadWhistle(audio, WHISTLE_LONG);
  } catch {
    // An unavailable audio device must never prevent the clock from starting.
  }
}

function playWhistle(url: string, offsets: number[]): void {
  const context = audio;
  if (!context || context.state !== "running") return;
  void loadWhistle(context, url).then((buffer) => {
    if (!buffer || context.state !== "running") return;
    const start = context.currentTime;
    for (const delay of offsets) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(start + delay);
    }
  }).catch(() => {});
}

/** Half-time: short whistle, twice. */
export function playHalfTimeWhistle(): void {
  playWhistle(WHISTLE_SHORT, [0, 0.45]);
}

/** Full-time: long whistle, once. */
export function playFinalWhistle(): void {
  playWhistle(WHISTLE_LONG, [0]);
}
