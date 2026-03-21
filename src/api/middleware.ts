import type { BunRequest } from "bun";
import type { ApiConfig } from "../config";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
  UserNotAuthenticatedError,
} from "./errors";
import { respondWithJSON } from "./json";

type HandlerWithConfig = (cfg: ApiConfig, req: BunRequest) => Promise<Response>;

export function withConfig(cfg: ApiConfig, handler: HandlerWithConfig) {
  return (req: BunRequest) => handler(cfg, req);
}

export function noCacheMiddleware(
  next: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async function (req: Request): Promise<Response> {
    const res = await next(req);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

export function errorHandlingMiddleware(
  cfg: ApiConfig,
  err: unknown,
): Response {
  let statusCode = 500;
  let message = "Something went wrong on our end";

  if (err instanceof BadRequestError) {
    statusCode = 400;
    message = err.message;
  } else if (err instanceof UserNotAuthenticatedError) {
    statusCode = 401;
    message = err.message;
  } else if (err instanceof UserForbiddenError) {
    statusCode = 403;
    message = err.message;
  } else if (err instanceof NotFoundError) {
    statusCode = 404;
    message = err.message;
  }

  if (statusCode >= 500) {
    const errStr = errStringFromError(err);
    if (cfg.platform === "dev") {
      message = errStr;
    }
    console.log(errStr);
  }

  return respondWithJSON(statusCode, { error: message });
}

function errStringFromError(err: unknown) {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "An unknown error occurred";
}
