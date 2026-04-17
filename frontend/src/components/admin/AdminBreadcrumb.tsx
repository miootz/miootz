import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export type AdminCrumb = { label: string; to?: string };

export function AdminBreadcrumb({ items }: { items: AdminCrumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav
      className="mb-4 flex flex-wrap items-center gap-1 text-sm text-gray-500 dark:text-gray-400"
      aria-label="Breadcrumb"
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
            )}
            {item.to && !last ? (
              <Link
                to={item.to}
                className="hover:text-violet-600 dark:hover:text-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={
                  last
                    ? 'font-medium text-gray-800 dark:text-gray-200'
                    : undefined
                }
              >
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
