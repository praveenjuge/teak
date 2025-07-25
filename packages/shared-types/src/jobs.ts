// Job types for background task management

export type JobType =
  | 'refetch-og-images'
  | 'refetch-screenshots'
  | 'refresh-ai-data'
  | 'process-card'
  | 'ai-enrich-text'
  | 'ai-enrich-image'
  | 'ai-enrich-pdf'
  | 'ai-enrich-audio'
  | 'ai-enrich-url';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: number;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  userId: string;
}

export interface CreateJobRequest {
  type: JobType;
  payload?: Record<string, unknown>;
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
}
