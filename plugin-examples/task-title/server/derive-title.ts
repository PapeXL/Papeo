const TASK_ID_LINE = /^#(\S+)\s*-\s*(.*)$/;
const MAX_TITLE_CHARS = 200;

function firstContentLine(prompt: string): string | null {
  const line = prompt
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.length > 0);
  return line ?? null;
}

export function deriveTaskWorkspaceTitle(prompt: string | undefined): string | null {
  if (!prompt) {
    return null;
  }
  const line = firstContentLine(prompt);
  if (!line) {
    return null;
  }
  const match = line.match(TASK_ID_LINE);
  if (!match) {
    return null;
  }
  const [, taskId, rest] = match;
  const description = rest.replace(/\s+/g, " ").trim();
  const title = description ? `#${taskId} — ${description}` : `#${taskId}`;
  const clamped = title.slice(0, MAX_TITLE_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
}
