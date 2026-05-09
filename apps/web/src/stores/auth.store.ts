import { makeAutoObservable, runInAction } from 'mobx';
import { api, setAccessToken } from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  githubUsername?: string;
  emailVerified: boolean;
  orgMemberships?: Array<{
    role: string;
    organization: { id: string; name: string; slug: string; plan: string };
  }>;
}

class AuthStore {
  user: AuthUser | null = null;
  isLoading = false;
  currentOrgId: string | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get isAuthenticated() {
    return this.user !== null;
  }

  get currentOrg() {
    return this.user?.orgMemberships?.find(
      (m) => m.organization.id === this.currentOrgId,
    )?.organization ?? null;
  }

  get userRole() {
    return (
      this.user?.orgMemberships?.find(
        (m) => m.organization.id === this.currentOrgId,
      )?.role ?? null
    );
  }

  setUser(user: AuthUser | null) {
    this.user = user;
    if (user?.orgMemberships?.[0]) {
      this.currentOrgId ??= user.orgMemberships[0].organization.id;
    }
  }

  setCurrentOrg(orgId: string) {
    this.currentOrgId = orgId;
  }

  async loadUser() {
    try {
      this.isLoading = true;
      const response = await api.me() as any;
      runInAction(() => {
        this.setUser(response.data);
      });
    } catch {
      runInAction(() => { this.user = null; });
    } finally {
      runInAction(() => { this.isLoading = false; });
    }
  }

  async login(email: string, password: string) {
    const response = await api.login({ email, password }) as any;
    setAccessToken(response.data.accessToken);
    runInAction(() => { this.setUser(response.data.user); });
    return response.data;
  }

  async register(name: string, email: string, password: string) {
    const response = await api.register({ name, email, password }) as any;
    setAccessToken(response.data.accessToken);
    runInAction(() => { this.setUser(response.data.user); });
    return response.data;
  }

  async logout() {
    try {
      await api.logout();
    } finally {
      setAccessToken(null);
      runInAction(() => {
        this.user = null;
        this.currentOrgId = null;
      });
    }
  }
}

export const authStore = new AuthStore();
