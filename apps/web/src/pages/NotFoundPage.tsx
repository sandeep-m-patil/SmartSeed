import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-10 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-3 inline-block text-sm text-brand-700 underline">Back to the dashboard</Link>
    </div>
  );
}
