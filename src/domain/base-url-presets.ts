/**
 * Common OpenAI-compatible services, for filling in the Base URL
 * (docs/development-plan.md §4.6): a name and an address, no icons. The user
 * still writes the key and the model name.
 */
export const BASE_URL_PRESETS: readonly { name: string; baseURL: string }[] = [
  { name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
  { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
  { name: '阿里云百炼', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '智谱', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' },
  { name: '硅基流动', baseURL: 'https://api.siliconflow.cn/v1' },
  { name: 'Groq', baseURL: 'https://api.groq.com/openai/v1' },
  { name: 'Ollama', baseURL: 'http://localhost:11434/v1' },
  { name: 'LM Studio', baseURL: 'http://localhost:1234/v1' },
];
