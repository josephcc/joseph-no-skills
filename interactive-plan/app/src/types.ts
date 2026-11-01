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
  | CommentBlock
  | CheckBlock
  | CheckTableBlock;

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

// A checkable task item — a first-class, id-addressed checkbox (toggled by
// flipping `status`, like a decision's status). Renders as an interactive
// checkbox + markdown label; persists via the normal block-edit round-trip.
export interface CheckBlock {
  type: 'check';
  id: string;
  status: 'todo' | 'done';
  label: string; // markdown (the checkbox's text)
  range: SourceRange;
}

export interface TableColumn {
  header: string; // markdown
  align: 'left' | 'center' | 'right' | null;
}

export interface TableRow {
  id: string; // the first cell's text — the row's stable handle in `checked`
  cells: string[]; // markdown, one per column (cells[0] is the id cell)
}

// A GFM table with a checkbox on every row, for picking rows out of a long list
// (papers, files, participants). The ticked rows live in one `checked` attribute
// on the tag, keyed by the first column, so the agent can rewrite the table and
// the user's ticks survive. `inner` is kept verbatim: a toggle rewrites only the
// opening tag.
export interface CheckTableBlock {
  type: 'check-table';
  id: string;
  title: string;
  checked: string[]; // row ids
  inner: string; // raw source between the tags
  before: string; // markdown before the table
  after: string; // markdown after it
  columns: TableColumn[]; // empty when the body has no table (the linter reports it)
  rows: TableRow[];
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
