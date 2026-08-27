import type { Metadata } from "next";

import { AuditTrail } from "@/components/console/audit/audit-trail";

export const metadata: Metadata = {
  title: "Audit trail — owneX",
  description:
    "Every identity, role and asset event, read from contract events with the transaction that produced each one.",
};

export default function AuditPage() {
  return <AuditTrail />;
}
