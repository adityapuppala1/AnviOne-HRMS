import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import {
  PlatformStore,
  opaque,
  hash,
  type SessionActor,
} from "./platform.store";

export type AppRequest = Request & { actor: SessionActor; requestId: string };
export function cookieName(store: PlatformStore) {
  return store.config.APP_ORIGIN.startsWith("https:")
    ? "__Host-anvi_session"
    : "anvi_dev_session";
}
export function setSessionCookie(
  store: PlatformStore,
  res: Response,
  token: string,
) {
  res.cookie(cookieName(store), token, {
    httpOnly: true,
    secure: store.config.APP_ORIGIN.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  });
}
export function assertOrigin(store: PlatformStore, req: Request) {
  if (
    req.headers.origin !== store.config.APP_ORIGIN ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    throw new ForbiddenException("This request origin is not allowed.");
}
export function csrfMatches(expected: string, actual: unknown) {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(expected),
    right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
const publicPaths = new Set([
  "/healthz",
  "/readyz",
  "/api/v1/auth/config",
  "/api/v1/auth/demo",
  "/api/v1/auth/login",
  "/api/v1/auth/callback",
]);
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(PlatformStore) private readonly store: PlatformStore) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (publicPaths.has(req.path)) return true;
    // The portal marks its own background polls so they do not extend the idle
    // clock. Sending the header only ever shortens a session, never lengthens it.
    req.actor = await this.store.session(
      req.cookies?.[cookieName(this.store)],
      {
        // A write is activity by definition, whatever the header says.
        touch:
          !["GET", "HEAD"].includes(req.method) ||
          req.headers["x-anvi-idle"] !== "1",
      },
    );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      assertOrigin(this.store, req);
      if (!csrfMatches(req.actor.csrfToken, req.headers["x-csrf-token"]))
        throw new ForbiddenException(
          "Your security token changed. Refresh and try again.",
        );
    }
    return true;
  }
}
export class OidcService {
  private client?: Promise<oidc.Configuration>;
  constructor(private readonly store: PlatformStore) {}
  private configuration() {
    const c = this.store.config;
    if (c.AUTH_MODE !== "oidc")
      throw new UnauthorizedException(
        "Corporate sign-in is not configured in this demo.",
      );
    this.client ??= oidc.discovery(
      new URL(c.OIDC_ISSUER!),
      c.OIDC_CLIENT_ID!,
      c.OIDC_CLIENT_SECRET!,
    );
    return this.client;
  }
  async start(res: Response) {
    const config = await this.configuration();
    const token = opaque(),
      verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    await this.store.pool.query(
      "DELETE FROM oidc_attempt WHERE expires_at < now()",
    );
    await this.store.pool.query(
      `INSERT INTO oidc_attempt(token_hash,verifier,state,nonce,expires_at) VALUES ($1,$2,$3,$4,now()+interval '5 minutes')`,
      [hash(token), verifier, state, nonce],
    );
    res.cookie("anvi_oidc", token, {
      httpOnly: true,
      secure: this.store.config.APP_ORIGIN.startsWith("https:"),
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: 300000,
    });
    const params: Record<string, string> = {
      redirect_uri: this.store.config.OIDC_REDIRECT_URI!,
      scope: "openid profile",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    };
    if (this.store.config.OIDC_REQUIRED_ACR)
      params.claims = JSON.stringify({
        id_token: {
          acrs: { essential: true, value: this.store.config.OIDC_REQUIRED_ACR },
        },
      });
    res.redirect(oidc.buildAuthorizationUrl(config, params).href);
  }
  async callback(req: AppRequest, res: Response) {
    const config = await this.configuration();
    const token: unknown = req.cookies?.anvi_oidc;
    res.clearCookie("anvi_oidc", { path: "/api/v1/auth" });
    if (typeof token !== "string")
      throw new UnauthorizedException("Sign-in expired. Start again.");
    const result = await this.store.pool.query<{
      verifier: string;
      state: string;
      nonce: string;
    }>(
      "DELETE FROM oidc_attempt WHERE token_hash=$1 AND expires_at>now() RETURNING verifier,state,nonce",
      [hash(token)],
    );
    const attempt = result.rows[0];
    if (!attempt)
      throw new UnauthorizedException("Sign-in expired. Start again.");
    const callback = new URL(this.store.config.OIDC_REDIRECT_URI!);
    callback.search = new URL(
      req.originalUrl,
      this.store.config.APP_ORIGIN,
    ).search;
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: attempt.verifier,
      expectedState: attempt.state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub || claims.iss !== this.store.config.OIDC_ISSUER)
      throw new UnauthorizedException(
        "The corporate identity could not be verified.",
      );
    const required = this.store.config.OIDC_REQUIRED_ACR;
    if (
      required &&
      (!Array.isArray(claims.acrs) || !claims.acrs.includes(required))
    )
      throw new UnauthorizedException(
        "Required authentication policy was not satisfied.",
      );
    const actor = await this.store.resolveIdentity(claims.iss, claims.sub);
    const session = await this.store.createSession(
      actor,
      req.requestId,
      req.cookies?.[cookieName(this.store)],
    );
    setSessionCookie(this.store, res, session);
    res.redirect("/");
  }
}
