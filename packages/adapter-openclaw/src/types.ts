export interface OpenClawUsageCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface OpenClawUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: OpenClawUsageCost;
}

export interface OpenClawTextBlock {
  type: "text";
  text?: string;
}

export interface OpenClawThinkingBlock {
  type: "thinking";
  thinking?: string;
  text?: string;
  thinkingSignature?: string;
}

export interface OpenClawToolCallBlock {
  type: "toolCall";
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface OpenClawImageBlock {
  type: "image";
  mediaType?: string;
  mimeType?: string;
  source?: unknown;
}

export interface OpenClawUnknownBlock {
  type: string;
  [key: string]: unknown;
}

export type OpenClawContentBlock =
  | OpenClawImageBlock
  | OpenClawTextBlock
  | OpenClawThinkingBlock
  | OpenClawToolCallBlock
  | OpenClawUnknownBlock;

export interface OpenClawSessionEntry {
  type: "session";
  id: string;
  timestamp?: string;
  cwd?: string;
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  branchedFrom?: string;
  [key: string]: unknown;
}

export interface OpenClawBaseMessage {
  role: string;
  timestamp?: number;
  content?: OpenClawContentBlock[] | string;
  [key: string]: unknown;
}

export interface OpenClawUserMessage extends OpenClawBaseMessage {
  role: "user";
}

export interface OpenClawAssistantMessage extends OpenClawBaseMessage {
  role: "assistant";
  api?: string;
  provider?: string;
  model?: string;
  usage?: OpenClawUsage;
  stopReason?: string;
  errorMessage?: string;
}

export interface OpenClawToolResultMessage extends OpenClawBaseMessage {
  role: "toolResult";
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: Record<string, unknown>;
}

export interface OpenClawMessageEntry {
  type: "message";
  timestamp?: string;
  message: OpenClawAssistantMessage | OpenClawToolResultMessage | OpenClawUserMessage | OpenClawBaseMessage;
}

export interface OpenClawModelChangeEntry {
  type: "model_change";
  timestamp?: string;
  provider?: string;
  modelId?: string;
  model?: string;
  [key: string]: unknown;
}

export interface OpenClawCompactionEntry {
  type: "compaction";
  timestamp?: string;
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  [key: string]: unknown;
}

export interface OpenClawUnknownEntry {
  type: string;
  timestamp?: string;
  [key: string]: unknown;
}

export type OpenClawEntry =
  | OpenClawCompactionEntry
  | OpenClawMessageEntry
  | OpenClawModelChangeEntry
  | OpenClawSessionEntry
  | OpenClawUnknownEntry;

export interface DiscoveredSessionFile {
  agentId?: string;
  filePath: string;
  fileSize: number;
  modifiedAt: Date;
  sessionId: string;
}

export interface ReadSessionResult {
  entries: OpenClawEntry[];
  lastLineHash?: string;
  lastOffset: number;
  errors: Array<{ line: number; message: string }>;
}
