'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getNativeWorkspace, isNativeRuntime } from '@/lib/api';
import { WorkspaceConnectScreen } from '@/components/native/WorkspaceConnectScreen';

export default function RootEntryPage() {
  const router = useRouter();
  const [needsConnect, setNeedsConnect] = useState(false);

  useEffect(() => {
    if (isNativeRuntime() && !getNativeWorkspace()) {
      setNeedsConnect(true);
      return;
    }
    router.replace(isNativeRuntime() ? '/ar/login' : '/ar');
  }, [router]);

  if (needsConnect) {
    return (
      <WorkspaceConnectScreen
        locale="ar"
        onConnected={() => {
          router.replace('/ar/login');
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-400">
      Loading EventLedger...
    </div>
  );
}
