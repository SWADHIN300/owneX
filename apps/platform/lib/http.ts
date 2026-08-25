import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** An error with an HTTP status, safe to surface to the caller. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (msg = "Sign in required") => new ApiError(401, msg, "UNAUTHORIZED");
export const forbidden = (msg = "You do not have permission to do that") => new ApiError(403, msg, "FORBIDDEN");
export const notFound = (msg = "Not found") => new ApiError(404, msg, "NOT_FOUND");
export const badRequest = (msg: string) => new ApiError(400, msg, "BAD_REQUEST");
export const conflict = (msg: string) => new ApiError(409, msg, "CONFLICT");

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/** Never cache anything that depends on the caller's identity or chain state. */
export function okNoStore<T>(data: T) {
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * Wraps a handler so every failure returns a predictable JSON shape and no
 * internal detail leaks. Unexpected errors are logged server-side and reported
 * generically.
 */
export function handler<Args extends unknown[]>(fn: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }

      if (error instanceof ZodError) {
        return NextResponse.json(
          {
            error: "Invalid request",
            code: "VALIDATION_FAILED",
            issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
          { status: 400 }
        );
      }

      // Configuration problems are worth surfacing clearly in development.
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.startsWith("Invalid server environment")) {
        console.error("[ownex] configuration error:\n", message);
        return NextResponse.json({ error: "Server is not configured", code: "NOT_CONFIGURED" }, { status: 500 });
      }

      console.error("[ownex] unhandled error:", error);
      return NextResponse.json({ error: "Something went wrong", code: "INTERNAL" }, { status: 500 });
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}
