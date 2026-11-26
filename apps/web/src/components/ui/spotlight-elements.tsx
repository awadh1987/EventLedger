'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';

export function SpotlightCard({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const branding = useTenantBranding();
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const update = (cx: number, cy: number) => {
    if (!ref.current || !branding.enableSpotlight) return;
    const rect = ref.current.getBoundingClientRect();
    setCoords({ x: cx - rect.left, y: cy - rect.top });
    setActive(true);
  };

  return (
    <div
      ref={ref}
      onMouseMove={(e) => update(e.clientX, e.clientY)}
      onMouseEnter={(e) => update(e.clientX, e.clientY)}
      onMouseLeave={() => setActive(false)}
      onPointerDown={(e) => update(e.clientX, e.clientY)}
      onTouchStart={(e) => e.touches[0] && update(e.touches[0].clientX, e.touches[0].clientY)}
      className={`relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all duration-300 dark:border-slate-800 dark:bg-slate-900/90 ${
        active && branding.enableSpotlight ? 'border-[var(--brand-primary,#D4AF37)] shadow-md' : ''
      } ${className}`}
      {...props}
    >
      {branding.enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px rounded-xl transition-opacity duration-300"
          style={{
            opacity: active ? 1 : 0,
            background: `radial-gradient(420px circle at ${coords.x}px ${coords.y}px, var(--brand-glow, ${branding.spotlightColor}), transparent 75%)`,
          }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

export function SpotlightHeading({
  as: Tag = 'h2',
  children,
  className = '',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const branding = useTenantBranding();
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const update = (cx: number, cy: number) => {
    if (!ref.current || !branding.enableSpotlight) return;
    const rect = ref.current.getBoundingClientRect();
    setCoords({ x: cx - rect.left, y: cy - rect.top });
    setActive(true);
  };

  return (
    <Tag
      ref={ref}
      onMouseMove={(e) => update(e.clientX, e.clientY)}
      onMouseEnter={(e) => update(e.clientX, e.clientY)}
      onMouseLeave={() => setActive(false)}
      onPointerDown={(e) => update(e.clientX, e.clientY)}
      onTouchStart={(e) => e.touches[0] && update(e.touches[0].clientX, e.touches[0].clientY)}
      className={`font-bold tracking-tight text-slate-900 transition-colors duration-200 dark:text-slate-100 ${
        active && branding.enableSpotlight ? 'text-[var(--brand-primary,#D4AF37)]' : ''
      } ${className}`}
      style={
        active && branding.enableSpotlight
          ? {
              background: `radial-gradient(180px circle at ${coords.x}px ${coords.y}px, var(--brand-glow, ${branding.spotlightColor}), transparent 80%)`,
            }
          : undefined
      }
      {...props}
    >
      {children}
    </Tag>
  );
}
