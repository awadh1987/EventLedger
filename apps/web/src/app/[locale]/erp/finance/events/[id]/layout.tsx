export function generateStaticParams() {
  return [{ id: '_' }];
}

export default function FinanceEventLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
