/**
 * WebMCP imperative API as implemented in Chrome 156 (verified 2026-11-04, spikes/2026-11-04-webmcp-isolated-world).
 * Declared globally so `document.modelContext` is typed for anyone who imports this package.
 */
export {};

declare global {
  interface ModelContextToolAnnotations {
    readOnlyHint?: boolean;
    consequentialHint?: boolean;
    untrustedContentHint?: boolean;
    debugging?: boolean;
  }

  interface ModelContextToolExecuteOptions {
    signal: AbortSignal;
  }

  interface ModelContextTool {
    name: string;
    title?: string;
    description: string;
    inputSchema?: object;
    outputSchema?: object;
    annotations?: ModelContextToolAnnotations;
    execute: (input: any, options: ModelContextToolExecuteOptions) => unknown;
  }

  interface ModelContextRegisterToolOptions {
    exposedTo?: string[];
    signal?: AbortSignal;
  }

  interface ModelContextRegisteredTool {
    name: string;
    title?: string;
    description: string;
    /** Chrome hands back an object; older builds handed back a JSON string. */
    inputSchema?: object | string;
    outputSchema?: object | string;
    annotations?: ModelContextToolAnnotations;
    window: Window;
    origin: string;
  }

  interface ModelContext extends EventTarget {
    registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<void>;
    getTools(options?: { fromOrigins?: string[] }): Promise<ModelContextRegisteredTool[]>;
    /** Resolves with the stringified result (strings pass through as-is), or null if the tool navigated. */
    executeTool(tool: ModelContextRegisteredTool, input?: object, options?: { signal?: AbortSignal }): Promise<string | null>;
    ontoolchange: ((this: ModelContext, ev: Event) => void) | null;
  }

  interface Document {
    readonly modelContext?: ModelContext;
  }
}
