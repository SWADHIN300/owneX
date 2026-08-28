import { redirect } from "next/navigation";

export default async function Callback({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; state?: string; error?: string; reason?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["code", "state", "error", "reason"] as const) {
    const value = query[key];
    if (value) params.set(key, value);
  }
  redirect(`/api/callback?${params.toString()}`);
}
