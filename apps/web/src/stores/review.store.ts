import { makeAutoObservable, runInAction } from 'mobx';
import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../lib/api';

export type ReviewStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CACHED';

export interface LiveReviewState {
  reviewJobId: string;
  status: ReviewStatus;
  progress: number;
  commentsCount?: number;
  qualityScore?: number;
  summary?: string;
  error?: string;
}

class ReviewStore {
  liveReviews = new Map<string, LiveReviewState>();
  private socket: Socket | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  connectWebSocket() {
    if (this.socket?.connected) return;

    const token = getAccessToken();
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';

    this.socket = io(`${wsUrl}/reviews`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      console.log('[WS] Connected to review gateway');
    });

    this.socket.on('review:started', (data: { reviewJobId: string }) => {
      runInAction(() => {
        this.liveReviews.set(data.reviewJobId, {
          reviewJobId: data.reviewJobId,
          status: 'RUNNING',
          progress: 10,
        });
      });
    });

    this.socket.on('review:completed', (data: LiveReviewState) => {
      runInAction(() => {
        this.liveReviews.set(data.reviewJobId, {
          ...data,
          status: 'COMPLETED',
          progress: 100,
        });
      });
    });

    this.socket.on('review:failed', (data: { reviewJobId: string; error: string }) => {
      runInAction(() => {
        const existing = this.liveReviews.get(data.reviewJobId);
        this.liveReviews.set(data.reviewJobId, {
          ...(existing ?? { reviewJobId: data.reviewJobId, progress: 0 }),
          status: 'FAILED',
          error: data.error,
        });
      });
    });
  }

  subscribeToReview(reviewJobId: string) {
    this.socket?.emit('subscribe:review', { reviewJobId });
    if (!this.liveReviews.has(reviewJobId)) {
      runInAction(() => {
        this.liveReviews.set(reviewJobId, {
          reviewJobId,
          status: 'PENDING',
          progress: 0,
        });
      });
    }
  }

  unsubscribeFromReview(reviewJobId: string) {
    this.socket?.emit('unsubscribe:review', { reviewJobId });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  getReviewState(reviewJobId: string): LiveReviewState | undefined {
    return this.liveReviews.get(reviewJobId);
  }
}

export const reviewStore = new ReviewStore();
