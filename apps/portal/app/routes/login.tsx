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
import { Aurora } from "../components/ambient";
import {
  GlobeStage,
  type FloatCard,
  type Satellite,
} from "../components/globe-stage";
import { CalendarCheck } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { Fingerprint } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { Files } from "@phosphor-icons/react/dist/csr/Files";
import { SealCheck } from "@phosphor-icons/react/dist/csr/SealCheck";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import { loginCopy as text } from "../lib/copy/screens";

// Product modules orbit the globe, each in its own accent colour.
const MODULES: Satellite[] = [
  {
    key: "leave",
    node: <CalendarCheck size={19} weight="duotone" />,
    accent: "#f4b23e",
  },
  {
    key: "attendance",
    node: <Fingerprint size={19} weight="duotone" />,
    accent: "#58d6ee",
  },
  {
    key: "documents",
    node: <Files size={19} weight="duotone" />,
    accent: "#ff8a73",
  },
  {
    key: "approvals",
    node: <SealCheck size={19} weight="duotone" />,
    accent: "#5fdc9f",
  },
  {
    key: "holidays",
    node: <CalendarDots size={19} weight="duotone" />,
    accent: "#c7a4ff",
  },
  {
    key: "people",
    node: <UsersThree size={19} weight="duotone" />,
    accent: "#ffffff",
  },
];
const CARDS: FloatCard[] = [
  {
    key: "leave",
    icon: <CalendarCheck size={19} weight="fill" />,
    ...text.stage.leave,
    accent: "#f4b23e",
  },
  {
    key: "attendance",
    icon: <Fingerprint size={19} weight="fill" />,
    ...text.stage.attendance,
    accent: "#58d6ee",
  },
  {
    key: "documents",
    icon: <SealCheck size={19} weight="fill" />,
    ...text.stage.documents,
    accent: "#5fdc9f",
  },
];

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
      setError(e instanceof Error ? e.message : text.signInFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Aurora />
        <Brand />
        <div className="login-story-copy">
          <h1>{text.story.title}</h1>
          <p>{text.story.body}</p>
        </div>
        <div className="login-loom">
          <GlobeStage satellites={MODULES} cards={CARDS} />
        </div>
        <div className="login-story-footer">
          <span>{text.story.footerBrand}</span>
          <span>
            {text.story.footerTagline} <ArrowUpRight size={16} />
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
            aria-label={dark ? text.useLightTheme : text.useDarkTheme}
            onPress={() => update({ mode: dark ? "light" : "dark" })}
          >
            {dark ? <Sun size={21} /> : <Moon size={21} />}
          </Button>
        </div>
        <div className="login-form">
          <div className="login-icon">
            <Key size={28} weight="duotone" />
          </div>
          <Badge>{text.badge}</Badge>
          <h2>{text.welcome}</h2>
          <p>{text.welcomeSubtitle}</p>
          {config.data?.demo && (
            <div className="demo-login-note">
              <span className="status-dot" />
              <div>
                <strong>{text.demoNote.title}</strong>
                <p>{text.demoNote.body}</p>
              </div>
            </div>
          )}
          {params.get("reason") === "idle" &&
            !error &&
            !params.has("error") && (
              <p className="inline-notice" role="status">
                {text.idleSignedOut}
              </p>
            )}
          {(error || params.has("error")) && (
            <p className="inline-error" role="alert">
              {error || text.verifyFailed}
            </p>
          )}
          {config.error ? (
            <>
              <p className="inline-error" role="alert">
                {config.error instanceof ApiError && config.error.status === 429
                  ? text.tooManyRequests
                  : text.serviceUnavailable}
              </p>
              <Button
                variant="secondary"
                isDisabled={config.isFetching}
                onPress={() => void config.refetch()}
              >
                {config.isFetching ? text.retrying : text.retry}
              </Button>
            </>
          ) : !config.data ? (
            <Button isDisabled>{text.preparing}</Button>
          ) : config.data.demo ? (
            <Button isDisabled={busy} onPress={() => void demo()}>
              {busy ? text.openingDemo : text.exploreDemo}
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
              {text.microsoft}
              <ArrowRight size={19} />
            </a>
          )}
          <p className="login-help">
            {text.helpIdentity}
            <br />
            {text.helpInvite}
          </p>
          <div className="login-divider" />
          <div className="login-access-note">
            <LockKey size={19} />
            <span>{text.accessNote}</span>
          </div>
        </div>
        <footer className="login-footer">
          <span>{text.footerBrand}</span>
          <Button variant="ghost" onPress={() => setHelp(true)}>
            {text.signInHelp} <ArrowUpRight size={15} />
          </Button>
        </footer>
      </section>
      <DialogPanel open={help} onOpenChange={setHelp} title={text.help.title}>
        <dl className="guide-list">
          <div>
            <dt>{text.help.teamQuestion}</dt>
            <dd>{text.help.teamAnswer}</dd>
          </div>
          <div>
            <dt>{text.help.joiningQuestion}</dt>
            <dd>{text.help.joiningAnswer}</dd>
          </div>
          {config.data?.demo && (
            <div>
              <dt>{text.help.previewQuestion}</dt>
              <dd>{text.help.previewAnswer}</dd>
            </div>
          )}
        </dl>
      </DialogPanel>
    </main>
  );
}
