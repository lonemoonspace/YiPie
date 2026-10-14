/**
 * The variables a prompt template may use (docs/development-plan.md §4.3,
 * decision 3). Each is a fact about the page; none can reach the
 * configuration or a credential, because the renderer is only ever given
 * these values.
 */
export const PROMPT_VARIABLES = ['title', 'url', 'content', 'selection', 'language'] as const;
export type PromptVariable = (typeof PROMPT_VARIABLES)[number];
export type PromptValues = Record<PromptVariable, string>;

/** `{{name}}`, with optional spaces inside the braces. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function isPromptVariable(name: string): name is PromptVariable {
  return (PROMPT_VARIABLES as readonly string[]).includes(name);
}

export interface Rendered {
  text: string;
  /** Placeholders left as written because they are not variables, in order of first use. */
  unknown: string[];
}

/**
 * Fills a template in one pass. A value goes in as it is: it is never parsed
 * again, so a page that contains `{{url}}` stays literal, and nothing is
 * escaped, because this is text for a model, not HTML. A placeholder that is
 * not a variable stays exactly as written.
 */
export function renderTemplate(template: string, values: PromptValues): Rendered {
  const unknown = new Set<string>();
  const text = template.replace(PLACEHOLDER, (placeholder, name: string) => {
    if (isPromptVariable(name)) return values[name];
    unknown.add(name);
    return placeholder;
  });
  return { text, unknown: [...unknown] };
}

export interface TemplateVariables {
  used: PromptVariable[];
  /** For the editor to flag: these stay literal in what the model receives. */
  unknown: string[];
}

/** The variables a template uses, for the prompt editor. */
export function templateVariables(template: string): TemplateVariables {
  const used = new Set<PromptVariable>();
  const unknown = new Set<string>();
  for (const [, name] of template.matchAll(PLACEHOLDER)) {
    if (name === undefined) continue;
    if (isPromptVariable(name)) used.add(name);
    else unknown.add(name);
  }
  return { used: [...used], unknown: [...unknown] };
}
