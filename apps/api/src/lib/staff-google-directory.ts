import { prisma } from "./db.js";
import type { ProvisionedStaffPrincipal } from "./staff-google-identity.js";

const principalSelect = {
  id: true,
  email: true,
  status: true,
  provider: true,
  providerSubject: true,
  disabledAt: true,
} as const;

type PrincipalRow = {
  id: string;
  email: string;
  status: "active" | "disabled";
  provider: "google";
  providerSubject: string | null;
  disabledAt: Date | null;
};

function asPrincipal(row: PrincipalRow | null): ProvisionedStaffPrincipal | null {
  if (!row || row.provider !== "google") return null;
  return {
    id: row.id,
    email: row.email,
    status: row.status === "active" ? "active" : "disabled",
    provider: "google",
    providerSubject: row.providerSubject,
    disabledAt: row.disabledAt,
  };
}

export async function findStaffPrincipalByGoogleSubject(sub: string): Promise<ProvisionedStaffPrincipal | null> {
  const row = await prisma.staffPrincipal.findUnique({
    where: { provider_providerSubject: { provider: "google", providerSubject: sub } },
    select: principalSelect,
  });
  return asPrincipal(row);
}

export async function findStaffPrincipalById(id: string): Promise<ProvisionedStaffPrincipal | null> {
  const row = await prisma.staffPrincipal.findUnique({
    where: { id },
    select: principalSelect,
  });
  return asPrincipal(row);
}
