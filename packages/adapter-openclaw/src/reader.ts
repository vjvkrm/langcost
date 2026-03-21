import { sha256 } from "@langcost/core";

import type { OpenClawEntry, ReadSessionResult } from "./types";

export async function readSessionFile(filePath: string): Promise<ReadSessionResult> {
  const file = Bun.file(filePath);
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();

  let buffered = "";
  let lineNumber = 0;
  let lastNonEmptyLine = "";
  let lastOffset = 0;

  const entries: OpenClawEntry[] = [];
  const errors: ReadSessionResult["errors"] = [];

  function parseLine(rawLine: string): void {
    const line = rawLine.replace(/\r$/, "").trim();
    if (line.length === 0) {
      return;
    }

    lineNumber += 1;
    lastNonEmptyLine = line;

    try {
      entries.push(JSON.parse(line) as OpenClawEntry);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown JSON parse error";
      errors.push({ line: lineNumber, message });
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    lastOffset += value.byteLength;
    buffered += decoder.decode(value, { stream: true });

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex >= 0) {
      parseLine(buffered.slice(0, newlineIndex));
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf("\n");
    }
  }

  buffered += decoder.decode();
  parseLine(buffered);

  return {
    entries,
    lastLineHash: lastNonEmptyLine ? await sha256(lastNonEmptyLine) : undefined,
    lastOffset,
    errors
  };
}
