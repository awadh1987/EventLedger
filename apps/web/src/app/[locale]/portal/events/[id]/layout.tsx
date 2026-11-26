export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function PortalEventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
