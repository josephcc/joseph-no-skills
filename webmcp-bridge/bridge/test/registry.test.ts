import { describe, expect, test } from 'bun:test';
import { Registry, slugify, type PageLink } from '../src/registry.ts';

const link: PageLink = { call: async () => null, requestContext: async () => '', close: () => {} };
const add = (r: Registry, origin: string, tools = 1) => {
  const p = r.add({ origin, url: origin + '/', title: origin, hasContext: false, link });
  r.setTools(p.id, Array.from({ length: tools }, (_, i) => ({ name: `t${i}`, description: 'd' })));
  return p;
};

describe('Registry selection', () => {
  test('no pages → undefined; pages without tools are never selected', () => {
    const r = new Registry();
    expect(r.selected()).toBeUndefined();
    const p = r.add({ origin: 'http://a', url: 'http://a/', title: 'a', hasContext: false, link });
    expect(r.selected()).toBeUndefined();
    r.setTools(p.id, [{ name: 'x', description: 'd' }]);
    expect(r.selected()?.id).toBe(p.id);
  });

  test('most recently active visible page wins; hidden pages lose to visible ones', async () => {
    const r = new Registry();
    const a = add(r, 'http://a');
    await new Promise((res) => setTimeout(res, 2));
    const b = add(r, 'http://b');
    expect(r.selected()?.id).toBe(b.id);
    r.setVisible(b.id, false);
    expect(r.selected()?.id).toBe(a.id);
    r.setVisible(a.id, false);
    expect(r.selected()?.id).toBe(b.id); // both hidden → most recent
  });

  test('pinning sticks until the page goes away', () => {
    const r = new Registry();
    const a = add(r, 'http://a'); const b = add(r, 'http://b');
    r.select(a.id);
    r.setTools(b.id, [{ name: 'y', description: 'd' }]);
    expect(r.selected()?.id).toBe(a.id);
    r.remove(a.id);
    expect(r.selected()?.id).toBe(b.id);
  });

  test('resolve by id prefix', () => {
    const r = new Registry();
    const a = add(r, 'http://a');
    expect(r.resolve(a.id.slice(0, 4))?.id).toBe(a.id);
    expect(r.resolve('zzzz')).toBeUndefined();
  });

  test('emits change and selection events', () => {
    const r = new Registry();
    const events: string[] = [];
    r.on('change', () => events.push('change'));
    r.on('selection', () => events.push('selection'));
    add(r, 'http://a');
    expect(events).toContain('change');
    expect(events).toContain('selection');
  });

  test('slugify', () => {
    expect(slugify('http://127.0.0.1:5173')).toBe('127.0.0.1_5173');
    expect(slugify('https://science-kg.example.org')).toBe('science-kg.example.org');
  });
});
