'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import {
  User, Building2, GitBranch, CreditCard,
  Trash2, UserPlus, Crown, Shield, Eye, Loader2,
  Github, Plus, Lock, Globe,
} from 'lucide-react';
import { authStore } from '../../../stores/auth.store';
import { api } from '../../../lib/api';

// ── Schemas ──────────────────────────────────────────────────────────────────

const orgSchema = z.object({ name: z.string().min(2, 'At least 2 characters') });
const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});
const createOrgSchema = z.object({ name: z.string().min(2, 'At least 2 characters') });

type OrgForm = z.infer<typeof orgSchema>;
type InviteForm = z.infer<typeof inviteSchema>;
type CreateOrgForm = z.infer<typeof createOrgSchema>;

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  OWNER:  { label: 'Owner',  icon: Crown,  className: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20' },
  ADMIN:  { label: 'Admin',  icon: Shield, className: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20' },
  MEMBER: { label: 'Member', icon: User,   className: 'text-green-600 bg-green-50 dark:bg-green-900/20' },
  VIEWER: { label: 'Viewer', icon: Eye,    className: 'text-gray-600 bg-gray-50 dark:bg-gray-900/20' },
};

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.VIEWER;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-6 py-4 border-b">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const SettingsPage = observer(function SettingsPage() {
  const qc = useQueryClient();
  const orgId = authStore.currentOrgId;
  const [activeTab, setActiveTab] = useState<'profile' | 'organization' | 'members' | 'repositories' | 'billing'>('profile');

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => api.getOrgMembers(orgId!) as any,
    enabled: !!orgId && activeTab === 'members',
  });

  const { data: reposData, isLoading: reposLoading } = useQuery({
    queryKey: ['repos', orgId],
    queryFn: () => api.listRepos(orgId!) as any,
    enabled: !!orgId && activeTab === 'repositories',
  });

  const [showImport, setShowImport] = useState(false);

  const { data: ghReposData, isLoading: ghReposLoading, error: ghReposError } = useQuery({
    queryKey: ['github-repos'],
    queryFn: () => api.listGitHubRepos() as any,
    enabled: activeTab === 'repositories' && showImport && !!authStore.user?.githubUsername,
    retry: false,
  });

  const { data: subscriptionData } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api.getSubscription() as any,
    enabled: activeTab === 'billing',
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeMember(orgId!, userId) as any,
    onSuccess: () => { toast.success('Member removed'); qc.invalidateQueries({ queryKey: ['org-members'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const removeRepoMutation = useMutation({
    mutationFn: (repoId: string) => api.removeRepo(repoId) as any,
    onSuccess: () => { toast.success('Repository removed'); qc.invalidateQueries({ queryKey: ['repos'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const importRepoMutation = useMutation({
    mutationFn: (githubId: number) => api.importRepo(orgId!, githubId) as any,
    onSuccess: (_, githubId) => {
      toast.success('Repository imported — webhook registered');
      qc.invalidateQueries({ queryKey: ['repos'] });
      qc.invalidateQueries({ queryKey: ['github-repos'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: (plan: 'PRO' | 'TEAM') => api.createCheckout(plan) as any,
    onSuccess: (res: any) => {
      const url = res?.data?.url;
      if (url) window.location.href = url;
    },
    onError: (e: any) => toast.error(e.message ?? 'Billing unavailable — add Stripe keys to .env'),
  });

  const portalMutation = useMutation({
    mutationFn: () => api.createPortal() as any,
    onSuccess: (res: any) => { const url = res?.data?.url; if (url) window.location.href = url; },
    onError: (e: any) => toast.error(e.message),
  });

  const createOrgMutation = useMutation({
    mutationFn: (name: string) => api.createOrg(name) as any,
    onSuccess: async () => {
      toast.success('Organization created');
      await authStore.loadUser();
      qc.invalidateQueries({ queryKey: ['org-members'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteForm) => api.inviteMember(orgId!, data) as any,
    onSuccess: () => { toast.success('Invite sent'); qc.invalidateQueries({ queryKey: ['org-members'] }); inviteForm.reset(); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Forms ─────────────────────────────────────────────────────────────────

  const inviteForm = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'MEMBER' },
  });

  const createOrgForm = useForm<CreateOrgForm>({ resolver: zodResolver(createOrgSchema) });

  const members: any[] = membersData?.data ?? [];
  const repos: any[] = reposData?.data?.data ?? reposData?.data?.items ?? [];
  const subscription = subscriptionData?.data;

  const TABS = [
    { id: 'profile',      label: 'Profile',       icon: User },
    { id: 'organization', label: 'Organization',  icon: Building2 },
    { id: 'members',      label: 'Members',       icon: UserPlus },
    { id: 'repositories', label: 'Repositories',  icon: GitBranch },
    { id: 'billing',      label: 'Billing',       icon: CreditCard },
  ] as const;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your account and organization</p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Profile tab ─────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <Section title="Your Profile" description="Basic account information">
          <div className="flex items-center gap-4 mb-6">
            {authStore.user?.avatarUrl ? (
              <img src={authStore.user.avatarUrl} className="h-16 w-16 rounded-full" alt="avatar" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-8 w-8 text-primary" />
              </div>
            )}
            <div>
              <p className="font-semibold text-lg">{authStore.user?.name}</p>
              <p className="text-sm text-muted-foreground">{authStore.user?.email}</p>
              {authStore.user?.githubUsername && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  GitHub: @{authStore.user.githubUsername}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border p-3 space-y-0.5">
              <p className="text-muted-foreground text-xs">Role</p>
              <p className="font-medium capitalize">{authStore.user?.role?.toLowerCase()}</p>
            </div>
            <div className="rounded-lg border p-3 space-y-0.5">
              <p className="text-muted-foreground text-xs">Email verified</p>
              <p className={`font-medium ${authStore.user?.emailVerified ? 'text-green-600' : 'text-yellow-600'}`}>
                {authStore.user?.emailVerified ? 'Verified' : 'Not verified'}
              </p>
            </div>
          </div>
        </Section>
      )}

      {/* ── Organization tab ─────────────────────────────────────────────── */}
      {activeTab === 'organization' && (
        <>
          {authStore.currentOrg ? (
            <Section title="Organization Details">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: 'Name',  value: authStore.currentOrg.name },
                  { label: 'Slug',  value: authStore.currentOrg.slug },
                  { label: 'Plan',  value: authStore.currentOrg.plan },
                  { label: 'Your role', value: authStore.userRole },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border p-3 space-y-0.5">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="font-medium capitalize">{value?.toLowerCase()}</p>
                  </div>
                ))}
              </div>
            </Section>
          ) : (
            <Section title="Create an Organization" description="You're not in an organization yet.">
              <form
                onSubmit={createOrgForm.handleSubmit((d) => createOrgMutation.mutate(d.name))}
                className="flex gap-2 max-w-sm"
              >
                <input
                  {...createOrgForm.register('name')}
                  placeholder="My Company"
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={createOrgMutation.isPending}
                  className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {createOrgMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create
                </button>
              </form>
              {createOrgForm.formState.errors.name && (
                <p className="text-xs text-destructive mt-1">{createOrgForm.formState.errors.name.message}</p>
              )}
            </Section>
          )}
        </>
      )}

      {/* ── Members tab ──────────────────────────────────────────────────── */}
      {activeTab === 'members' && (
        <div className="space-y-5">
          {/* Invite form */}
          {orgId && (
            <Section title="Invite Member">
              <form onSubmit={inviteForm.handleSubmit((d) => inviteMutation.mutate(d))} className="flex gap-2">
                <input
                  {...inviteForm.register('email')}
                  placeholder="colleague@company.com"
                  type="email"
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  {...inviteForm.register('role')}
                  className="rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="MEMBER">Member</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={inviteMutation.isPending}
                  className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {inviteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  Invite
                </button>
              </form>
              {inviteForm.formState.errors.email && (
                <p className="text-xs text-destructive mt-1">{inviteForm.formState.errors.email.message}</p>
              )}
            </Section>
          )}

          {/* Members list */}
          <Section title="Team Members">
            {membersLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {orgId ? 'No members yet. Invite your team above.' : 'Join or create an organization first.'}
              </p>
            ) : (
              <div className="divide-y -mx-6">
                {members.map((m: any) => (
                  <div key={m.id ?? m.user?.id} className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      {m.user?.avatarUrl ? (
                        <img src={m.user.avatarUrl} className="h-8 w-8 rounded-full" alt="" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium">{m.user?.name ?? m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.user?.email ?? m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <RoleBadge role={m.role} />
                      {m.role !== 'OWNER' && authStore.userRole !== 'VIEWER' && (
                        <button
                          onClick={() => removeMemberMutation.mutate(m.user?.id ?? m.userId)}
                          disabled={removeMemberMutation.isPending}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── Repositories tab ─────────────────────────────────────────────── */}
      {activeTab === 'repositories' && (
        <div className="space-y-5">
          {/* GitHub not connected warning */}
          {!authStore.user?.githubUsername && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-4 flex items-start gap-3">
              <Github className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">GitHub not connected</p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-0.5">
                  Connect your GitHub account to import repositories.
                </p>
              </div>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/auth/github`}
                className="flex-shrink-0 rounded-lg bg-gray-900 text-white px-3 py-1.5 text-xs font-medium hover:bg-gray-700 transition-colors flex items-center gap-1.5"
              >
                <Github className="h-3.5 w-3.5" />
                Connect GitHub
              </a>
            </div>
          )}

          {/* No org yet — prompt to create one */}
          {authStore.user?.githubUsername && !orgId && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 p-4 flex items-start gap-3">
              <Building2 className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Create an organization first</p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                  You need an organization to import repositories.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('organization')}
                className="flex-shrink-0 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700 transition-colors"
              >
                Create org →
              </button>
            </div>
          )}

          {/* Connected repos */}
          <Section
            title="Connected Repositories"
            description="Repositories with active webhooks for AI reviews"
          >
            <div className="flex justify-between items-center mb-4">
              {authStore.user?.githubUsername && orgId && (
                <button
                  onClick={() => setShowImport((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Import from GitHub
                </button>
              )}
            </div>

            {/* Import picker */}
            {showImport && (
              <div className="mb-5 rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-medium">Select a repository to import</p>
                {ghReposLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading your GitHub repositories…
                  </div>
                ) : ghReposError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                    Could not load repositories — make sure your GitHub account is connected via OAuth.
                    <br />
                    <span className="text-xs opacity-75">{(ghReposError as any)?.message}</span>
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto divide-y rounded-lg border bg-card">
                    {(ghReposData?.data ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">No repositories found on your GitHub account</p>
                    ) : (
                      (ghReposData?.data ?? []).map((repo: any) => {
                        const alreadyImported = repos.some((r: any) => r.githubId === repo.githubId);
                        const isImporting = importRepoMutation.isPending && importRepoMutation.variables === repo.githubId;
                        return (
                          <button
                            key={repo.githubId}
                            onClick={() => !alreadyImported && importRepoMutation.mutate(repo.githubId)}
                            disabled={alreadyImported || importRepoMutation.isPending}
                            className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors
                              ${alreadyImported
                                ? 'opacity-60 cursor-default'
                                : 'hover:bg-muted/60 cursor-pointer'
                              } disabled:opacity-60`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {repo.isPrivate
                                  ? <Lock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                  : <Globe className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                }
                                <span className="text-sm font-mono font-medium truncate">{repo.fullName}</span>
                              </div>
                              {repo.language && (
                                <span className="text-xs text-muted-foreground ml-5">{repo.language}</span>
                              )}
                            </div>
                            {alreadyImported ? (
                              <span className="flex-shrink-0 text-xs text-green-600 font-medium">✓ Imported</span>
                            ) : isImporting ? (
                              <Loader2 className="flex-shrink-0 h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <span className="flex-shrink-0 text-xs rounded border px-2.5 py-1 bg-primary text-primary-foreground font-medium">
                                Import
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {reposLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : repos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground space-y-1">
                <GitBranch className="h-10 w-10 mx-auto opacity-20" />
                <p className="font-medium">No repositories connected yet</p>
                <p className="text-sm">Click "Import from GitHub" above to get started.</p>
              </div>
            ) : (
              <div className="divide-y -mx-6">
                {repos.map((repo: any) => (
                  <div key={repo.id} className="flex items-center justify-between px-6 py-3">
                    <div>
                      <div className="flex items-center gap-1.5">
                        {repo.isPrivate
                          ? <Lock className="h-3 w-3 text-muted-foreground" />
                          : <Globe className="h-3 w-3 text-muted-foreground" />
                        }
                        <p className="text-sm font-medium font-mono">{repo.fullName}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                        {repo.language ?? 'Unknown'} · {repo._count?.pullRequests ?? 0} PRs reviewed
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                        repo.webhookActive
                          ? 'bg-green-50 text-green-700 dark:bg-green-900/20'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800'
                      }`}>
                        {repo.webhookActive ? '● Webhook active' : '○ Webhook inactive'}
                      </span>
                      <button
                        onClick={() => { if (confirm(`Remove ${repo.fullName}?`)) removeRepoMutation.mutate(repo.id); }}
                        disabled={removeRepoMutation.isPending}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Remove repository"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}

      {/* ── Billing tab ──────────────────────────────────────────────────── */}
      {activeTab === 'billing' && (
        <div className="space-y-5">
          {/* Current plan */}
          <Section title="Current Plan">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold capitalize">
                  {authStore.currentOrg?.plan?.toLowerCase() ?? 'Free'}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {subscription?.status === 'ACTIVE'
                    ? `Renews ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : 'soon'}`
                    : 'No active subscription'}
                </p>
              </div>
              {subscription?.status === 'ACTIVE' && (
                <button
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-secondary transition-colors flex items-center gap-1.5"
                >
                  {portalMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Manage subscription
                </button>
              )}
            </div>
          </Section>

          {/* Plan cards */}
          {(!authStore.currentOrg?.plan || authStore.currentOrg.plan === 'FREE') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  plan: 'PRO' as const,
                  price: '$29/mo',
                  features: ['25 repositories', '5 team members', '500 reviews/month', 'Priority support'],
                  highlight: true,
                },
                {
                  plan: 'TEAM' as const,
                  price: '$99/mo',
                  features: ['100 repositories', '25 team members', '2,500 reviews/month', 'Dedicated support'],
                  highlight: false,
                },
              ].map(({ plan, price, features, highlight }) => (
                <div
                  key={plan}
                  className={`rounded-lg border p-5 space-y-4 ${highlight ? 'border-primary ring-1 ring-primary' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-lg">{plan}</p>
                      <p className="text-2xl font-bold">{price}</p>
                    </div>
                    {highlight && (
                      <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5 font-medium">
                        Popular
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1.5">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-green-500">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => checkoutMutation.mutate(plan)}
                    disabled={checkoutMutation.isPending}
                    className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      highlight
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border hover:bg-secondary'
                    } disabled:opacity-50`}
                  >
                    {checkoutMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Upgrade to {plan}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default SettingsPage;
