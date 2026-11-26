/** Match whistle sounds (Pixabay, royalty-free). */

const WHISTLE_SHORT = "/sounds/whistle-short.mp3";
const WHISTLE_LONG = "/sounds/whistle-long.mp3";

type AudioSessionNavigator = Navigator & {
  audioSession?: { type: string };
};

let audio: AudioContext | undefined;
let previousSessionType: string | undefined;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
const media = new Map<string, HTMLAudioElement>();

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

/** Call synchronously from a referee gesture. */
export function unlockWhistles(): void {
  try {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session) {
      previousSessionType ??= session.type;
      session.type = "playback";
    }
  } catch { /* Audio Session is optional. */ }

  // Prime fallback media elements during the gesture so later playback can
  // use the same elements on browsers that restrict autoplay per element.
  if (typeof Audio !== "undefined") {
    for (const url of [WHISTLE_SHORT, WHISTLE_LONG]) {
      if (media.has(url)) continue;
      try {
        const element = new Audio(url);
        element.muted = true;
        media.set(url, element);
        void element.play().then(() => {
          if (element.muted) {
            element.pause();
            element.currentTime = 0;
            element.muted = false;
          }
        }).catch(() => { element.muted = false; });
      } catch { /* Audio is optional. */ }
    }
  }

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

/** Restore the browser's previous audio category after leaving match control. */
export function releaseWhistles(): void {
  try {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session && previousSessionType !== undefined) session.type = previousSessionType;
  } catch { /* Audio Session is optional. */ }
  previousSessionType = undefined;
}

function playMedia(url: string, offsets: number[]): void {
  const element = media.get(url);
  if (!element) return;
  for (const delay of offsets) {
    const play = () => {
      try {
        element.currentTime = 0;
        void element.play().catch(() => {});
      } catch { /* Playback is best-effort. */ }
    };
    if (delay === 0) play();
    else setTimeout(play, delay * 1000);
  }
}

function playWhistle(url: string, offsets: number[]): void {
  const context = audio;
  if (!context || context.state !== "running") {
    playMedia(url, offsets);
    return;
  }
  void loadWhistle(context, url).then((buffer) => {
    if (!buffer || context.state !== "running") {
      playMedia(url, offsets);
      return;
    }
    const start = context.currentTime;
    for (const delay of offsets) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(start + delay);
    }
  }).catch(() => playMedia(url, offsets));
}

/** Half-time: short whistle, twice. */
export function playHalfTimeWhistle(): void {
  playWhistle(WHISTLE_SHORT, [0, 0.45]);
}

/** Full-time: long whistle, once. */
export function playFinalWhistle(): void {
  playWhistle(WHISTLE_LONG, [0]);
}

/** Play a preview directly in the user's gesture, including when audio was interrupted. */
export function previewWhistle(): void {
  unlockWhistles();
  const element = media.get(WHISTLE_SHORT);
  if (element) {
    element.muted = false;
    playMedia(WHISTLE_SHORT, [0, 0.45]);
  } else {
    playHalfTimeWhistle();
  }
}
