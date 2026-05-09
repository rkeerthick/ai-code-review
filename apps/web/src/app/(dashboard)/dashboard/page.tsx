'use client';

import { useQuery } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import { GitPullRequest, Shield, Zap, Star, TrendingUp, AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { authStore } from '../../../stores/auth.store';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#3b82f6',
  INFO: '#6b7280',
};

const CATEGORY_COLORS: Record<string, string> = {
  SECURITY: '#ef4444',
  BUG: '#f97316',
  PERFORMANCE: '#8b5cf6',
  QUALITY: '#3b82f6',
  BEST_PRACTICE: '#10b981',
  TESTING: '#6b7280',
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color = 'text-primary',
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className={`h-5 w-5 ${color}`} />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

const DashboardPage = observer(function DashboardPage() {
  const orgId = authStore.currentOrgId;

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', orgId],
    queryFn: () => api.getDashboardStats(orgId!) as any,
    enabled: !!orgId,
    refetchInterval: 30000,
  });

  const { data: trendData } = useQuery({
    queryKey: ['quality-trend', orgId],
    queryFn: () => api.getQualityTrend(orgId!) as any,
    enabled: !!orgId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const stats = data?.data;
  const trend = trendData?.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview for {authStore.currentOrg?.name}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={GitPullRequest}
          label="Open Pull Requests"
          value={stats?.overview.openPullRequests ?? 0}
          sub={`${stats?.overview.totalPullRequests ?? 0} total`}
        />
        <StatCard
          icon={Star}
          label="Avg Quality Score"
          value={`${stats?.overview.averageQualityScore ?? 0}/100`}
          sub="Last 30 days"
          color="text-yellow-500"
        />
        <StatCard
          icon={Zap}
          label="Reviews This Month"
          value={stats?.overview.reviewsThisMonth ?? 0}
          sub={`${stats?.usage.reviewsUsed ?? 0} / plan limit`}
          color="text-green-500"
        />
        <StatCard
          icon={Shield}
          label="Total Repositories"
          value={stats?.overview.totalRepositories ?? 0}
          sub="Connected to platform"
          color="text-blue-500"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Quality Trend */}
        <div className="lg:col-span-2 rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Quality Score Trend</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="updatedAt"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => new Date(v).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v}/100`, 'Score']}
                labelFormatter={(l) => new Date(l).toLocaleDateString()}
              />
              <Line
                type="monotone"
                dataKey="qualityScore"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Issues by Severity */}
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <h3 className="font-semibold">Issues by Severity</h3>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={stats?.issuesBySeverity ?? []}
                dataKey="count"
                nameKey="severity"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ severity, count }) => `${severity}: ${count}`}
                labelLine={false}
              >
                {(stats?.issuesBySeverity ?? []).map((entry: any) => (
                  <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] ?? '#6b7280'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Issues by Category */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Issues by Category (Last 30 Days)</h3>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={stats?.issuesByCategory ?? []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="category" type="category" tick={{ fontSize: 11 }} width={100} />
            <Tooltip />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {(stats?.issuesByCategory ?? []).map((entry: any) => (
                <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category] ?? '#6b7280'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Reviews */}
      <div className="rounded-lg border bg-card">
        <div className="p-6 border-b">
          <h3 className="font-semibold">Recent Reviews</h3>
        </div>
        <div className="divide-y">
          {(stats?.recentReviews ?? []).map((review: any) => (
            <div key={review.id} className="flex items-center justify-between p-4 hover:bg-muted/30">
              <div className="space-y-0.5">
                <p className="font-medium text-sm">{review.pullRequest?.title}</p>
                <p className="text-xs text-muted-foreground">
                  {review.pullRequest?.repository?.fullName} • PR #{review.pullRequest?.githubPrNumber}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {review._count?.reviewComments} issues
                </span>
                <div
                  className={`text-sm font-bold ${
                    (review.pullRequest?.qualityScore ?? 0) >= 80
                      ? 'text-green-600'
                      : (review.pullRequest?.qualityScore ?? 0) >= 60
                      ? 'text-yellow-600'
                      : 'text-red-600'
                  }`}
                >
                  {review.pullRequest?.qualityScore ?? '-'}/100
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default DashboardPage;
