export function FoPreviewBanner({ dataSource }: { dataSource: "mock" | "live" | "partial_live" | "mixed" }) {
  if (dataSource === "live") return null;
  const message =
    dataSource === "partial_live"
      ? "Some checks use live SA360 data; unwired checks show preview fallback."
      : dataSource === "mixed"
        ? "Some metrics are live; remaining values use preview data."
        : "Preview data — mock adapters active where live endpoints are unavailable.";
  return (
    <p className="rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2 text-center text-xs text-sky-800">
      {message}
    </p>
  );
}
