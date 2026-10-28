import type { ReactNode } from 'react';

type AdminPageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Primary action (e.g. “New meetup” link) */
  action?: ReactNode;
  /** Breadcrumb row above the title */
  breadcrumb?: ReactNode;
};

export function AdminPageHeader({
  title,
  subtitle,
  action,
  breadcrumb,
}: AdminPageHeaderProps) {
  return (
    <>
      {breadcrumb}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold text-ink tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-sm text-ink-dim mt-1 max-w-2xl">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="shrink-0 flex flex-wrap gap-2 justify-end">{action}</div>
        ) : null}
      </div>
    </>
  );
}
