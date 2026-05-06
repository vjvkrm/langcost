export interface CliIo {
  write(message: string): void;
  error(message: string): void;
  useColor: boolean;
}

export interface DashboardServer {
  port: number;
  stop(closeActiveConnections?: boolean): void;
}

export interface DashboardModule {
  startApiServer(port?: number, options?: { dbPath?: string }): DashboardServer;
  runConfiguredScan(
    dbPath?: string,
    force?: boolean,
  ): Promise<{
    tracesIngested: number;
    spansIngested: number;
    messagesIngested: number;
    skipped: number;
    durationMs: number;
  }>;
}

export interface DashboardRuntimeHooks {
  loadModule?: () => Promise<DashboardModule>;
  openUrl?: (url: string) => Promise<void>;
  waitForShutdown?: (server: DashboardServer) => Promise<void>;
}

export interface CliRuntime {
  io: CliIo;
  now: () => Date;
  dashboard?: DashboardRuntimeHooks;
}

export type WarpPlanOption = "build" | "business" | "add-on-low" | "add-on-high" | "byok";

export interface ScanCommandOptions {
  command: "scan";
  source: string;
  sourcePath?: string;
  file?: string;
  warpPlan?: WarpPlanOption;
  since?: Date;
  force: boolean;
  dbPath?: string;
  apiKey?: string;
  apiUrl?: string;
}

export interface ReportCommandOptions {
  command: "report";
  format: "table" | "json" | "markdown";
  sort: "cost" | "waste" | "date";
  limit: number;
  traceId?: string;
  category?: string;
  dbPath?: string;
}

export interface StatusCommandOptions {
  command: "status";
  dbPath?: string;
}

export interface DashboardCommandOptions {
  command: "dashboard";
  port: number;
  noOpen: boolean;
  dbPath?: string;
}

export type CliCommand =
  | ScanCommandOptions
  | ReportCommandOptions
  | StatusCommandOptions
  | DashboardCommandOptions;
