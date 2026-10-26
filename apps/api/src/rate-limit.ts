import type { OnApplicationShutdown } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { createClient } from "redis";

// A connected but unresponsive store must not hold requests open.
const COMMAND_TIMEOUT_MS = 1000;

export class StoreUnavailable extends Error {
  override name = "StoreUnavailable";
}

interface StoreClient {
  isOpen: boolean;
  sendCommand(args: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

// Counters live in Valkey when RATE_LIMIT_URL is set, so every API replica
// shares one budget per client. Without it each process counts on its own,
// which is only acceptable for a single local instance.
export class RateLimits implements OnApplicationShutdown {
  private constructor(private readonly client: StoreClient | null) {}

  static async connect(url: string | undefined) {
    if (!url) return new RateLimits(null);
    let started = false;
    const client = createClient({
      url,
      // Fail a counter call at once while disconnected instead of queueing it,
      // so requests are never held waiting on the limiter.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5000,
        // A bad URL or password fails startup; after that, keep reconnecting.
        reconnectStrategy: (retries: number, cause: Error) =>
          started ? Math.min(retries * 100, 2000) : cause,
      },
    });
    client.on("error", (error: Error) =>
      console.error(
        JSON.stringify({ event: "rate_limit.store_error", reason: error.name }),
      ),
    );
    await client.connect();
    started = true;
    return new RateLimits(client);
  }

  // One store per limiter: a shared prefix would merge unrelated budgets.
  store(name: string) {
    const client = this.client;
    if (!client) return undefined;
    return new RedisStore({
      prefix: `anvione:rl:${name}:`,
      sendCommand: (...args: string[]) => {
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new StoreUnavailable("timeout")),
            COMMAND_TIMEOUT_MS,
          );
        });
        return Promise.race([client.sendCommand(args), timeout])
          .catch((error: unknown) => {
            throw error instanceof StoreUnavailable
              ? error
              : new StoreUnavailable("command failed");
          })
          .finally(() => clearTimeout(timer)) as Promise<RedisReply>;
      },
    });
  }

  async onApplicationShutdown() {
    if (this.client?.isOpen) await this.client.quit();
  }
}

// Fail-closed limiters pass store errors on; answer them as a clean, logged 503
// instead of Express's default HTML error page.
export function storeUnavailableHandler(
  error: unknown,
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction,
) {
  if (!(error instanceof StoreUnavailable)) return next(error);
  console.error(
    JSON.stringify({
      event: "rate_limit.store_unavailable",
      requestId: req.requestId,
    }),
  );
  res
    .status(503)
    .setHeader("Retry-After", "30")
    .type("application/problem+json")
    .json({
      type: "about:blank",
      status: 503,
      title: "The service is unavailable. Try again shortly.",
      code: "HTTP_503",
      requestId: req.requestId,
    });
}
