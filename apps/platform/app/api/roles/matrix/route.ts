import { z } from "zod";
import { handler, okNoStore, badRequest } from "@/lib/http";
import { requireMember } from "@/lib/authz";
import { PERMISSION_LIST, readOrganization, readPermissionMatrix } from "@/lib/chain";

/**
 * GET /api/roles/matrix?orgId=1 — the organisation's permission matrix
 *
 * Read-only, and gated on membership: what a role can do is something every
 * member is entitled to know, and hiding it only makes a denial baffling when it
 * arrives.
 *
 * The matrix is read from the contract rather than restated here, because the
 * two can differ. The defaults come from `defaultPermission`, the overrides from
 * `permissionOverride`. A copy of the default table hard-coded in the interface
 * would keep looking right after a redeploy changed it, which is exactly when
 * being right matters.
 *
 * Not to be confused with `/api/roles/verify`, which answers "may this wallet
 * use this application" for an integrating app and is deliberately
 * unauthenticated.
 */

const querySchema = z.object({
  orgId: z.coerce.number().int().positive(),
});

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) throw badRequest("orgId is required and must be a positive integer");

  const { orgId } = parsed.data;

  const caller = await requireMember(orgId);

  const [cells, organization] = await Promise.all([
    readPermissionMatrix(orgId),
    readOrganization(orgId),
  ]);

  return okNoStore({
    orgId,
    // Every permission in a suspended organisation answers false regardless of
    // the matrix, so the UI has to be able to say so.
    organisationActive: organization?.active ?? false,
    roles: ["ADMIN", "MANAGER", "AUDITOR", "USER"],
    permissions: PERMISSION_LIST.map((p) => ({ key: p.key, label: p.label })),
    cells,
    // Changing a cell needs ASSIGN_ROLES and an ADMIN signature. The write path
    // is not built yet; this flag exists so the interface can be honest about
    // who would be allowed to use it rather than offering it to everyone.
    canEdit: caller.role === "ADMIN",
  });
});
