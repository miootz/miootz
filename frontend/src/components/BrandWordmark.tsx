export function BrandWordmark({ admin = false }: { admin?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.14em]">
      <img src="/brand/goal-cut.svg" alt="" width="18" height="10" />
      <span>{admin ? "Miootz Admin" : "Miootz"}</span>
    </span>
  );
}
