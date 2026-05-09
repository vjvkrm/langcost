export interface ClineModelInfo {
  providerId?: string;
  modelId?: string;
  mode?: string;
  [key: string]: unknown;
}

export interface ClineUiMessage {
  ts?: number;
  type?: string;
  say?: string;
  ask?: string;
  text?: string;
  modelInfo?: ClineModelInfo;
  [key: string]: unknown;
}

export interface ClineApiRequestUsage {
  request?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  cost?: number;
  [key: string]: unknown;
}

export interface ClineTaskHistoryItem {
  id: string;
  ulid?: string;
  ts?: number;
  task?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  totalCost?: number;
  cwdOnTaskInitialization?: string;
  modelId?: string;
  [key: string]: unknown;
}

export interface DiscoveredClineTaskFile {
  filePath: string;
  fileSize: number;
  modifiedAt: Date;
  taskId: string;
  rootPath?: string;
}

export interface ReadClineTaskResult {
  taskId: string;
  sourceFile: string;
  rootPath?: string;
  uiMessages: ClineUiMessage[];
  apiConversationHistory?: unknown[];
  taskHistoryItem?: ClineTaskHistoryItem;
  lastOffset: number;
  lastLineHash?: string;
  errors: Array<{ line?: number; message: string }>;
}
