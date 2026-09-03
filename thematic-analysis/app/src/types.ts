// Mirrors the JSON `ta.py` emits (bundle / transcript / collate). The script is the
// single source of every computed number; nothing here recomputes one.

export type Kind = 'said' | 'did' | 'intent';
export type CodeStatus = 'candidate' | 'accepted' | 'merged' | 'retired';
export type ThemeStatus = 'candidate' | 'accepted' | 'merged' | 'dropped';
export type InPaper = 'undecided' | 'headline' | 'secondary' | 'no';

export interface Stamp {
  at: string;
  version: number;
}

export interface Hint {
  kind: string;
  text: string;
}

export interface Extract {
  id: string;
  transcript: string;
  participant: string;
  speaker: string;
  timestamp: string | null;
  line_start: number;
  line_end: number;
  text: string;
  codes: string[];
  kind: Kind;
  context: string | null;
  note: string | null;
  codebook_version: number;
  added: string;
  highlight?: string;
  reviewed?: Stamp | null;
  updated?: string;
  /** Computed by ta.py: new since the researcher last reviewed it, and why. */
  new: boolean;
  reason: string | null;
  words: number;
  hints?: Hint[];
}

export interface Proposal {
  why?: string;
  alternatives?: string;
  round?: string | number;
  borderline?: string[];
}

export interface Code {
  id: string;
  name: string;
  parent: string | null;
  status: CodeStatus;
  definition: string;
  include: string;
  exclude: string;
  tags: string[];
  examples: string[];
  merged_into: string | null;
  added: { version?: number; date?: string; source?: string };
  proposal: Proposal | null;
  reviewed: Stamp | null;
  redefined_version: number | null;
  family: string[];
  participants: string[];
  n: number;
  extracts: number;
  direct_extracts: number;
  child_extracts: number;
  kinds: Record<Kind, number>;
}

export interface Theme {
  id: string;
  name: string;
  parent: string | null;
  status: ThemeStatus;
  in_paper: InPaper;
  rq: string | null;
  essence: string;
  story: string;
  codes: string[];
  family: string[];
  tensions: string[];
  selected_extracts: string[];
  quote_spans: Record<string, { text: string; words: number; from: string; to: string }>;
  reviewed: Stamp | null;
  participants: string[];
  n: number;
  N: number;
  extracts: number;
}

export interface ParticipantRow {
  id: string;
  role: string;
  group: string | null;
  notes: string | null;
  speakers: string[];
  transcripts: string[];
  extracts: number;
  distinct_codes: number;
  missing_top: string[];
}

export interface TranscriptRow {
  id: string;
  path: string;
  participants: string[];
  kind: string | null;
  extracts: number;
  new_extracts: number;
  coded_with_version: number | null;
  state: 'uncoded' | 'stale' | 'current';
}

export interface Dupe {
  kind: 'names' | 'extracts' | 'subset' | 'identical-definition';
  a: string;
  b: string;
  score: number;
  shared: number;
  text: string;
}

export interface StaleRow {
  transcript: string;
  coded_with_version: number | null;
  reason: string;
  codes_since: string[];
  severity: 'recode' | 'version-only';
}

export interface Op {
  id: string;
  at: string;
  by: 'user' | 'agent';
  view: string;
  op: string;
  target: string | null;
  args: Record<string, unknown>;
  note: string | null;
  status?: string;
  error?: string | null;
  result?: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface Spread {
  themes: { theme: string; name: string; in_paper: string; selected: number; kinds: Record<string, number>; available_kinds: Record<string, number>; tensions: number }[];
  per_participant: Record<string, { theme: string; extract: string }[]>;
  unquoted: string[];
  warnings: { kind: string; text: string; theme?: string; participant?: string }[];
}

export interface Bundle {
  root: string;
  study: string;
  approach: Record<string, string>;
  research_questions: { id: string; text: string }[];
  codebook_version: number;
  frozen: boolean;
  N: number;
  total_extracts: number;
  codes: Code[];
  cells: Record<string, Record<string, { extracts: string[]; kinds: Record<Kind, number> }>>;
  participants: ParticipantRow[];
  roster: { id: string; role: string; speakers?: string[]; group?: string; notes?: string }[];
  transcripts: TranscriptRow[];
  themes: Theme[];
  zero_codes: string[];
  silent_participants: string[];
  dupes: Dupe[];
  stale: { codebook_version: number; transcripts: number; stale: StaleRow[]; reread_requests: { transcript: string; code: string | null; note: string | null; asked: string; status: string }[] };
  extracts_all: Extract[];
  changelog: { version: number; date: string; change: string }[];
  inbox: Op[];
  spread: Spread;
  memos: string;
  applied_logs: string[];
  transcript_files: Record<string, { abs_path: string | null; frames_dir: string | null }>;
  generated: string;
}

export interface Span {
  extract: string;
  start: number | null;
  end: number | null;
}

export interface Turn {
  index: number;
  line: number;
  end_line: number;
  timestamp: string | null;
  speaker: string;
  participant: string | null;
  role: string;
  text: string;
  spans: Span[];
}

export interface FrameRow {
  file: string;
  timestamp: string;
  seconds: number;
  exact: boolean;
}

export interface TranscriptPayload {
  transcript: {
    id: string;
    path: string;
    abs_path: string;
    participants: string[];
    kind: string | null;
    coded_with_version: number | null;
    state: string;
    lines: number;
    turns: number;
  };
  turns: Turn[];
  extracts: Extract[];
  codes: Record<string, Code>;
  frames: { dir: string | null; frames: FrameRow[] };
  stats: { extracts: number; new: number; kinds: Record<Kind, number>; unlocated: string[] };
}

export interface CollateGroup {
  participant: string;
  role: string;
  extracts: Extract[];
}

export interface Collate {
  target: string;
  kind: 'code' | 'theme';
  title: string;
  family: string[];
  N: number;
  participants: number;
  total: number;
  groups: CollateGroup[];
}
