import yaml from 'js-yaml';

export interface MethodSpecRole {
  slug: string;
  label: string;
  weight?: 'normal' | 'elevated' | 'lead';
}

export interface MethodSpecStage {
  id: string;
  title?: string;
  roles?: string[];
  assignment_strategy?: string;
  context_mode?: string;
  completion?: string | { type: string; [k: string]: unknown };
  output?: string;
}

export interface MethodSpecFrontmatter {
  id: string;
  title: string;
  version?: string;
  status?: string;
  summary?: string;
  source_method?: string;
  license?: string;
  attribution?: string;
  runtime?: { reference?: string; artifact?: string };
  lenses?: string[];
  roles?: MethodSpecRole[];
  stages?: MethodSpecStage[];
  output_artifact?: string;
  evals?: string;
}

export interface MethodSpec {
  frontmatter: MethodSpecFrontmatter;
  body: string;
  stageBodies: Record<string, string>;
}

function extractStageBodies(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /^##\s+Stage:\s*(\S+)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : body.length;
    result[id] = body.slice(start, end).trim();
  }
  return result;
}

export function parseMethodSpec(md: string): MethodSpec {
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('method.md is missing YAML frontmatter (--- … ---).');
  }
  let frontmatter: MethodSpecFrontmatter;
  try {
    frontmatter = yaml.load(fmMatch[1]) as MethodSpecFrontmatter;
  } catch (e) {
    throw new Error(`Invalid YAML frontmatter: ${(e as Error).message}`);
  }
  const body = fmMatch[2];
  return { frontmatter, body, stageBodies: extractStageBodies(body) };
}
