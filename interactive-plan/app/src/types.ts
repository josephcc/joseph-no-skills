// Data model for the interactive-plan format. Mirrors SPEC.md.

export interface SourceRange {
  start: number; // byte offset into the raw file
  end: number;
}

export interface KeyVal {
  key: string;
  value: string;
}

export type Block =
  | MarkdownBlock
  | QuestionBlock
  | DecisionBlock
  | FindingBlock
  | CommentBlock;

export interface MarkdownBlock {
  type: 'markdown';
  text: string;
  range: SourceRange;
}

export interface Option {
  id: string;
  body: string; // markdown
}

export interface Answer {
  by: string; // 'user' | 'agent'
  at: string;
  chose: string[]; // option ids; ['other'] for Other; [] for freeform-only
  text: string;
}

export interface QuestionBlock {
  type: 'question';
  id: string;
  title: string;
  status: 'open' | 'answered';
  body: string; // markdown (question prose)
  select: 'single' | 'multi' | null; // null => no options (freeform)
  options: Option[];
  answer: Answer | null;
  range: SourceRange;
}

export interface DecisionBlock {
  type: 'decision';
  id: string;
  title: string;
  status: 'proposed' | 'locked' | 'superseded' | 'wontfix';
  date: string | null;
  from: string | null;
  supersedes: string | null;
  body: string; // markdown
  rationale: string | null; // markdown
  range: SourceRange;
}

export interface FindingBlock {
  type: 'finding';
  id: string;
  title: string;
  severity: 'p0' | 'p1' | 'p2' | 'p3';
  status: 'open' | 'fixed' | 'wontfix' | 'deferred' | 'partial';
  effort: string | null;
  body: string; // markdown
  range: SourceRange;
}

export interface Note {
  by: string; // 'user' | 'agent'
  at: string;
  body: string; // markdown
}

export interface CommentBlock {
  type: 'comment';
  id: string;
  status: 'open' | 'resolved';
  kind: 'error' | 'clarify' | 'question' | 'nit' | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  notes: Note[];
  range: SourceRange;
}

export interface ParsedPlan {
  preamble: KeyVal[];
  title: string | null;
  blocks: Block[];
  raw: string;
}

export interface Diagnostic {
  line: number;
  severity: 'error' | 'warning';
  message: string;
}
