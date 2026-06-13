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
  // Normalize line endings so CRLF-checked-out files still match the frontmatter
  // fence and split cleanly.
  const normalized = md.replace(/\r\n/g, '\n');
  const fmMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error('method.md is missing YAML frontmatter (--- … ---).');
  }
  let frontmatter: MethodSpecFrontmatter;
  try {
    frontmatter = yaml.load(fmMatch[1]) as MethodSpecFrontmatter;
  } catch (e) {
    throw new Error(`Invalid YAML frontmatter: ${(e as Error).message}`);
  }
  if (!frontmatter || typeof frontmatter !== 'object') {
    throw new Error('method.md frontmatter is empty or not a YAML object.');
  }
  const body = fmMatch[2];
  return { frontmatter, body, stageBodies: extractStageBodies(body) };
}

export interface ChainStep {
  id: string;
  title?: string;
  facilitation_prompt?: string;
  context_mode?: string;
  roles?: MethodSpecRole[];
  assignment_strategy?: string;
  completion_criteria?: { type: string; [k: string]: unknown };
}

export interface ChainConfig {
  steps: ChainStep[];
  output_artifact?: string;
}

export interface TemplateInstall {
  title: string;
  description: string | null;
  template_type: 'chain';
  chain_config: ChainConfig;
}

export function toChainConfig(spec: MethodSpec): TemplateInstall {
  const { frontmatter: fm, stageBodies } = spec;

  if (fm.runtime?.artifact !== 'chain') {
    throw new Error(
      `install_method_spec only handles chain specs (runtime.artifact must be 'chain', got '${fm.runtime?.artifact ?? 'undefined'}').`,
    );
  }
  if (fm.runtime?.reference && fm.runtime.reference !== 'harmonica') {
    throw new Error(`Unsupported runtime.reference '${fm.runtime.reference}' (expected 'harmonica').`);
  }
  const stages = fm.stages ?? [];
  if (stages.length < 1) {
    throw new Error('Spec has no stages.');
  }

  const roleBySlug = new Map((fm.roles ?? []).map((r) => [r.slug, r]));
  const lensLine =
    fm.lenses && fm.lenses.length
      ? `Read every question through these lenses: ${fm.lenses.join(', ')}.\n\n`
      : '';

  const steps: ChainStep[] = stages.map((stage) => {
    const roles = (stage.roles ?? []).map((slug) => {
      const role = roleBySlug.get(slug);
      if (!role) {
        throw new Error(`Stage '${stage.id}' references role slug '${slug}' not defined in roles[].`);
      }
      return { slug: role.slug, label: role.label, ...(role.weight ? { weight: role.weight } : {}) };
    });

    let completion_criteria: { type: string; [k: string]: unknown } | undefined;
    if (typeof stage.completion === 'string') {
      completion_criteria = { type: stage.completion };
    } else if (stage.completion && typeof stage.completion === 'object') {
      completion_criteria = stage.completion;
    }

    const sectionBody = stageBodies[stage.id];
    if (!sectionBody) {
      throw new Error(`No "## Stage: ${stage.id}" section found in the method body.`);
    }

    return {
      id: stage.id,
      ...(stage.title ? { title: stage.title } : {}),
      facilitation_prompt: lensLine + sectionBody,
      ...(stage.context_mode ? { context_mode: stage.context_mode } : {}),
      ...(roles.length ? { roles } : {}),
      ...(stage.assignment_strategy ? { assignment_strategy: stage.assignment_strategy } : {}),
      ...(completion_criteria ? { completion_criteria } : {}),
    };
  });

  const chain_config: ChainConfig = {
    steps,
    ...(fm.output_artifact ? { output_artifact: fm.output_artifact } : {}),
  };

  const description = [fm.summary, fm.attribution].filter(Boolean).join('\n\n') || null;

  return { title: fm.title, description, template_type: 'chain', chain_config };
}
