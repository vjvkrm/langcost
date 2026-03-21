export function estimateTokenCount(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return Math.ceil(content.length / 4);
}
