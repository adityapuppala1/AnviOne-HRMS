import { useEffect, useRef, useState } from "react";
import { Button, DialogPanel } from "@anvi/ui";
import { heartbeat } from "../lib/api";
import {
  lastActive,
  lastServerTouch,
  markActive,
  trackActivity,
} from "../lib/activity";
import { copy } from "../lib/copy";

const text = copy.session;
// Warn this long before the server's idle limit.
const WARN_MS = 120_000;
// While someone is active, tell the server at most this often.
const BEAT_MS = 60_000;
const ACTIVE_MS = 30_000;

const clock = (ms: number) => {
  const total = Math.max(Math.ceil(ms / 1000), 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

// Signs people out after their role's idle limit, with a warning first. The
// server enforces the limit; this only keeps the screen honest and lets
// someone who is still there say so.
export function IdleGuard({
  limitSeconds,
  onExpire,
  onSignOut,
}: {
  limitSeconds: number;
  onExpire: () => void;
  onSignOut: () => void;
}) {
  const [left, setLeft] = useState<number | null>(null);
  const beating = useRef(false);
  const expired = useRef(false);
  const latest = useRef({ onExpire });
  latest.current = { onExpire };

  useEffect(() => {
    const limit = limitSeconds * 1000;
    const stop = trackActivity();
    const expire = () => {
      if (expired.current) return;
      expired.current = true;
      latest.current.onExpire();
    };
    const tick = () => {
      const now = Date.now();
      const active = now - lastActive() < ACTIVE_MS;
      const touch = lastServerTouch();
      if (active && now - touch > BEAT_MS && !beating.current) {
        beating.current = true;
        void heartbeat()
          .then((ok) => {
            if (!ok) expire();
          })
          .finally(() => {
            beating.current = false;
          });
      }
      const remaining = touch + limit - now;
      if (remaining <= 0) return expire();
      setLeft(remaining <= WARN_MS && !active ? remaining : null);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [limitSeconds]);

  function stay() {
    markActive();
    setLeft(null);
    void heartbeat();
  }
  return (
    <DialogPanel
      open={left !== null}
      onOpenChange={(open) => {
        if (!open) stay();
      }}
      title={text.title}
    >
      <p>{text.body}</p>
      <p className="idle-count" aria-hidden="true">
        {clock(left ?? 0)}
      </p>
      <div className="idle-actions">
        <Button onPress={stay}>{text.stay}</Button>
        <Button variant="secondary" onPress={onSignOut}>
          {text.signOut}
        </Button>
      </div>
    </DialogPanel>
  );
}
