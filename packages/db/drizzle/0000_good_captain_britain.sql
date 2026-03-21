CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`analyzer_name` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`traces_analyzed` integer NOT NULL,
	`findings_count` integer NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	CONSTRAINT "analysis_runs_status_check" CHECK("analysis_runs"."status" in ('running', 'complete', 'error'))
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_runs_analyzer_name` ON `analysis_runs` (`analyzer_name`);--> statement-breakpoint
CREATE TABLE `fault_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`fault_span_id` text NOT NULL,
	`root_cause_span_id` text,
	`fault_type` text NOT NULL,
	`description` text NOT NULL,
	`cascade_depth` integer NOT NULL,
	`affected_span_ids` text NOT NULL,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fault_span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_cause_span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "fault_reports_fault_type_check" CHECK("fault_reports"."fault_type" in ('upstream_data', 'model_error', 'tool_failure', 'loop', 'timeout', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `idx_fault_reports_trace_id` ON `fault_reports` (`trace_id`);--> statement-breakpoint
CREATE TABLE `ingestion_state` (
	`source_path` text PRIMARY KEY NOT NULL,
	`adapter` text NOT NULL,
	`last_offset` integer NOT NULL,
	`last_line_hash` text,
	`last_session_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`span_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`token_count` integer,
	`position` integer NOT NULL,
	`metadata` text,
	FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_check" CHECK("messages"."role" in ('system', 'user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE INDEX `idx_messages_trace_id_position` ON `messages` (`trace_id`,`position`);--> statement-breakpoint
CREATE TABLE `segments` (
	`id` text PRIMARY KEY NOT NULL,
	`span_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`type` text NOT NULL,
	`token_count` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`percent_of_span` real NOT NULL,
	`content_hash` text,
	`char_start` integer,
	`char_end` integer,
	`analyzed_at` integer NOT NULL,
	FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "segments_type_check" CHECK("segments"."type" in (
        'system_prompt',
        'tool_schema',
        'conversation_history',
        'rag_context',
        'user_query',
        'assistant_response',
        'tool_result',
        'unknown'
      ))
);
--> statement-breakpoint
CREATE INDEX `idx_segments_trace_id_type` ON `segments` (`trace_id`,`type`);--> statement-breakpoint
CREATE TABLE `spans` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`parent_span_id` text,
	`external_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`duration_ms` integer,
	`model` text,
	`provider` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`tool_name` text,
	`tool_input` text,
	`tool_output` text,
	`tool_success` integer,
	`status` text NOT NULL,
	`error_message` text,
	`metadata` text,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "spans_type_check" CHECK("spans"."type" in ('llm', 'tool', 'retrieval', 'agent')),
	CONSTRAINT "spans_status_check" CHECK("spans"."status" in ('ok', 'error'))
);
--> statement-breakpoint
CREATE INDEX `idx_spans_trace_id` ON `spans` (`trace_id`);--> statement-breakpoint
CREATE TABLE `traces` (
	`id` text PRIMARY KEY NOT NULL,
	`external_id` text NOT NULL,
	`source` text NOT NULL,
	`session_key` text,
	`agent_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`model` text,
	`status` text NOT NULL,
	`metadata` text,
	`ingested_at` integer NOT NULL,
	CONSTRAINT "traces_status_check" CHECK("traces"."status" in ('complete', 'error', 'partial'))
);
--> statement-breakpoint
CREATE INDEX `idx_traces_started_at` ON `traces` (`started_at`);--> statement-breakpoint
CREATE TABLE `waste_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`span_id` text,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`wasted_tokens` integer NOT NULL,
	`wasted_cost_usd` real NOT NULL,
	`description` text NOT NULL,
	`recommendation` text NOT NULL,
	`estimated_savings_usd` real,
	`evidence` text NOT NULL,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`trace_id`) REFERENCES `traces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`span_id`) REFERENCES `spans`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "waste_reports_category_check" CHECK("waste_reports"."category" in (
        'low_cache_utilization',
        'model_overuse',
        'unused_tools',
        'duplicate_rag',
        'unbounded_history',
        'uncached_prompt',
        'agent_loop',
        'retry_waste',
        'tool_failure_waste',
        'high_output',
        'oversized_context'
      )),
	CONSTRAINT "waste_reports_severity_check" CHECK("waste_reports"."severity" in ('low', 'medium', 'high', 'critical'))
);
--> statement-breakpoint
CREATE INDEX `idx_waste_reports_trace_id_category` ON `waste_reports` (`trace_id`,`category`);