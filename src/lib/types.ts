export interface DocumentMetadata {
  date?: string;
  date_precision?: 'day' | 'month' | 'year';
  client?: string;
  project_number?: string;
  person?: string;
  institution?: string;
  provider?: string;
  company?: string;
  party?: string;
  sender?: string;
  year?: string;
  subject?: string;
  document_type?: string;
}

export interface ClassificationResult {
  category: string;  // deprecated, kept for compatibility
  tags: string[];    // hierarchical paths like ["/financial/taxes/2024", "/personal"]
  confidence: number;
  suggested_filename: string;
  metadata: DocumentMetadata;
  summary: string;
}

export interface Tag {
  id: number;
  name: string;
  parent_id: number | null;
  full_path: string;
  created_at: string;
}

export interface DocumentTag {
  document_id: number;
  tag_id: number;
  is_primary: boolean;
  created_at: string;
}

export interface Document {
  id: number;
  filepath: string;
  filename: string;
  category: string;
  document_type: string | null;
  date: string | null;
  date_precision: string | null;
  year: string | null;
  client: string | null;
  project_number: string | null;
  person: string | null;
  institution: string | null;
  provider: string | null;
  company: string | null;
  subject: string | null;
  summary: string | null;
  confidence: number;
  indexed_at: string;
  source_file: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  original_category: string | null;
}

export type QueueSourceType = 'scanner' | 'web-upload' | 'email' | 'api' | 'remote-sync';
export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dismissed';

export interface QueueItem {
  id: number;
  filepath: string;
  source_type: QueueSourceType;
  source_metadata: string | null;
  status: QueueStatus;
  priority: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  result_document_id: number | null;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface SearchOptions {
  category?: string;
  client?: string;
  project?: string;
  year?: string;
  person?: string;
  personId?: number;
  tag?: string;
  text?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export interface Person {
  id: number;
  display_name: string;
  canonical_name: string;
  is_family: boolean;
  created_at: string;
}

export interface PersonAlias {
  id: number;
  person_id: number;
  alias: string;
}
