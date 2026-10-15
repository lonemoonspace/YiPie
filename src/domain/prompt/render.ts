/**
 * The variables a prompt template may use (docs/development-plan.md §4.3,
 * decision 3). Every value comes from the page or the answer language; no
 * variable can reach a configuration or a credential.
 */
export const PROMPT_VARIABLES = ['title', 'url', 'content', 'selection', 'language'] as const;
export type PromptVariable = (typeof PROMPT_VARIABLES)[number];
export type PromptValues = Record<PromptVariable, string>;

/** `{{name}}`, spaces inside the braces allowed. Whatever is between them is checked against the list. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;

function isPromptVariable(name: string): name is PromptVariable {
  return (PROMPT_VARIABLES as readonly string[]).includes(name);
}

/**
 * Fills a template, in one pass over it: a value is inserted as it is and
 * never read again, so a page whose title contains `{{content}}` cannot pull
 * anything in. Unknown placeholders stay as written. Nothing is escaped: the
 * result is plain text for a model, not HTML.
 */
export function renderTemplate(template: string, values: PromptValues): string {
  return template.replace(PLACEHOLDER, (placeholder, inner: string) => {
    const name = inner.trim();
    return isPromptVariable(name) ? values[name] : placeholder;
  });
}

/** The placeholders in `template` that are not variables, each once, in order of appearance. */
export function unknownPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const [placeholder, inner] of template.matchAll(PLACEHOLDER)) {
    if (!isPromptVariable((inner ?? '').trim())) found.add(placeholder);
  }
  return [...found];
}

/** Whether `template` uses the variable `name`. */
export function usesVariable(template: string, name: PromptVariable): boolean {
  return countVariable(template, name) > 0;
}

/** How many times `template` uses the variable `name`: each use inserts its value again. */
export function countVariable(template: string, name: PromptVariable): number {
  let count = 0;
  for (const [, inner] of template.matchAll(PLACEHOLDER)) {
    if ((inner ?? '').trim() === name) count += 1;
  }
  return count;
}
