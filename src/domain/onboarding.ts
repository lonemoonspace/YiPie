/**
 * What the first-run page offers (docs/development-plan.md §4.8): services to
 * paste a key for, services that had a free allowance when this list was
 * made, and local servers to look for. This list lives in the extension
 * only: the store listing names no services (it was once refused for that).
 */
export interface StartService {
  /** Stable id, also the key of its note in the message tables. */
  id: string;
  name: string;
  baseURL: string;
  /** Where to create a key. */
  keyURL: string;
  /**
   * Model names to choose first, in order of preference; the first is
   * filled in when the service lists no models.
   */
  models: readonly string[];
  /** Pick only `:free` models from the list (OpenRouter). */
  freeOnly?: boolean;
}

/** Services with a key the user already has. */
export const KEY_SERVICES: readonly StartService[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    keyURL: 'https://platform.openai.com/api-keys',
    models: ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    keyURL: 'https://platform.deepseek.com/api_keys',
    models: ['deepseek-chat'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyURL: 'https://openrouter.ai/keys',
    models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'],
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyURL: 'https://bailian.console.aliyun.com/?apiKey=1',
    models: ['qwen-plus', 'qwen-turbo'],
  },
  {
    id: 'zhipu',
    name: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    keyURL: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: ['glm-4-flash', 'glm-4-plus'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    keyURL: 'https://platform.moonshot.cn/console/api-keys',
    models: ['moonshot-v1-32k', 'moonshot-v1-8k'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    keyURL: 'https://cloud.siliconflow.cn/account/ak',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-7B-Instruct'],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    keyURL: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile'],
  },
];

/**
 * Services that had a free allowance in 2026-11, with the models that use
 * it. Allowances change: the page says so and links to each service.
 */
export const FREE_SERVICES: readonly StartService[] = [
  {
    id: 'zhipu-free',
    name: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    keyURL: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    models: ['glm-4-flash', 'glm-4-flash-250414'],
  },
  {
    id: 'siliconflow-free',
    name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    keyURL: 'https://cloud.siliconflow.cn/account/ak',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'THUDM/glm-4-9b-chat'],
  },
  {
    id: 'openrouter-free',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    keyURL: 'https://openrouter.ai/keys',
    models: ['deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    freeOnly: true,
  },
  {
    id: 'groq-free',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    keyURL: 'https://console.groq.com/keys',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
  },
  {
    id: 'gemini-free',
    name: 'Google AI Studio',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyURL: 'https://aistudio.google.com/apikey',
    models: ['gemini-2.5-flash', 'gemini-2.0-flash'],
  },
];

/** Local servers the first-run page looks for, at their default addresses. */
export const LOCAL_SERVERS: readonly { name: string; baseURL: string }[] = [
  { name: 'Ollama', baseURL: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
];

/** Models a service lists that cannot answer a chat request. */
const NOT_CHAT =
  /embed|whisper|tts|audio|speech|transcri|dall-e|image|moderation|rerank|realtime|bge-|clip/i;

/**
 * The model to choose first from a service's list: the first of `preferred`
 * the list has (as listed, or after a prefix such as `models/`), else the
 * first chat model in the order the service listed them; null when it lists
 * none. A free-only service picks among its `:free` models.
 */
export function pickModel(
  listed: readonly string[],
  service: Pick<StartService, 'models' | 'freeOnly'> | null,
): string | null {
  const options = [...new Set(listed)];
  const candidates =
    service?.freeOnly === true ? options.filter((id) => id.endsWith(':free')) : options;
  for (const wanted of service?.models ?? []) {
    const hit = candidates.find((id) => id === wanted || id.endsWith(`/${wanted}`));
    if (hit !== undefined) return hit;
  }
  return candidates.find((id) => !NOT_CHAT.test(id)) ?? null;
}

/**
 * The chat models on a local server's list, each once, in the server's own
 * order (Ollama lists the most recently used first), for the panel's menu.
 */
export function chatModels(listed: readonly string[]): string[] {
  return [...new Set(listed)].filter((id) => !NOT_CHAT.test(id));
}
