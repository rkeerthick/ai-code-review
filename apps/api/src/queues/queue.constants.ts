export const QUEUE_NAMES = {
  AI_REVIEW: 'ai-review',
  NOTIFICATIONS: 'notifications',
  EMBEDDINGS: 'embeddings',
  GITHUB_SYNC: 'github-sync',
} as const;

export const JOB_NAMES = {
  PROCESS_PR_REVIEW: 'process-pr-review',
  SEND_EMAIL: 'send-email',
  SEND_SLACK: 'send-slack',
  INDEX_REPOSITORY: 'index-repository',
  INDEX_FILE: 'index-file',
  SYNC_PULL_REQUESTS: 'sync-pull-requests',
} as const;
