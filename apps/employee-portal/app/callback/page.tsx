import { redirect } from "next/navigation";

/**
 * owneX redirects the browser to the registered callback URL, which is this page.
 * It forwards the protocol parameters to the route handler that does the work, so
 * the exchange happens on the server and the client secret never enters a client
 * component.
 *
 * Only the three parameters the protocol defines are forwarded. Anything else on
 * the URL — a `wallet`, a `role` — is dropped, because a value in a query string
 * is not evidence of anything.
 */
export default async function Callback({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["code", "state", "error"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.length > 0) params.set(key, value);
  }
  redirect(`/api/callback?${params.toString()}`);
}
