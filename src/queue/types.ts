export interface NotificationJob {
  applicationId: string;
  email: string;
  candidateName: string;
  jobTitle: string;
}

export interface StatsUpdateJob {
  recruiterId: string;
  applicationId: string;
  jobId: string;
}

export interface AuditLogJob {
  applicationId: string;
  action: string;
  userId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface QueueStats {
  waiting: number;
  active: number;
  failed: number;
  delayed?: number;
  paused?: number;
}

export type QueueName = 'notifications' | 'stats-updates' | 'audit-logs';
