export interface AdapterMeta {
  name: string;
  version: string;
  description: string;
  sourceType: "local" | "api";
}

export interface IngestOptions {
  sourcePath?: string;
  file?: string;
  apiKey?: string;
  apiUrl?: string;
  since?: Date;
  force?: boolean;
  onProgress?: (event: IngestProgressEvent) => void;
}

export interface IngestProgressEvent {
  phase: "discovering" | "reading" | "normalizing" | "writing";
  current: number;
  total?: number;
  sessionId?: string;
}

export interface IngestResult {
  tracesIngested: number;
  spansIngested: number;
  messagesIngested: number;
  skipped: number;
  errors: IngestError[];
  durationMs: number;
}

export interface IngestError {
  file: string;
  line?: number;
  message: string;
}

export interface IAdapter<Db = unknown> {
  readonly meta: AdapterMeta;
  ingest(db: Db, options?: IngestOptions): Promise<IngestResult>;
  validate(options?: IngestOptions): Promise<{ ok: boolean; message: string }>;
}
