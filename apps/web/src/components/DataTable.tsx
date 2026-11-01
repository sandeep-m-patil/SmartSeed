import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  cell(row: T): ReactNode;
  /** Secondary columns collapse below the md breakpoint to keep phone layouts readable. */
  isSecondary?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T): string;
  caption: string;
}

/** Responsive table: horizontal scroll container, secondary columns hidden on small screens. */
export function DataTable<T>({ columns, rows, rowKey, caption }: Props<T>) {
  const cellClass = (c: Column<T>) => `px-3 py-2 text-sm text-slate-800 ${c.isSecondary ? 'hidden md:table-cell' : ''} ${c.className ?? ''}`;
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${c.isSecondary ? 'hidden md:table-cell' : ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-slate-50">
              {columns.map((c) => <td key={c.key} className={cellClass(c)}>{c.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
