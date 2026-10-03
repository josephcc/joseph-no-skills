import { marked, type Tokenizer, type Tokens } from 'marked';

// marked's GFM strikethrough rule accepts ONE or two tildes (`~text~` or `~~text~~`).
// Plans quote LaTeX all the time, and LaTeX uses a lone `~` as a non-breaking space
// (`Table~\ref{tab:x} … Table~\ref{tab:y}`), so two such refs in one paragraph struck
// out everything between them. Nobody strikes text with a single tilde on purpose, so
// require the double form. Same regex as marked's, with `~~` fixed in both places.
const DOUBLE_TILDE_DEL = /^~~(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))~~(?=[^~]|$)/;

let configured = false;

/** Apply the shared marked configuration once. Both the viewer and the print/PDF
 *  renderer call this, so the two can never disagree about the markdown flavour. */
export function configureMarked(): void {
  if (configured) return;
  configured = true;
  marked.setOptions({ gfm: true, breaks: false });
  marked.use({
    tokenizer: {
      del(this: Tokenizer, src: string): Tokens.Del | undefined {
        const m = DOUBLE_TILDE_DEL.exec(src);
        // `undefined`, never `false`: marked treats a `false` return as "fall back to the
        // built-in tokenizer", which is the single-tilde rule this override exists to bypass.
        if (!m) return undefined;
        return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
    },
  });
}
