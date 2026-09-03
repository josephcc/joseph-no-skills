import { useEffect, useRef } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

// Definitions, stories, notes and proposals are text a person (or the agent) wrote, so
// they are escaped before rendering: a stray `<` in a definition must not be able to
// change the page. Same rule the plan viewer applies to comment notes.
const escapeHtmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function scrubLinks(root: HTMLElement): void {
  root.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^\s*(javascript|data|vbscript):/i.test(href)) a.removeAttribute('href');
    else {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function Md({ source, inline = false }: { source: string; inline?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = inline
    ? (marked.parseInline(escapeHtmlText(source ?? '')) as string)
    : (marked.parse(escapeHtmlText(source ?? '')) as string);
  useEffect(() => {
    if (ref.current) scrubLinks(ref.current);
  }, [html]);
  return <div className="wb-md" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
