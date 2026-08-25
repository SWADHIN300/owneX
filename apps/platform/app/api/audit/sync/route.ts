import { z } from "zod";
import { handler, okNoStore } from "@/lib/http";
import { requireCaller } from "@/lib/authz";
import { syncEvents } from "@/lib/indexer";
import { readJson } from "@/lib/http";

const bodySchema = z.object({
  fromBlock: z.number().int().nonnegative().optional(),
});

/**
 * POST /api/audit/sync
 *
 * Pulls contract events into the audit cache. Any signed-in wallet may trigger
 * a sync: it only copies data that is already public on-chain, and the cache is
 * a convenience, not a privilege.
 *
 * In production this would run on a schedule (Vercel cron) or from a small
 * always-on worker listening for events. For a demo, calling it after each
 * transaction is enough — and it is idempotent, so calling it twice is free.
 */
export const POST = handler(async (request: Request) => {
  await requireCaller();

  const body = await readJson<unknown>(request).catch(() => ({}));
  const { fromBlock } = bodySchema.parse(body ?? {});

  const result = await syncEvents({ fromBlock });
  return okNoStore(result);
});
