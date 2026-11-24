import Link from "next/link";

export function PortalLeadsContinuation({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <div className="flex justify-end">
      <Link
        href={href}
        className="inline-flex min-h-10 items-center text-sm font-medium text-slate-800 underline-offset-2 hover:underline"
      >
        {label}
      </Link>
    </div>
  );
}
