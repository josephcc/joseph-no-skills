/**
 * Minimal in-page implementation of the WebMCP imperative API, installed only when
 * `document.modelContext` is absent (Chrome flag off, other browsers). Mirrors the
 * observable behaviour of Chrome 156: executeTool resolves with the stringified result
 * (strings pass through), toolchange fires after register/unregister, duplicate names throw.
 */
type Registered = ModelContextRegisteredTool & { execute: ModelContextTool['execute'] };

class ModelContextShim extends EventTarget implements ModelContext {
  readonly #tools = new Map<string, Registered>();
  ontoolchange: ((this: ModelContext, ev: Event) => void) | null = null;

  constructor() {
    super();
    this.addEventListener('toolchange', (ev) => this.ontoolchange?.call(this, ev));
  }

  async registerTool(tool: ModelContextTool, options: ModelContextRegisterToolOptions = {}): Promise<void> {
    if (!tool || typeof tool.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
      throw new DOMException(`Invalid tool name: ${String(tool?.name)}`, 'InvalidStateError');
    }
    if (!tool.description) throw new DOMException('Tool description must not be empty', 'InvalidStateError');
    if (this.#tools.has(tool.name)) throw new DOMException(`A tool named "${tool.name}" is already registered`, 'InvalidStateError');
    if (typeof tool.execute !== 'function') throw new TypeError('tool.execute must be a function');
    const entry: Registered = {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      annotations: tool.annotations,
      window,
      origin: location.origin,
      execute: tool.execute,
    };
    this.#tools.set(tool.name, entry);
    const unregister = () => {
      if (this.#tools.get(tool.name) === entry) {
        this.#tools.delete(tool.name);
        this.#emitChange();
      }
    };
    if (options.signal) {
      if (options.signal.aborted) { unregister(); return; }
      options.signal.addEventListener('abort', unregister, { once: true });
    }
    this.#emitChange();
  }

  async getTools(): Promise<ModelContextRegisteredTool[]> {
    return [...this.#tools.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ execute: _execute, ...rest }) => rest);
  }

  async executeTool(tool: ModelContextRegisteredTool, input: object = {}, options: { signal?: AbortSignal } = {}): Promise<string | null> {
    const entry = this.#tools.get(tool?.name);
    if (!entry) throw new DOMException(`No tool named "${tool?.name}"`, 'NotFoundError');
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new DOMException('Input must be a JSON object', 'DataError');
    const controller = new AbortController();
    options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason), { once: true });
    let result: unknown;
    try {
      result = await entry.execute(input, { signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) throw new DOMException('Tool execution was aborted', 'AbortError');
      throw new DOMException(err instanceof Error ? err.message : String(err), 'OperationError');
    }
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result ?? null) ?? 'null';
    } catch {
      throw new DOMException('Tool result is not serializable', 'OperationError');
    }
  }

  #emitChange() {
    queueMicrotask(() => this.dispatchEvent(new Event('toolchange')));
  }
}

export function installShim(): ModelContext {
  const existing = (document as Document).modelContext;
  if (existing) return existing;
  const shim = new ModelContextShim();
  Object.defineProperty(document, 'modelContext', { value: shim, configurable: true, enumerable: false, writable: false });
  return shim;
}

export function hasNativeModelContext(): boolean {
  return typeof (document as Document).modelContext === 'object' && !((document as Document).modelContext instanceof ModelContextShim);
}
