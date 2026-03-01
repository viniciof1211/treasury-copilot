/** Reusable skeleton loading placeholders for dashboards. */

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 animate-pulse ${className}`}>
      <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
      <div className="h-7 w-32 bg-gray-200 rounded mb-2" />
      <div className="h-2 w-20 bg-gray-100 rounded" />
    </div>
  );
}

export function SkeletonChart({ height = 'h-64', className = '' }: { height?: string; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 animate-pulse ${className}`}>
      <div className="h-4 w-40 bg-gray-200 rounded mb-4" />
      <div className={`${height} bg-gray-100 rounded-lg flex items-end gap-2 p-4`}>
        {[40, 65, 45, 80, 55, 70, 50, 60, 75, 45].map((h, i) => (
          <div key={i} className="flex-1 bg-gray-200 rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4, className = '' }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 animate-pulse ${className}`}>
      <div className="h-4 w-48 bg-gray-200 rounded mb-4" />
      <div className="space-y-3">
        {/* Header */}
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="flex-1 h-3 bg-gray-200 rounded" />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4">
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} className="flex-1 h-3 bg-gray-100 rounded" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonChart />
        <SkeletonChart />
      </div>
      <SkeletonTable />
    </div>
  );
}
