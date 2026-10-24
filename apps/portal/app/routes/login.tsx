import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, Layers, Users, Sparkles } from "lucide-react";
import { Button, Avatar, Badge } from "@anvi/ui";
import { z } from "zod";
import { api, useAuthConfig } from "../lib/api";
import { copy } from "../lib/copy";
import { Brand } from "../components/brand";
export default function Login() {
  const config = useAuthConfig();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const navigate = useNavigate();
  const client = useQueryClient();
  async function demo() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/demo", z.unknown(), { method: "POST" });
      client.clear();
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
        <Brand light />
        <div className="login-story-copy">
          <span className="login-eyebrow">PEOPLE AT THE HEART OF IT ALL</span>
          <h1>{copy.signinTitle}</h1>
          <p>{copy.signinIntro}</p>
          <div className="login-art" aria-hidden="true">
            <div className="login-art-panel">
              <div className="art-avatar-stack">
                <Avatar initials="MI" />
                <Avatar initials="NR" />
                <Avatar initials="AS" />
              </div>
              <strong>
                Great people.
                <br />
                Even greater possibilities.
              </strong>
              <span>
                <span className="status-dot" />A place to belong.
              </span>
            </div>
            <span className="login-art-icon one">
              <Users size={28} />
            </span>
            <span className="login-art-icon two">
              <Layers size={26} />
            </span>
            <span className="login-art-star">
              <Sparkles size={40} />
            </span>
          </div>
        </div>
        <div className="login-story-footer">
          <span>A little closer, every day.</span>
          <span>AnviOne / MyAnvi</span>
        </div>
      </section>
      <section className="login-form-area">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="login-form">
          <span className="login-icon">
            <ShieldCheck size={25} />
          </span>
          <Badge>YOUR PEOPLE WORKSPACE</Badge>
          <h2>Welcome to AnviOne.</h2>
          <p>A good workday starts here.</p>
          {config.data?.demo && (
            <div className="demo-login-note">
              <strong>Explore the foundation preview</strong>
              <p>
                Meet a synthetic team and explore your workspace. No real
                employee data is used.
              </p>
            </div>
          )}
          {error || params.has("error") ? (
            <p className="inline-error" role="alert">
              {error ||
                "We could not verify your access. Try again or contact your HR team."}
            </p>
          ) : null}
          {config.error ? (
            <>
              <p className="inline-error" role="alert">
                The sign-in service is unavailable.
              </p>
              <Button variant="secondary" onPress={() => void config.refetch()}>
                Try again
              </Button>
            </>
          ) : config.data?.demo ? (
            <Button isDisabled={busy} onPress={() => void demo()}>
              {busy ? "Opening your workspace…" : "Explore demo workspace"}
              <ArrowRight size={18} />
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
            </a>
          )}
          <p className="login-help">
            Accounts are created by HR during onboarding.
            <br />
            Use your approved company identity.
          </p>
          <div className="login-divider" />
          <div className="login-access-note">
            <ShieldCheck size={18} />
            <span>
              Your access follows your role.
              <br />
              Your private information stays protected.
            </span>
          </div>
        </div>
        <footer className="login-footer">
          Built around people. Designed with care.
        </footer>
      </section>
    </main>
  );
}
