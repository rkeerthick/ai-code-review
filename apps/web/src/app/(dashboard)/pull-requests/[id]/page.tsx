'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { use, useState, useRef, useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import {
  GitPullRequest, AlertTriangle, Shield, Zap,
  Bug, CheckCircle2, Clock, RefreshCw, GitMerge,
  GitPullRequestClosed, MessageSquare, Send, ChevronDown,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { api } from '../../../../lib/api';
import { authStore } from '../../../../stores/auth.store';
import { DiffViewer } from './DiffViewer';

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  INFO: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const CATEGORY_ICONS: Record<string, any> = {
  SECURITY: Shield,
  BUG: Bug,
  PERFORMANCE: Zap,
  QUALITY: CheckCircle2,
  BEST_PRACTICE: CheckCircle2,
  TESTING: CheckCircle2,
};

function ReviewStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    RUNNING: 'bg-blue-100 text-blue-700 animate-pulse',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700',
    CACHED: 'bg-purple-100 text-purple-700',
  };
  const icons: Record<string, any> = {
    PENDING: Clock, RUNNING: RefreshCw, COMPLETED: CheckCircle2, FAILED: AlertTriangle,
  };
  const Icon = icons[status] ?? Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${styles[status] ?? ''}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

const MERGE_METHODS = [
  { value: 'merge', label: 'Create a merge commit', description: 'All commits from this branch will be added to the base branch via a merge commit.' },
  { value: 'squash', label: 'Squash and merge', description: 'Combine all commits into one before merging.' },
  { value: 'rebase', label: 'Rebase and merge', description: 'Rebase commits onto the base branch individually.' },
] as const;

const PullRequestDetailPage = observer(function PullRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const queryClient = useQueryClient();
  const orgId = authStore.currentOrgId ?? '';

  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');
  const [showMergeMenu, setShowMergeMenu] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const mergeMenuRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pr', resolvedParams.id],
    queryFn: () => api.getPR(resolvedParams.id, orgId) as any,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.reviewStatus;
      return status === 'RUNNING' || status === 'PENDING' ? 3000 : false;
    },
  });

  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ['pr-comments', resolvedParams.id],
    queryFn: () => api.getPRComments(resolvedParams.id, orgId) as any,
    enabled: !!orgId,
  });

  const { data: diffData } = useQuery({
    queryKey: ['pr-diff', resolvedParams.id],
    queryFn: () => api.getPRDiff(resolvedParams.id, orgId) as any,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000, // diff rarely changes
  });

  const { data: lineCommentsData, refetch: refetchLineComments } = useQuery({
    queryKey: ['pr-line-comments', resolvedParams.id],
    queryFn: () => api.getPRLineComments(resolvedParams.id, orgId) as any,
    enabled: !!orgId,
  });

  const handleAddLineComment = async (filePath: string, line: number, side: 'LEFT' | 'RIGHT', body: string) => {
    await api.addPRLineComment(resolvedParams.id, orgId, filePath, line, side, body);
    toast.success('Comment added');
    refetchLineComments();
  };

  const triggerMutation = useMutation({
    mutationFn: () => api.triggerReview(resolvedParams.id, orgId) as any,
    onSuccess: () => {
      toast.success('Review started!');
      queryClient.invalidateQueries({ queryKey: ['pr', resolvedParams.id] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: () => api.mergePR(resolvedParams.id, orgId, mergeMethod) as any,
    onSuccess: () => {
      toast.success('Pull request merged!');
      queryClient.invalidateQueries({ queryKey: ['pr', resolvedParams.id] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Merge failed'),
  });

  const closeMutation = useMutation({
    mutationFn: () => api.closePR(resolvedParams.id, orgId) as any,
    onSuccess: () => {
      toast.success('Pull request closed');
      queryClient.invalidateQueries({ queryKey: ['pr', resolvedParams.id] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to close'),
  });

  const reopenMutation = useMutation({
    mutationFn: () => api.reopenPR(resolvedParams.id, orgId) as any,
    onSuccess: () => {
      toast.success('Pull request reopened');
      queryClient.invalidateQueries({ queryKey: ['pr', resolvedParams.id] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to reopen'),
  });

  const commentMutation = useMutation({
    mutationFn: () => api.addPRComment(resolvedParams.id, orgId, commentBody) as any,
    onSuccess: () => {
      toast.success('Comment added');
      setCommentBody('');
      refetchComments();
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to add comment'),
  });

  const feedbackMutation = useMutation({
    mutationFn: ({ commentId, accepted }: { commentId: string; accepted: boolean }) =>
      api.submitFeedback(commentId, orgId, accepted) as any,
    onSuccess: (_: any, vars: { commentId: string; accepted: boolean }) => {
      toast.success(vars.accepted ? 'Feedback saved — accepted' : 'Feedback saved — dismissed');
      queryClient.invalidateQueries({ queryKey: ['pr', resolvedParams.id] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Failed to save feedback'),
  });

  // Close merge dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (mergeMenuRef.current && !mergeMenuRef.current.contains(e.target as Node)) {
        setShowMergeMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const pr = data?.data;
  const latestJob = pr?.reviewJobs?.[0];
  const comments = latestJob?.reviewComments ?? [];
  const ghComments: any[] = commentsData?.data ?? [];
  const diffFiles: any[] = diffData?.data?.files ?? [];
  const lineComments: any[] = lineCommentsData?.data ?? [];

  const criticalComments = comments.filter((c: any) => c.severity === 'CRITICAL');
  const highComments = comments.filter((c: any) => c.severity === 'HIGH');
  const isOpen = pr?.state === 'OPEN';
  const isMerged = pr?.state === 'MERGED';
  const isClosed = pr?.state === 'CLOSED';
  const anyActionPending = mergeMutation.isPending || closeMutation.isPending || reopenMutation.isPending;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* ── PR Header ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GitPullRequest className="h-5 w-5 text-primary" />
            <span className="text-muted-foreground text-sm">
              {pr?.repository?.fullName} #{pr?.githubPrNumber}
            </span>
          </div>
          <h1 className="text-xl font-bold">{pr?.title}</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {isMerged ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-purple-100 text-purple-700">
                <GitMerge className="h-3 w-3" /> MERGED
              </span>
            ) : isClosed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-red-100 text-red-700">
                <GitPullRequestClosed className="h-3 w-3" /> CLOSED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-700">
                <GitPullRequest className="h-3 w-3" /> OPEN
              </span>
            )}
            <ReviewStatusBadge status={pr?.reviewStatus ?? 'PENDING'} />
            {pr?.qualityScore !== null && pr?.qualityScore !== undefined && (
              <span className="text-sm font-medium">
                Quality: <span className={`font-bold ${pr.qualityScore >= 80 ? 'text-green-600' : pr.qualityScore >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {pr.qualityScore}/100
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <a
            href={pr?.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border px-3 py-2 text-sm hover:bg-secondary transition-colors"
          >
            View on GitHub ↗
          </a>
          <button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending || pr?.reviewStatus === 'RUNNING'}
            className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${triggerMutation.isPending ? 'animate-spin' : ''}`} />
            {triggerMutation.isPending ? 'Starting...' : 'Re-run Review'}
          </button>
        </div>
      </div>

      {/* ── Review in progress (polling every 3s) ───────────── */}
      {(pr?.reviewStatus === 'RUNNING' || pr?.reviewStatus === 'PENDING') && (
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 p-4">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-400">
              AI review in progress… refreshing automatically
            </span>
          </div>
        </div>
      )}

      {/* ── GitHub PR Actions ───────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">PR Actions</h2>

        {isMerged && (
          <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
            <GitMerge className="h-5 w-5" />
            <span className="text-sm font-medium">This pull request was merged.</span>
          </div>
        )}

        {isClosed && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <GitPullRequestClosed className="h-5 w-5" />
              <span className="text-sm">This pull request is closed.</span>
            </div>
            <button
              onClick={() => reopenMutation.mutate()}
              disabled={anyActionPending}
              className="rounded-lg border border-green-500 text-green-600 px-4 py-2 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-950/30 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <GitPullRequest className="h-4 w-4" />
              {reopenMutation.isPending ? 'Reopening...' : 'Reopen Pull Request'}
            </button>
          </div>
        )}

        {isOpen && (
          <div className="flex items-center gap-3">
            {/* Merge button with method selector */}
            <div className="relative flex" ref={mergeMenuRef}>
              <button
                onClick={() => mergeMutation.mutate()}
                disabled={anyActionPending}
                className="rounded-l-lg bg-green-600 text-white px-4 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <GitMerge className="h-4 w-4" />
                {mergeMutation.isPending ? 'Merging...' : MERGE_METHODS.find(m => m.value === mergeMethod)?.label ?? 'Merge'}
              </button>
              <button
                onClick={() => setShowMergeMenu((v) => !v)}
                disabled={anyActionPending}
                className="rounded-r-lg bg-green-600 text-white px-2 py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 border-l border-green-500 transition-colors"
              >
                <ChevronDown className="h-4 w-4" />
              </button>

              {showMergeMenu && (
                <div className="absolute top-full left-0 mt-1 w-80 rounded-lg border bg-card shadow-lg z-10">
                  {MERGE_METHODS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => { setMergeMethod(m.value); setShowMergeMenu(false); }}
                      className={`w-full text-left px-4 py-3 hover:bg-secondary transition-colors first:rounded-t-lg last:rounded-b-lg ${mergeMethod === m.value ? 'bg-secondary' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        {mergeMethod === m.value && <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />}
                        <span className="text-sm font-medium">{m.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 ml-6">{m.description}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={() => closeMutation.mutate()}
              disabled={anyActionPending}
              className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-secondary text-muted-foreground disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <GitPullRequestClosed className="h-4 w-4" />
              {closeMutation.isPending ? 'Closing...' : 'Close Pull Request'}
            </button>
          </div>
        )}
      </div>

      {/* ── AI Review summary stats ─────────────────────────── */}
      {comments.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Critical', count: criticalComments.length, color: 'text-red-600' },
            { label: 'High', count: highComments.length, color: 'text-orange-600' },
            { label: 'Medium', count: comments.filter((c: any) => c.severity === 'MEDIUM').length, color: 'text-yellow-600' },
            { label: 'Total', count: comments.length, color: 'text-primary' },
          ].map(({ label, count, color }) => (
            <div key={label} className="rounded-lg border bg-card p-4 text-center">
              <div className={`text-2xl font-bold ${color}`}>{count}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── AI Review Comments ──────────────────────────────── */}
      {comments.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">AI Review Comments ({comments.length})</h2>
          {comments.map((comment: any) => {
            const CategoryIcon = CATEGORY_ICONS[comment.category] ?? CheckCircle2;
            return (
              <div key={comment.id} className="rounded-lg border bg-card overflow-hidden">
                <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <CategoryIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <code className="text-xs font-mono text-muted-foreground truncate">
                      {comment.filePath}:{comment.startLine}
                    </code>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-muted-foreground">{comment.category}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[comment.severity] ?? ''}`}>
                      {comment.severity}
                    </span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm font-medium">{comment.issue}</p>
                  <div className="rounded bg-secondary/50 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Suggestion</p>
                    <p className="text-sm">{comment.suggestion}</p>
                  </div>
                  {comment.codeExample && (
                    <pre className="rounded bg-gray-900 p-3 text-xs text-gray-100 overflow-x-auto">
                      <code>{comment.codeExample}</code>
                    </pre>
                  )}
                  <div className="flex gap-2 pt-1">
                    {comment.isAccepted === true ? (
                      <span className="text-xs text-green-600 font-medium">✓ Accepted</span>
                    ) : comment.isAccepted === false ? (
                      <span className="text-xs text-muted-foreground font-medium">✗ Dismissed</span>
                    ) : (
                      <>
                        <button
                          onClick={() => feedbackMutation.mutate({ commentId: comment.id, accepted: true })}
                          disabled={feedbackMutation.isPending}
                          className="text-xs text-green-600 hover:underline disabled:opacity-50"
                        >
                          ✓ Accept
                        </button>
                        <button
                          onClick={() => feedbackMutation.mutate({ commentId: comment.id, accepted: false })}
                          disabled={feedbackMutation.isPending}
                          className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                        >
                          ✗ Dismiss
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : pr?.reviewStatus === 'COMPLETED' ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
          <p className="font-medium">No issues found!</p>
          <p className="text-sm">This pull request looks clean.</p>
        </div>
      ) : pr?.reviewStatus === 'FAILED' ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-red-400" />
          <p className="font-medium">Review failed</p>
          <p className="text-sm">Something went wrong during analysis. Try running the review again.</p>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <GitPullRequest className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No review yet</p>
          <p className="text-sm">Click "Re-run Review" to start an AI review.</p>
        </div>
      )}

      {/* ── Files Changed (Diff Viewer) ─────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">
          Files Changed
          {diffFiles.length > 0 && (
            <span className="ml-2 text-sm text-muted-foreground font-normal">
              ({diffFiles.length} file{diffFiles.length !== 1 ? 's' : ''})
            </span>
          )}
        </h2>
        {diffFiles.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Loading diff…
          </div>
        ) : (
          <DiffViewer
            files={diffFiles}
            lineComments={lineComments}
            onAddLineComment={handleAddLineComment}
          />
        )}
      </div>

      {/* ── GitHub Conversation ─────────────────────────────── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Conversation
          {ghComments.length > 0 && (
            <span className="text-sm text-muted-foreground font-normal">({ghComments.length})</span>
          )}
        </h2>

        {ghComments.length === 0 ? (
          <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground text-sm">
            No comments yet. Be the first to comment.
          </div>
        ) : (
          <div className="space-y-3">
            {ghComments.map((c: any) => (
              <div key={c.id} className="rounded-lg border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-2 border-b bg-muted/30">
                  {c.authorAvatar && (
                    <img src={c.authorAvatar} alt={c.authorLogin} className="h-6 w-6 rounded-full" />
                  )}
                  <span className="text-sm font-medium">{c.authorLogin}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </span>
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    ↗
                  </a>
                </div>
                <div className="px-4 py-3 text-sm whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </div>
        )}

        {/* Add comment box */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
            className="w-full px-4 py-3 text-sm bg-transparent resize-none outline-none"
          />
          <div className="flex justify-end px-4 py-2 border-t bg-muted/20">
            <button
              onClick={() => commentMutation.mutate()}
              disabled={commentMutation.isPending || !commentBody.trim()}
              className="rounded-lg bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              {commentMutation.isPending ? 'Posting...' : 'Comment'}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
});

export default PullRequestDetailPage;
