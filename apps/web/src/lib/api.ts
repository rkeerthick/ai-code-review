import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Send cookies (refresh token)
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

const subscribeTokenRefresh = (cb: (token: string) => void) => {
  refreshSubscribers.push(cb);
};

const onRefreshed = (token: string) => {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
};

// Inject access token from memory store
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
apiClient.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const { data } = await axios.post(
          `${API_BASE}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        const newToken = data.data?.accessToken;
        setAccessToken(newToken);
        onRefreshed(newToken);
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch {
        setAccessToken(null);
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      } finally {
        isRefreshing = false;
      }
    }

    const message = (error.response?.data as any)?.message ?? error.message;
    return Promise.reject(new Error(Array.isArray(message) ? message[0] : message));
  },
);

// In-memory token store (never localStorage — XSS risk)
let _accessToken: string | null = null;

export const setAccessToken = (token: string | null) => { _accessToken = token; };
export const getAccessToken = () => _accessToken;

// Typed API helpers
export const api = {
  // Auth
  register: (data: { name: string; email: string; password: string }) =>
    apiClient.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    apiClient.post('/auth/login', data),
  logout: () => apiClient.post('/auth/logout'),
  me: () => apiClient.get('/auth/me'),

  // Organizations
  createOrg: (name: string) => apiClient.post('/organizations', { name }),
  getOrg: (id: string) => apiClient.get(`/organizations/${id}`),
  getOrgMembers: (id: string) => apiClient.get(`/organizations/${id}/members`),
  inviteMember: (orgId: string, data: { email: string; role: string }) =>
    apiClient.post(`/organizations/${orgId}/members/invite`, data),
  removeMember: (orgId: string, userId: string) =>
    apiClient.delete(`/organizations/${orgId}/members/${userId}`),

  // Repositories
  listGitHubRepos: (page = 1) => apiClient.get('/github/repositories', { params: { page } }),
  importRepo: (orgId: string, githubId: number) =>
    apiClient.post('/repositories', { githubId }, { headers: { 'X-Org-Id': orgId } }),
  listRepos: (orgId: string, page = 1) =>
    apiClient.get('/repositories', { params: { page }, headers: { 'X-Org-Id': orgId } }),
  getRepo: (id: string) => apiClient.get(`/repositories/${id}`),
  removeRepo: (id: string) => apiClient.delete(`/repositories/${id}`),
  syncPRs: (orgId: string, repoId: string) =>
    apiClient.post(`/repositories/${repoId}/sync-prs`, {}, { headers: { 'X-Org-Id': orgId } }),
  updateRepoSettings: (id: string, data: any) => apiClient.patch(`/repositories/${id}/settings`, data),

  // Pull Requests
  listPRs: (orgId: string, filters?: any, page = 1) =>
    apiClient.get('/pull-requests', { params: { ...filters, page }, headers: { 'X-Org-Id': orgId } }),
  getPR: (id: string, orgId?: string) =>
    apiClient.get(`/pull-requests/${id}`, orgId ? { headers: { 'X-Org-Id': orgId } } : {}),
  mergePR: (id: string, orgId: string, method: 'merge' | 'squash' | 'rebase') =>
    apiClient.post(`/pull-requests/${id}/merge`, { method }, { headers: { 'X-Org-Id': orgId } }),
  closePR: (id: string, orgId: string) =>
    apiClient.post(`/pull-requests/${id}/close`, {}, { headers: { 'X-Org-Id': orgId } }),
  reopenPR: (id: string, orgId: string) =>
    apiClient.post(`/pull-requests/${id}/reopen`, {}, { headers: { 'X-Org-Id': orgId } }),
  getPRComments: (id: string, orgId: string) =>
    apiClient.get(`/pull-requests/${id}/comments`, { headers: { 'X-Org-Id': orgId } }),
  addPRComment: (id: string, orgId: string, body: string) =>
    apiClient.post(`/pull-requests/${id}/comments`, { body }, { headers: { 'X-Org-Id': orgId } }),
  getPRDiff: (id: string, orgId: string) =>
    apiClient.get(`/pull-requests/${id}/diff`, { headers: { 'X-Org-Id': orgId } }),
  getPRLineComments: (id: string, orgId: string) =>
    apiClient.get(`/pull-requests/${id}/line-comments`, { headers: { 'X-Org-Id': orgId } }),
  addPRLineComment: (id: string, orgId: string, filePath: string, line: number, side: 'LEFT' | 'RIGHT', body: string) =>
    apiClient.post(`/pull-requests/${id}/line-comments`, { filePath, line, side, body }, { headers: { 'X-Org-Id': orgId } }),

  // AI Reviews
  triggerReview: (prId: string, orgId: string) =>
    apiClient.post(`/reviews/pull-requests/${prId}/trigger`, {}, { headers: { 'X-Org-Id': orgId } }),
  getReviewJob: (jobId: string) => apiClient.get(`/reviews/jobs/${jobId}`),
  getReviewComments: (jobId: string, filters?: any) =>
    apiClient.get(`/reviews/jobs/${jobId}/comments`, { params: filters }),
  submitFeedback: (commentId: string, orgId: string, accepted: boolean, note?: string) =>
    apiClient.patch(`/reviews/comments/${commentId}/feedback`, { accepted, note }, { headers: { 'X-Org-Id': orgId } }),

  // Analytics
  getDashboardStats: (orgId: string) =>
    apiClient.get('/analytics/dashboard', { headers: { 'X-Org-Id': orgId } }),
  getQualityTrend: (orgId: string, days = 30) =>
    apiClient.get('/analytics/quality-trend', { params: { days }, headers: { 'X-Org-Id': orgId } }),

  // Billing
  createCheckout: (plan: 'PRO' | 'TEAM') => apiClient.post('/billing/checkout', { plan }),
  createPortal: () => apiClient.post('/billing/portal'),
  getSubscription: () => apiClient.get('/billing/subscription'),
} as const;
