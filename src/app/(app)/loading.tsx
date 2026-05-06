export default function AppLoading() {
  return (
    <div className="space-y-4">
      <div className="h-7 w-40 rounded bg-muted" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="h-28 rounded-xl border border-border bg-muted/40" />
        <div className="h-28 rounded-xl border border-border bg-muted/40" />
        <div className="h-28 rounded-xl border border-border bg-muted/40" />
      </div>
      <div className="h-64 rounded-xl border border-border bg-muted/30" />
    </div>
  );
}
