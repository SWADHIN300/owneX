import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { session } from "@/lib/session";
import { getPlatformOrigin } from "@/lib/config";

export async function GET(request: Request) {
  const s = await session();
  const state = randomBytes(24).toString("hex");
  s.state = state;
  s.stateExpires = Date.now() + 300000;
  await s.save();

  const platform = getPlatformOrigin();
  const portalOrigin = new URL("/", request.url).origin;
  const defaultCallback = portalOrigin.includes("localhost")
    ? "http://localhost:3001/callback"
    : "https://ownex-employee-portal.vercel.app/callback";
  const callback = process.env.PORTAL_CALLBACK_URL ?? defaultCallback;

  const u = new URL("/authorize", platform);
  u.searchParams.set("app", "employee-portal");
  u.searchParams.set("redirect_uri", callback);
  u.searchParams.set("state", state);
  return NextResponse.redirect(u);
}
