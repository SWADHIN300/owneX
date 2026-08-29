import { NextResponse } from "next/server";
import { session } from "@/lib/session";
import { getPlatformOrigin } from "@/lib/config";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const reason = url.searchParams.get("reason");
  const portal = new URL("/", request.url).origin;
  const deny = (value: string) =>
    NextResponse.redirect(new URL(`/denied?reason=${encodeURIComponent(value)}`, portal));

  const store = await session();
  if (!state || state !== store.state || !store.stateExpires || store.stateExpires < Date.now()) {
    return deny("INVALID_STATE");
  }
  if (error) return deny(reason ?? error);
  if (!code) return deny("INVALID_CODE");

  const platform = getPlatformOrigin();
  const defaultCallback = portal.includes("localhost")
    ? "http://localhost:3001/callback"
    : "https://ownex-employee-portal.vercel.app/callback";
  const redirect_uri = process.env.PORTAL_CALLBACK_URL ?? defaultCallback;

  const response = await fetch(`${platform}/api/authorize/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      app: "employee-portal",
      redirect_uri,
      client_secret: process.env.PORTAL_CLIENT_SECRET ?? "employee-portal-local-secret",
    }),
    cache: "no-store",
  });

  if (!response.ok) return deny("AUTHORIZATION_FAILED");

  const data = (await response.json()) as { wallet?: string };
  if (!data.wallet) return deny("AUTHORIZATION_FAILED");

  store.wallet = data.wallet;
  store.role = undefined;
  store.state = undefined;
  store.stateExpires = undefined;
  await store.save();

  return NextResponse.redirect(new URL("/dashboard", portal));
}

export const POST = GET;
