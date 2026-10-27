import Link from "next/link";

export function ClientDetailSetupLink({ clientAccountId }: { clientAccountId: string }) {
  return (
    <Link
      href={`/clients/${encodeURIComponent(clientAccountId)}/onboarding`}
      className="text-sky-700 hover:underline"
    >
      Setup & Delivery →
    </Link>
  );
}
