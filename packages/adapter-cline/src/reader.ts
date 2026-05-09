import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { sha256 } from "@langcost/core";

import type { ClineTaskHistoryItem, ClineUiMessage, ReadClineTaskResult } from "./types";

function taskIdFromPath(filePath: string): string {
  return basename(dirname(filePath));
}

function rootFromPath(filePath: string): string | undefined {
  const taskDir = dirname(filePath);
  const tasksDir = dirname(taskDir);
  return basename(tasksDir) === "tasks" ? dirname(tasksDir) : undefined;
}

async function readJsonFile<T>(
  filePath: string,
  errors: ReadClineTaskResult["errors"],
  label: string,
): Promise<T | undefined> {
  try {
    const text = await Bun.file(filePath).text();
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    errors.push({ message: `${label}: ${message}` });
    return undefined;
  }
}

function normalizeHistoryItems(parsed: unknown): ClineTaskHistoryItem[] {
  if (Array.isArray(parsed)) return parsed as ClineTaskHistoryItem[];
  const maybeObject = parsed as { taskHistory?: unknown };
  if (Array.isArray(maybeObject.taskHistory)) return maybeObject.taskHistory as ClineTaskHistoryItem[];
  return [];
}

export async function readTaskFile(
  filePath: string,
  rootPath = rootFromPath(filePath),
): Promise<ReadClineTaskResult> {
  const errors: ReadClineTaskResult["errors"] = [];
  const taskId = taskIdFromPath(filePath);
  const stats = await stat(filePath);
  const rawUiMessages = await readJsonFile<unknown>(filePath, errors, "ui_messages.json");
  const uiMessages = Array.isArray(rawUiMessages) ? (rawUiMessages as ClineUiMessage[]) : [];

  if (rawUiMessages !== undefined && !Array.isArray(rawUiMessages)) {
    errors.push({ message: "ui_messages.json: expected top-level array" });
  }

  const apiConversationHistory = await readJsonFile<unknown[]>(
    join(dirname(filePath), "api_conversation_history.json"),
    errors,
    "api_conversation_history.json",
  );

  let taskHistoryItem: ClineTaskHistoryItem | undefined;
  if (rootPath) {
    const rawHistory = await readJsonFile<unknown>(
      join(rootPath, "state", "taskHistory.json"),
      errors,
      "taskHistory.json",
    );
    taskHistoryItem = normalizeHistoryItems(rawHistory).find((item) => item.id === taskId);
  }

  return {
    taskId,
    sourceFile: filePath,
    ...(rootPath ? { rootPath } : {}),
    uiMessages,
    ...(apiConversationHistory ? { apiConversationHistory } : {}),
    ...(taskHistoryItem ? { taskHistoryItem } : {}),
    lastOffset: stats.size,
    lastLineHash: await sha256(await Bun.file(filePath).text()),
    errors,
  };
}
