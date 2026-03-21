export interface AnalyzerMeta {
  name: string;
  version: string;
  description: string;
  priority: number;
}

export interface AnalyzeOptions {
  traceIds?: string[];
  since?: Date;
  force?: boolean;
  onProgress?: (event: { current: number; total: number }) => void;
}

export interface AnalyzeResult {
  tracesAnalyzed: number;
  findingsCount: number;
  durationMs: number;
}

export interface IAnalyzer<Db = unknown> {
  readonly meta: AnalyzerMeta;
  analyze(db: Db, options?: AnalyzeOptions): Promise<AnalyzeResult>;
}
