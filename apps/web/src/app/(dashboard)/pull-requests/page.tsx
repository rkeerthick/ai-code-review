'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import {
  GitPullRequest, GitMerge, GitPullRequestClosed,
  Clock, CheckCircle2, AlertTriangle, RefreshCw, Search, RotateCcw,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { api } from '../../../lib/api';
import { authStore } from '../../../stores/auth.store';

const STATE_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  OPEN:   { label: 'Open',   icon: GitPullRequest,       className: 'text-green-600 bg-green-50 dark:bg-green-900/20' },
  MERGED: { label: 'Merged', icon: GitMerge,             className: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20' },
  CLOSED: { label: 'Closed', icon: GitPullRequestClosed, className: 'text-red-600 bg-red-50 dark:bg-red-900/20' },
};

const REVIEW_STATUS_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  PENDING:   { label: 'Pending',   icon: Clock,         className: 'text-gray-500' },
  RUNNING:   { label: 'Running',   icon: RefreshCw,     className: 'text-blue-500 animate-spin' },
  COMPLETED: { label: 'Reviewed',  icon: CheckCircle2,  className: 'text-green-500' },
  FAILED:    { label: 'Failed',    icon: AlertTriangle, className: 'text-red-500' },
  CACHED:    { label: 'Cached',    icon: CheckCircle2,  className: 'text-purple-500' },
};

const STATES = ['ALL', 'OPEN', 'MERGED', 'CLOSED'];

const PullRequestsPage = observer(function PullRequestsPage() {
  const [stateFilter, setStateFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const orgId = authStore.currentOrgId;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['pull-requests', orgId, stateFilter, page],
    queryFn: () =>
      api.listPRs(
        orgId!,
        stateFilter !== 'ALL' ? { state: stateFilter } : undefined,
        page,
      ) as any,
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });

  // Fetch connected repos so we know which ones to sync
  const { data: reposData } = useQuery({
    queryKey: ['repos', orgId],
    queryFn: () => api.listRepos(orgId!) as any,
    enabled: !!orgId,
  });
  const repos: any[] = reposData?.data?.data ?? reposData?.data?.items ?? [];

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!orgId || repos.length === 0) throw new Error('No repositories connected');
      const results = await Promise.all(
        repos.map((r: any) => api.syncPRs(orgId, r.id) as any),
      );
      return results.reduce(
        (acc: any, r: any) => ({
          created: acc.created + (r?.data?.created ?? 0),
          updated: acc.updated + (r?.data?.updated ?? 0),
        }),
        { created: 0, updated: 0 },
      );
    },
    onSuccess: (result) => {
      toast.success(`Synced — ${result.created} new, ${result.updated} updated`);
      qc.invalidateQueries({ queryKey: ['pull-requests'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Sync failed'),
  });

  const prs: any[] = data?.data?.data ?? data?.data?.items ?? [];
  const total: number = data?.data?.total ?? prs.length;
  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  const filtered = search
    ? prs.filter(
        (pr) =>
          pr.title?.toLowerCase().includes(search.toLowerCase()) ||
          pr.repository?.fullName?.toLowerCase().includes(search.toLowerCase()),
      )
    : prs;

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pull Requests</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            AI-reviewed pull requests across your repositories
          </p>
        </div>
        {orgId && repos.length > 0 && (
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RotateCcw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            {syncMutation.isPending ? 'Syncing…' : 'Sync from GitHub'}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or repository…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* State tabs */}
        <div className="flex rounded-lg border overflow-hidden">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => { setStateFilter(s); setPage(1); }}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                stateFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:bg-secondary'
              }`}
            >
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
            <GitPullRequest className="h-10 w-10 opacity-20" />
            <div className="text-center">
              <p className="font-medium">No pull requests found</p>
              <p className="text-sm mt-0.5">
                {repos.length > 0
                  ? 'Click "Sync from GitHub" above to import existing PRs from your connected repos.'
                  : orgId
                  ? 'Connect a repository first in Settings → Repositories.'
                  : 'Create or join an organization first.'}
              </p>
            </div>
            {repos.length > 0 && (
              <button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <RotateCcw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                {syncMutation.isPending ? 'Syncing…' : 'Sync from GitHub'}
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((pr: any) => {
              const state = STATE_CONFIG[pr.state] ?? STATE_CONFIG.OPEN;
              const StateIcon = state.icon;
              const isClosedOrMerged = pr.state === 'MERGED' || pr.state === 'CLOSED';
              const hasReview = pr.reviewStatus === 'COMPLETED' || pr.reviewStatus === 'FAILED' || pr.reviewStatus === 'CACHED';
              const showReviewStatus = hasReview || (!isClosedOrMerged && pr.reviewStatus === 'RUNNING');
              const reviewStatus = REVIEW_STATUS_CONFIG[pr.reviewStatus] ?? REVIEW_STATUS_CONFIG.PENDING;
              const ReviewIcon = reviewStatus.icon;

              return (
                <Link
                  key={pr.id}
                  href={`/pull-requests/${pr.id}`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors group"
                >
                  {/* State icon */}
                  <div className={`flex-shrink-0 p-1.5 rounded-full ${state.className}`}>
                    <StateIcon className="h-4 w-4" />
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                      {pr.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{pr.repository?.fullName}</span>
                      {' '}· #{pr.githubPrNumber}
                      {' '}· {formatDistanceToNow(new Date(pr.githubUpdatedAt ?? pr.createdAt), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Quality score */}
                  {pr.qualityScore !== null && pr.qualityScore !== undefined && (
                    <div
                      className={`flex-shrink-0 text-sm font-bold tabular-nums ${
                        pr.qualityScore >= 80
                          ? 'text-green-600'
                          : pr.qualityScore >= 60
                          ? 'text-yellow-600'
                          : 'text-red-600'
                      }`}
                    >
                      {pr.qualityScore}/100
                    </div>
                  )}

                  {/* Review status — hide "Pending" for merged/closed PRs */}
                  {showReviewStatus ? (
                    <div className="flex-shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ReviewIcon className={`h-3.5 w-3.5 ${reviewStatus.className}`} />
                      {reviewStatus.label}
                    </div>
                  ) : isClosedOrMerged ? (
                    <span className="flex-shrink-0 text-xs text-muted-foreground/50">—</span>
                  ) : (
                    <div className="flex-shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 text-gray-400" />
                      Pending review
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} total</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || isFetching}
              className="px-3 py-1.5 rounded border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || isFetching}
              className="px-3 py-1.5 rounded border hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default PullRequestsPage;
