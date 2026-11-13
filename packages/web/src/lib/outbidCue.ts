/**
 * The "you've been outbid" cue: a short chime, a flash + shake of the live panel, and a tab title
 * change when the page is in the background. The task asks for a sound or visual cue only for
 * being outbid, so this is the only place the app makes a sound.
 */

const SOUND_KEY = "auction-house:sound";

let audio: AudioContext | null = null;

/**
 * Browsers only allow audio after a user gesture. Anyone who can be outbid has already clicked
 * (joined, placed a bid), so the context is created/resumed on the first pointer or key press.
 */
function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null; // Web Audio unavailable: the visual cue still works
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
  window.addEventListener("keydown", unlockAudio, { once: true, capture: true });
}

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
  } catch {
    // preference then only lasts for this page load
  }
  if (enabled) unlockAudio(); // toggling is itself a user gesture
}

/** Two descending sine tones ("ding-dong"), ~0.5 s, synthesised — no audio file needed. */
export function playOutbidSound(): void {
  if (!isSoundEnabled() || !audio || audio.state !== "running") return;
  const start = audio.currentTime;
  [880, 660].forEach((frequency, i) => {
    const t = start + i * 0.16;
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  });
}

/** Orange glow pulse, plus a short shake unless the user prefers reduced motion. */
export function flashElement(element: HTMLElement | null): void {
  if (!element || typeof element.animate !== "function") return;
  element.animate(
    [
      { boxShadow: "0 0 0 0 rgb(255 149 0 / 0)" },
      { boxShadow: "0 0 0 6px rgb(255 149 0 / 0.55)", offset: 0.15 },
      { boxShadow: "0 0 0 0 rgb(255 149 0 / 0)", offset: 0.5 },
      { boxShadow: "0 0 0 6px rgb(255 149 0 / 0.4)", offset: 0.65 },
      { boxShadow: "0 0 0 0 rgb(255 149 0 / 0)" },
    ],
    { duration: 1400, easing: "ease-out" },
  );
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(4px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 450, easing: "ease-in-out" },
  );
}

/** While the tab is in the background, show "⚠ Outbid!" in its title until the user comes back. */
export function flagTabTitle(): void {
  if (!document.hidden || document.title.startsWith("⚠")) return;
  const original = document.title;
  document.title = `⚠ Outbid! · ${original}`;
  const restore = () => {
    if (document.hidden) return;
    document.title = original;
    document.removeEventListener("visibilitychange", restore);
  };
  document.addEventListener("visibilitychange", restore);
}
