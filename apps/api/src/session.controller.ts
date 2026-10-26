import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Req,
  Res,
  ForbiddenException,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { roleSchema } from "@anvi/contracts";
import { PlatformStore } from "./platform.store";
import { parse } from "./http";
import {
  OidcService,
  cookieName,
  setSessionCookie,
  assertOrigin,
  type AppRequest,
} from "./auth";

// One structured event per refused sign-in, for security monitoring.
function signInFailed(req: AppRequest, method: string, reason: string) {
  console.warn(
    JSON.stringify({
      event: "auth.sign_in_failed",
      method,
      reason,
      client: req.ip,
      requestId: req.requestId,
    }),
  );
}

// Health, sign-in, session and role context.
@Controller()
export class SessionController {
  private readonly oidc;
  constructor(@Inject(PlatformStore) private readonly store: PlatformStore) {
    this.oidc = new OidcService(store);
  }
  @Get("healthz") health() {
    return { status: "ok" };
  }
  @Get("readyz") async ready() {
    await this.store.pool.query("SELECT 1");
    return { status: "ready" };
  }
  @Get("api/v1/auth/config") authConfig() {
    return {
      mode: this.store.config.AUTH_MODE,
      demo: this.store.config.AUTH_MODE === "demo",
    };
  }
  @Post("api/v1/auth/demo") async demo(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertOrigin(this.store, req);
    if (
      this.store.config.AUTH_MODE !== "demo" ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    ) {
      signInFailed(req, "demo", "not_allowed");
      throw new ForbiddenException("Demo sign-in is unavailable.");
    }
    const actor = await this.store.resolveIdentity(
      "urn:anvione:local-demo",
      "maya-demo",
    );
    setSessionCookie(
      this.store,
      res,
      await this.store.createSession(
        actor,
        req.requestId,
        req.cookies?.[cookieName(this.store)],
      ),
    );
    return { signedIn: true };
  }
  @Get("api/v1/auth/login") login(@Res() res: Response) {
    return this.oidc.start(res);
  }
  @Get("api/v1/auth/callback") async callback(
    @Req() req: AppRequest,
    @Res() res: Response,
  ) {
    try {
      await this.oidc.callback(req, res);
    } catch (error) {
      // The error class only: messages can echo tokens or identity claims.
      signInFailed(
        req,
        "oidc",
        error instanceof Error ? error.name : "unknown",
      );
      res.redirect("/login?error=access");
    }
  }
  @Post("api/v1/auth/logout") async logout(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.store.logout(
      req.actor,
      req.cookies[cookieName(this.store)],
      req.requestId,
    );
    res.clearCookie(cookieName(this.store), { path: "/" });
    return { signedOut: true };
  }
  @Get("api/v1/me") me(@Req() req: AppRequest) {
    return this.store.me(req.actor);
  }
  @Post("api/v1/session/role-context") async role(
    @Req() req: AppRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { role } = parse(z.object({ role: roleSchema }).strict(), body);
    const token = await this.store.switchRole(
      req.actor,
      role,
      req.cookies[cookieName(this.store)],
      req.requestId,
    );
    setSessionCookie(this.store, res, token);
    return { changed: true };
  }
}
