import React from 'react';
import EmptyState from './EmptyState';
import { Inbox } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (item: T, index: number) => React.ReactNode;
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  emptyDescription?: string;
  loading?: boolean;
  className?: string;
  compact?: boolean;
  striped?: boolean;
  hoverable?: boolean;
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'Aucune donnée',
  emptyDescription,
  loading = false,
  className = '',
  compact = false,
  striped = false,
  hoverable = true
}: DataTableProps<T>) {
  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3';
  const headerPadding = compact ? 'px-3 py-2' : 'px-4 py-3';

  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right'
  };

  if (loading) {
    return (
      <div className={`bg-white rounded-2xl border border-slate-200 ${className}`}>
        <div className="p-8 flex items-center justify-center">
          <div role="status" className="flex items-center gap-3 text-slate-600"><span aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"/>Chargement des données…</div>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`bg-white rounded-2xl border border-slate-200 ${className}`}>
        <EmptyState
          icon={Inbox}
          title={emptyMessage}
          description={emptyDescription}
          size="sm"
        />
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      <div className="overflow-x-auto">
        <table aria-label="Liste des résultats" className="w-full text-left border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`${headerPadding} text-xs font-bold text-slate-500 uppercase tracking-wider ${alignClasses[col.align || 'left']}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((item, index) => (
              <tr
                key={keyExtractor(item)}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick ? `Ouvrir le détail de la ligne ${index + 1}` : undefined}
                onKeyDown={e => {
                  if (onRowClick && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(item); }
                }}
                onClick={() => onRowClick?.(item)}
                className={`
                  ${onRowClick ? 'cursor-pointer' : ''}
                  ${hoverable ? 'hover:bg-slate-50' : ''}
                  ${striped && index % 2 === 1 ? 'bg-slate-50/50' : ''}
                  transition-colors
                `}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${cellPadding} text-sm ${alignClasses[col.align || 'left']}`}
                  >
                    {col.render 
                      ? col.render(item, index) 
                      : (item as any)[col.key]
                    }
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
