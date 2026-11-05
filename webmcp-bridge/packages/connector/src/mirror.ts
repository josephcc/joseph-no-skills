import type { ToolInfo } from './protocol.ts';

/** Read the page's registry in the shape the daemon expects. */
export async function listTools(mc: ModelContext): Promise<ToolInfo[]> {
  const tools = await mc.getTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: parseSchema(t.inputSchema),
    annotations: t.annotations ? { ...t.annotations } : undefined,
  }));
}

function parseSchema(schema: object | string | undefined): Record<string, unknown> | undefined {
  if (schema === undefined || schema === null) return undefined;
  if (typeof schema === 'string') {
    try { return JSON.parse(schema) as Record<string, unknown>; } catch { return undefined; }
  }
  return schema as Record<string, unknown>;
}

export class ToolNotFoundError extends Error {
  override name = 'NotFoundError';
}

/** Execute a page tool by name; the result is whatever executeTool resolved with (string | null). */
export async function callTool(mc: ModelContext, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string | null> {
  const tool = (await mc.getTools()).find((t) => t.name === name);
  if (!tool) throw new ToolNotFoundError(`no tool named ${name}`);
  return mc.executeTool(tool, args, { signal });
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}
