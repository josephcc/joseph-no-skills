// Port pinning and the candidate list on the command line (plans/daemon-port-discovery/main.md D-2).
import { afterEach, describe, expect, test } from 'bun:test';
import { CANDIDATE_PORTS } from 'webmcp-protocol';
import { parseArgs } from '../src/config.ts';

const saved = process.env.WEBMCP_BRIDGE_PORT;
afterEach(() => { if (saved === undefined) delete process.env.WEBMCP_BRIDGE_PORT; else process.env.WEBMCP_BRIDGE_PORT = saved; });

describe('parseArgs ports', () => {
  test('nothing given: the first candidate, not pinned', () => {
    delete process.env.WEBMCP_BRIDGE_PORT;
    const { config } = parseArgs(['serve'], 'v');
    expect(config.port).toBe(CANDIDATE_PORTS[0]!);
    expect(config.portPinned).toBe(false);
    expect(config.portCandidates).toBeUndefined();
  });
  test('--port and WEBMCP_BRIDGE_PORT pin', () => {
    delete process.env.WEBMCP_BRIDGE_PORT;
    expect(parseArgs(['serve', '--port', '9001'], 'v').config).toMatchObject({ port: 9001, portPinned: true });
    process.env.WEBMCP_BRIDGE_PORT = '9002';
    expect(parseArgs(['serve'], 'v').config).toMatchObject({ port: 9002, portPinned: true });
  });
  test('--ports substitutes the list and unpins, even with WEBMCP_BRIDGE_PORT set or an earlier --port (Codex audit)', () => {
    process.env.WEBMCP_BRIDGE_PORT = '9002';
    expect(parseArgs(['serve', '--ports', '9010, 9011'], 'v').config).toMatchObject({ port: 9010, portPinned: false, portCandidates: [9010, 9011] });
    delete process.env.WEBMCP_BRIDGE_PORT;
    expect(parseArgs(['serve', '--port', '9001', '--ports', '9010'], 'v').config).toMatchObject({ port: 9010, portPinned: false });
    expect(parseArgs(['serve', '--ports', '9010', '--port', '9001'], 'v').config).toMatchObject({ port: 9001, portPinned: true });
  });
  test('--ports rejects anything that is not a port', () => {
    delete process.env.WEBMCP_BRIDGE_PORT;
    expect(() => parseArgs(['serve', '--ports', '9010,abc'], 'v')).toThrow(/not a port: abc/);
    expect(() => parseArgs(['serve', '--ports', ''], 'v')).toThrow(/comma-separated/);
    expect(() => parseArgs(['serve', '--ports', '70000'], 'v')).toThrow(/not a port/);
  });
});
