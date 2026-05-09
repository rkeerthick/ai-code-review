'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GitBranch, Loader2, XCircle } from 'lucide-react';
import { setAccessToken } from '../../../lib/api';
import { authStore } from '../../../stores/auth.store';

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get('token');
    const error = params.get('error');

    if (error || !token) {
      router.replace('/login?error=github_oauth_failed');
      return;
    }

    setAccessToken(token);
    authStore.loadUser().then(() => {
      router.replace('/dashboard');
    }).catch(() => {
      router.replace('/login?error=profile_load_failed');
    });
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-secondary/20">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 mb-6">
          <GitBranch className="h-7 w-7 text-primary" />
          <span className="text-xl font-bold">AI Code Review</span>
        </div>
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground">Signing you in with GitHub…</p>
      </div>
    </div>
  );
}

// useSearchParams requires Suspense boundary in Next.js 15
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
