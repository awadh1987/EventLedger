'use client';

import React, { useRef, useState } from 'react';
import { useTenantBranding } from '@/components/providers/theme-branding-provider';

export function SpotlightCard({ children, className = '', style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
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
      className={`relative overflow-hidden border p-5 shadow-sm transition-all duration-300 ${
        active && branding.enableSpotlight ? 'shadow-md' : ''
      } ${className}`}
      style={{
        borderRadius: 'var(--brand-radius, 0.75rem)',
        backgroundColor: 'var(--card-bg)',
        borderColor: active && branding.enableSpotlight ? 'var(--brand-primary, #D4AF37)' : 'var(--card-border)',
        ...style,
      }}
      {...props}
    >
      {branding.enableSpotlight && (
        <div
          className="pointer-events-none absolute -inset-px transition-opacity duration-300"
          style={{
            borderRadius: 'inherit',
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
