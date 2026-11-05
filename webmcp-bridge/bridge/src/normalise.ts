/** Turn a page tool's raw result (executeTool's DOMString | null) into an MCP tools/call result. Plan §5.3. */
export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function normaliseResult(raw: string | null): McpToolResult {
  if (raw === null) return { content: [{ type: 'text', text: 'tool triggered a navigation; no result' }] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { content: [{ type: 'text', text: raw }] }; }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.content)) return obj as unknown as McpToolResult;   // the page chose to speak MCP
    return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }], structuredContent: obj };
  }
  if (Array.isArray(parsed)) return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
  return { content: [{ type: 'text', text: String(parsed) }] };
}

export function errorResult(toolName: string, error: { name?: string; message?: string }): McpToolResult {
  return { isError: true, content: [{ type: 'text', text: `${toolName}: ${error.name ?? 'Error'}: ${error.message ?? 'unknown error'}` }] };
}

/** Claude Code maps anything outside [A-Za-z0-9_-] to "_"; do it ourselves so names are stable and collision-checked. */
export function sanitiseToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
