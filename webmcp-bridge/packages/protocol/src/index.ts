// The wire protocol lives in the published package (webmcp-connector/src/protocol.ts); this workspace
// package re-exports it for the daemon so there is a single source of truth and no duplicate types.
export * from '../../connector/src/protocol.ts';
