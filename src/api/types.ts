export interface ProblemSummary {
  pk: number;
  name: string;
  difficulty?: string;
  solved_count?: number;
  tried_count?: number;
  solved_percent?: number | null;
  tags?: { id: number; name: string }[];
  source?: { name?: string };
  url?: string;
}

export interface ProblemDetail extends ProblemSummary {
  description?: string;
  score?: number;
  type?: string;
  allowed_file_types?: { id: number; label: string; extension?: string }[];
  assignment?: { pk: number };
  submissions?: { items: SubmissionNode[]; total?: number };
  area?: "course" | "contest";
  can_submit?: boolean;
  submit_note?: string;
  gained_score?: number;
}

export interface SubmissionNode {
  pk: number;
  submit_time?: string;
  judge_score?: number;
  calculated_judge_score?: number;
  file_type?: string;
  short_judge_result?: string;
  state?: string;
  color?: string;
}

export interface ProblemPage {
  total?: number;
  count: number;
  page: number;
  items: ProblemSummary[];
  filterChoices?: unknown;
}

export interface CourseAssignment {
  pk: number;
  name: string;
  start_time?: string;
  finish_time?: string;
  problem_count?: number;
  state?: string;
}

export interface Course {
  id: number;
  name: string;
  instructor_name?: string;
  assignments?: CourseAssignment[];
  course_users?: unknown[];
}

export interface DownloadResult {
  filename: string;
  contentType: string;
  bytes: Buffer;
}
