import { handler, okNoStore } from "@/lib/http";
import { destroySession } from "@/lib/session";

/** POST /api/auth/logout — clears the session cookie. */
export const POST = handler(async () => {
  await destroySession();
  return okNoStore({ ok: true });
});
