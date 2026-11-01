import { useId } from 'react';

interface Props { value: string; onChange(v: string): void; label?: string; placeholder?: string }

/** Client-side filter over the rows already loaded on the current page (the API has no free-text search). */
export function SearchBox({ value, onChange, label = 'Search this page', placeholder = 'Search…' }: Props) {
  const id = useId();
  return (
    <div className="min-w-[12rem] flex-1 sm:max-w-xs">
      <label htmlFor={id} className="block text-xs font-medium text-slate-600">{label}</label>
      <input id={id} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/40" />
    </div>
  );
}

export function matchesSearch(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}
