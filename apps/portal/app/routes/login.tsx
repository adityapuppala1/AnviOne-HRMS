import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Key } from "@phosphor-icons/react/dist/csr/Key";
import { LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Button, Badge, DialogPanel } from "@anvi/ui";
import { z } from "zod";
import { api, ApiError, useAuthConfig } from "../lib/api";
import { usePreferences } from "../lib/preferences";
import { Brand } from "../components/brand";
import { AtlasArt } from "../components/atlas-art";

export default function Login() {
  const config = useAuthConfig();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [help, setHelp] = useState(false);
  const { dark, update } = usePreferences();
  const navigate = useNavigate();
  const client = useQueryClient();
  async function demo() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/demo", z.unknown(), { method: "POST" });
      await client.cancelQueries();
      // Retain only public sign-in configuration while this screen unmounts.
      // Clearing its active query would immediately refetch it after each login.
      client.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth-config",
      });
      void navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Brand />
        <div className="login-story-copy">
          <p className="eyebrow">People make the difference.</p>
          <h1>
            A little closer.
            <br />A lot more <span>possible.</span>
          </h1>
          <p>
            Your people, your teams, your everyday.
            <br />
            Find your place in AnviOne.
          </p>
        </div>
        <AtlasArt />
        <div className="login-story-footer">
          <span>AnviOne / MyAnvi</span>
          <span>
            Made for your people <ArrowUpRight size={16} />
          </span>
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-top">
          <div className="login-mobile-brand">
            <Brand />
          </div>
          <Button
            variant="icon"
            aria-label={dark ? "Use light theme" : "Use dark theme"}
            onPress={() => update({ mode: dark ? "light" : "dark" })}
          >
            {dark ? <Sun size={21} /> : <Moon size={21} />}
          </Button>
        </div>
        <div className="login-form">
          <div className="login-icon">
            <Key size={28} weight="duotone" />
          </div>
          <Badge>Your people workspace</Badge>
          <h2>Welcome to AnviOne.</h2>
          <p>Settle in. Your workday starts here.</p>
          {config.data?.demo && (
            <div className="demo-login-note">
              <span className="status-dot" />
              <div>
                <strong>A workspace to explore</strong>
                <p>
                  Meet a synthetic team, switch roles and try the experience. No
                  real employee data.
                </p>
              </div>
            </div>
          )}
          {(error || params.has("error")) && (
            <p className="inline-error" role="alert">
              {error ||
                "We could not verify your access. Try again or contact your HR team."}
            </p>
          )}
          {config.error ? (
            <>
              <p className="inline-error" role="alert">
                {config.error instanceof ApiError && config.error.status === 429
                  ? "Too many sign-in requests. Wait a minute, then try again."
                  : "The sign-in service is unavailable."}
              </p>
              <Button
                variant="secondary"
                isDisabled={config.isFetching}
                onPress={() => void config.refetch()}
              >
                {config.isFetching ? "Trying again…" : "Try again"}
              </Button>
            </>
          ) : !config.data ? (
            <Button isDisabled>Preparing sign-in…</Button>
          ) : config.data.demo ? (
            <Button isDisabled={busy} onPress={() => void demo()}>
              {busy ? "Opening your workspace…" : "Explore demo workspace"}
              <ArrowRight size={19} />
            </Button>
          ) : (
            <a className="button button-primary" href="/api/v1/auth/login">
              <span className="microsoft-mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              Sign in with Microsoft
              <ArrowRight size={19} />
            </a>
          )}
          <p className="login-help">
            Use the company identity approved by your HR team.
            <br />
            New here? Your account starts with an invitation.
          </p>
          <div className="login-divider" />
          <div className="login-access-note">
            <LockKey size={19} />
            <span>Access is limited to your assigned workspace.</span>
          </div>
        </div>
        <footer className="login-footer">
          <span>AnviOne · People, connected.</span>
          <Button variant="ghost" onPress={() => setHelp(true)}>
            Sign-in help <ArrowUpRight size={15} />
          </Button>
        </footer>
      </section>
      <DialogPanel
        open={help}
        onOpenChange={setHelp}
        title="Getting into your workspace"
      >
        <dl className="guide-list">
          <div>
            <dt>Already part of the team?</dt>
            <dd>
              Use the company account approved by HR. If sign-in fails, ask HR
              or your identity administrator to confirm your access.
            </dd>
          </div>
          <div>
            <dt>Joining the organization?</dt>
            <dd>
              Employee access begins after HR approves your activation and binds
              your company identity. There is no public signup.
            </dd>
          </div>
          {config.data?.demo && (
            <div>
              <dt>Exploring the preview?</dt>
              <dd>
                The demo opens a synthetic HR workspace. Use your avatar to try
                other assigned roles.
              </dd>
            </div>
          )}
        </dl>
      </DialogPanel>
    </main>
  );
}
