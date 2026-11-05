/** Match whistle sounds (Pixabay, royalty-free). */

const WHISTLE_SHORT = "/sounds/whistle-short.mp3";
const WHISTLE_LONG = "/sounds/whistle-long.mp3";

function blast(src: string): void {
  const a = new Audio(src);
  a.currentTime = 0;
  void a.play().catch(() => {}); // autoplay can be blocked pre-gesture — ignore
}

/** Half-time: short whistle, twice. */
export function playHalfTimeWhistle(): void {
  blast(WHISTLE_SHORT);
  window.setTimeout(() => blast(WHISTLE_SHORT), 450);
}

/** Full-time: long whistle, once. */
export function playFinalWhistle(): void {
  blast(WHISTLE_LONG);
}
