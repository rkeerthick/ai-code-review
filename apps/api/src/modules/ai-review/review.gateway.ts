import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGINS?.split(',') ?? '*', credentials: true },
  namespace: '/reviews',
})
export class ReviewGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReviewGateway.name);

  // Map userId → Set of socket IDs (user may have multiple tabs)
  private userSockets = new Map<string, Set<string>>();
  // Map jobId → Set of subscriber socket IDs
  private jobSubscribers = new Map<string, Set<string>>();

  constructor(private jwt: JwtService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token ?? socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('No token');

      const payload = this.jwt.verify(token) as any;
      socket.data.userId = payload.sub;
      socket.data.email = payload.email;

      const existing = this.userSockets.get(payload.sub) ?? new Set();
      existing.add(socket.id);
      this.userSockets.set(payload.sub, existing);

      this.logger.debug(`WS connected: ${socket.id} user=${payload.sub}`);
    } catch {
      socket.emit('error', { message: 'Authentication failed' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId;
    if (userId) {
      const sockets = this.userSockets.get(userId);
      sockets?.delete(socket.id);
      if (!sockets?.size) this.userSockets.delete(userId);
    }

    // Clean up job subscriptions
    for (const [jobId, subscribers] of this.jobSubscribers.entries()) {
      subscribers.delete(socket.id);
      if (!subscribers.size) this.jobSubscribers.delete(jobId);
    }

    this.logger.debug(`WS disconnected: ${socket.id}`);
  }

  @SubscribeMessage('subscribe:review')
  handleSubscribe(
    @MessageBody() data: { reviewJobId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const existing = this.jobSubscribers.get(data.reviewJobId) ?? new Set();
    existing.add(socket.id);
    this.jobSubscribers.set(data.reviewJobId, existing);
    socket.emit('subscribed', { reviewJobId: data.reviewJobId });
  }

  @SubscribeMessage('unsubscribe:review')
  handleUnsubscribe(
    @MessageBody() data: { reviewJobId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    this.jobSubscribers.get(data.reviewJobId)?.delete(socket.id);
  }

  @OnEvent('review.started')
  handleReviewStarted(payload: { reviewJobId: string; pullRequestId: string }) {
    this.broadcastToJobSubscribers(payload.reviewJobId, 'review:started', payload);
  }

  @OnEvent('review.completed')
  handleReviewCompleted(payload: {
    reviewJobId: string;
    pullRequestId: string;
    commentsCount: number;
    qualityScore: number;
    summary: string;
  }) {
    this.broadcastToJobSubscribers(payload.reviewJobId, 'review:completed', payload);
  }

  @OnEvent('review.failed')
  handleReviewFailed(payload: { reviewJobId: string; pullRequestId: string; error: string }) {
    this.broadcastToJobSubscribers(payload.reviewJobId, 'review:failed', payload);
  }

  private broadcastToJobSubscribers(jobId: string, event: string, data: any) {
    const subscribers = this.jobSubscribers.get(jobId);
    if (!subscribers?.size) return;

    for (const socketId of subscribers) {
      this.server.to(socketId).emit(event, data);
    }

    this.logger.debug(`Broadcast ${event} to ${subscribers.size} subscribers for job ${jobId}`);
  }
}
