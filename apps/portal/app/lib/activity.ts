// Tracks whether a person is actually using the portal, so background polling
// does not keep their session alive and the portal can warn before sign-out.
// Two timestamps matter: the last real input, and the last request the server
// counted as activity. Both are shared across tabs through localStorage.
const ACTIVE = "anvi-last-active";
const TOUCH = "anvi-last-touch";
// Requests this long after the last input are marked as background polling.
const GRACE_MS = 20_000;

let memoryActive = Date.now();
let memoryTouch = Date.now();
let lastWrite = 0;

function read(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}
function write(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Sharing activity between tabs is optional. */
  }
}

export const lastActive = () => Math.max(memoryActive, read(ACTIVE));
export const lastServerTouch = () => Math.max(memoryTouch, read(TOUCH));
export const isIdle = () => Date.now() - lastActive() > GRACE_MS;

export function markActive() {
  const now = Date.now();
  memoryActive = now;
  if (now - lastWrite > 1000) {
    lastWrite = now;
    write(ACTIVE, now);
  }
}
export function markTouched() {
  const now = Date.now();
  memoryTouch = now;
  write(TOUCH, now);
}

// Real input only: moving the mouse across the screen is not activity.
export function trackActivity() {
  const events = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];
  for (const name of events)
    window.addEventListener(name, markActive, { passive: true, capture: true });
  markActive();
  return () => {
    for (const name of events)
      window.removeEventListener(name, markActive, { capture: true });
  };
}
