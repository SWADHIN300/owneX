import { NextResponse } from "next/server";
import { sessionWallet } from "@/lib/session";
import { issueGrant, validRedirect } from "@/lib/authorize";
import { appIdFromSlug, readCanAccessApp } from "@/lib/chain";

export async function POST(req: Request) {
  const f = await req.formData();
  const app = String(f.get("app") ?? "");
  const uri = String(f.get("redirect_uri") ?? "");
  const state = String(f.get("state") ?? "");

  if (!validRedirect(app, uri)) {
    return new NextResponse("Invalid redirect", { status: 400 });
  }

  const target = new URL(uri);
  target.searchParams.set("state", state);

  const wallet = await sessionWallet();
  if (!wallet) {
    target.searchParams.set("error", "UNAUTHORIZED");
    return NextResponse.redirect(target, 303);
  }

  let canAccess = true;
  try {
    canAccess = await readCanAccessApp(1, wallet, appIdFromSlug(app));
  } catch (err) {
    console.warn("Could not read app access on-chain during approve, defaulting to allowed:", err);
    canAccess = true;
  }

  if (!canAccess) {
    target.searchParams.set("error", "APP_ACCESS_NOT_GRANTED");
    return NextResponse.redirect(target, 303);
  }

  const code = await issueGrant({ wallet, app, redirectUri: uri });
  target.searchParams.set("code", code);
  return NextResponse.redirect(target, 303);
}
