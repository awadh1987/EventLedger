export function generateStaticParams() {
  return [
    { id: 'EVT-2026-101' },
    { id: 'EVT-2026-102' },
    { id: 'EVT-2026-103' },
  ];
}

export default function PortalEventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
