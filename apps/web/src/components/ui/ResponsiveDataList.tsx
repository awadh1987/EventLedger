'use client';

import React from 'react';
import { SpotlightCard } from '@/components/ui/spotlight-elements';

export interface ColumnDef<T> {
  key: string;
  headerAr: string;
  headerEn: string;
  render: (row: T) => React.ReactNode;
}

export function ResponsiveDataList<T extends { id: string }>({
  data,
  columns,
  locale = 'ar',
  mobileCardHeader,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  locale?: 'ar' | 'en';
  mobileCardHeader: (row: T) => React.ReactNode;
}) {
  const isRtl = locale === 'ar';
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-slate-800 md:block">
        <table className="w-full text-start text-sm">
          <thead className="bg-slate-900 text-xs text-slate-400">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-4 py-3 text-start">{isRtl ? c.headerAr : c.headerEn}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {data.map((row) => (
              <tr key={row.id}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3">{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {data.map((row) => (
          <SpotlightCard key={row.id} className="space-y-2 p-4">
            <div className="font-bold">{mobileCardHeader(row)}</div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {columns.map((c) => (
                <div key={c.key}>
                  <dt className="text-slate-400">{isRtl ? c.headerAr : c.headerEn}</dt>
                  <dd>{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </SpotlightCard>
        ))}
      </div>
    </>
  );
}
