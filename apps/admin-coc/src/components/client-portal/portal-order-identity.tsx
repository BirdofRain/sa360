export function PortalOrderIdentity({
  displayName,
  orderNumber,
}: {
  displayName?: string | null;
  orderNumber: string;
}) {
  const name = displayName?.trim() ?? "";
  const number = orderNumber.trim();
  const showName = Boolean(name) && name !== number;

  return (
    <span>
      {showName ? (
        <>
          <span className="font-medium text-slate-700">{name}</span>
          <span className="font-normal text-slate-400"> — </span>
          <span className="font-semibold tabular-nums text-slate-900">{number}</span>
        </>
      ) : (
        <span className="font-semibold tabular-nums text-slate-900">{number}</span>
      )}
    </span>
  );
}
