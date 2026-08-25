import { z } from "zod";

/**
 * Environment contract. Fails loudly at first use rather than producing
 * confusing runtime errors deep inside a request.
 *
 * Anything not prefixed NEXT_PUBLIC_ must never be imported into a client
 * component. `serverEnv()` is only ever called from route handlers.
 */

const serverSchema = z.object({
  // ── Supabase ──────────────────────────────────────────────
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a full https URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY is missing"),

  // ── Chain ─────────────────────────────────────────────────
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  IDENTITY_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ORG_ACCESS_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ASSET_NFT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),

  // ── Auth ──────────────────────────────────────────────────
  // iron-session requires 32+ characters of entropy.
  SESSION_PASSWORD: z.string().min(32, "SESSION_PASSWORD must be at least 32 characters"),
  // 64 hex characters = a 32-byte AES-256 key.
  PII_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "PII_ENCRYPTION_KEY must be 64 hex chars"),
  APP_DOMAIN: z.string().min(3),
  APP_ORIGIN: z.string().url(),
});

const publicSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive(),
  NEXT_PUBLIC_CHAIN_NAME: z.string().min(1),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url().optional(),
  NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  NEXT_PUBLIC_ORG_ACCESS_MANAGER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  NEXT_PUBLIC_ASSET_NFT_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

let cachedServer: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment.\n${missing}\n\nCopy .env.local.example to .env.local and fill it in.`);
  }

  cachedServer = parsed.data;
  return cachedServer;
}

export const publicEnv: PublicEnv = publicSchema.parse({
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337,
  NEXT_PUBLIC_CHAIN_NAME: process.env.NEXT_PUBLIC_CHAIN_NAME ?? "Hardhat Local",
  NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL || undefined,
  NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS:
    process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  NEXT_PUBLIC_ORG_ACCESS_MANAGER_ADDRESS:
    process.env.NEXT_PUBLIC_ORG_ACCESS_MANAGER_ADDRESS ?? "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  NEXT_PUBLIC_ASSET_NFT_ADDRESS:
    process.env.NEXT_PUBLIC_ASSET_NFT_ADDRESS ?? "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
});
