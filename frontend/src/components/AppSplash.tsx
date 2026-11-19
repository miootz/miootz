export function AppSplash({ status }: { status: string }) {
  return (
    <div className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-board px-6">
      <picture className="absolute inset-0 -z-10">
        <source
          media="(min-width: 768px) and (orientation: landscape)"
          srcSet="/brand/football-seam.webp"
        />
        <img src="/brand/splash.webp" alt="" className="h-full w-full object-cover" />
      </picture>
      <div className="flex -translate-y-[6dvh] flex-col items-center gap-4 text-center">
        <img src="/brand/goal-cut.svg" alt="" width="104" height="57" />
        <span className="text-3xl font-extrabold uppercase tracking-[0.14em] text-ink">
          Miootz
        </span>
        <p role="status" className="text-sm text-ink-dim">{status}</p>
      </div>
    </div>
  );
}
