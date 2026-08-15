// 平台预设：填入 API Key 即可对接（含余额接口路径，无余额接口的平台留空）
export interface PlatformPreset {
  id: string;
  name: string;
  badgeColor: string;
  badgeChar?: string; // 无官方 logo 时的字母徽章
  logoStyle?: 'square' | 'wide'; // 方形图标 vs 横版文字标（统一视觉大小）
  rechargeUrl?: string; // 官方充值页（一键跳转）
  baseUrl: string;
  balanceUrl: string;
  balanceJsonPath: string;
  currency: string;
  models: string[];
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badgeColor: '#4d6bfe',
    logoStyle: 'wide',
    baseUrl: 'https://api.deepseek.com',
    balanceUrl: '{base}/user/balance',
    balanceJsonPath: 'balance_infos[0].total_balance',
    rechargeUrl: 'https://platform.deepseek.com/top_up',
    currency: 'CNY',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    badgeColor: '#1e6fff',
    badgeChar: 'S',
    baseUrl: 'https://api.siliconflow.cn/v1',
    balanceUrl: '{base}/user/info',
    balanceJsonPath: 'data.balance',
    rechargeUrl: 'https://cloud.siliconflow.cn/billing',
    currency: 'CNY',
    models: [
      'deepseek-ai/DeepSeek-V3.2',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B',
      'THUDM/GLM-4-Plus',
      '01-ai/Yi-Large',
    ],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    badgeColor: '#3859ff',
    badgeChar: 'Z',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    balanceUrl: 'https://open.bigmodel.cn/api/biz/account/query-customer-account-report',
    balanceJsonPath: 'data.balance',
    rechargeUrl: 'https://open.bigmodel.cn/console',
    currency: 'CNY',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4-long'],
  },
  {
    id: 'moonshot',
    name: '月之暗面 Kimi',
    badgeColor: '#1e1e2f',
    baseUrl: 'https://api.moonshot.cn/v1',
    balanceUrl: '{base}/users/me/balance',
    balanceJsonPath: 'data.available_balance',
    rechargeUrl: 'https://platform.moonshot.cn/',
    currency: 'CNY',
    models: ['kimi-k2', 'kimi-k2-turbo-preview', 'moonshot-v1-128k', 'moonshot-v1-32k'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badgeColor: '#10a37f',
    logoStyle: 'wide',
    baseUrl: 'https://api.openai.com/v1',
    balanceUrl: '',
    balanceJsonPath: '',
    rechargeUrl: 'https://platform.openai.com/settings/organization/billing',
    currency: 'USD',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o3', 'o4-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badgeColor: '#d97757',
    logoStyle: 'wide',
    baseUrl: 'https://api.anthropic.com/v1',
    balanceUrl: '',
    balanceJsonPath: '',
    rechargeUrl: 'https://console.anthropic.com/settings/billing',
    currency: 'USD',
    models: ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badgeColor: '#4285f4',
    logoStyle: 'wide',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    balanceUrl: '',
    balanceJsonPath: '',
    rechargeUrl: 'https://aistudio.google.com/',
    currency: 'USD',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  },
  {
    id: 'groq',
    name: 'Groq',
    badgeColor: '#f55036',
    logoStyle: 'wide',
    baseUrl: 'https://api.groq.com/openai/v1',
    balanceUrl: '',
    balanceJsonPath: '',
    rechargeUrl: 'https://console.groq.com/',
    currency: 'USD',
    models: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'qwen-qwq-32b'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badgeColor: '#7c3aed',
    baseUrl: 'https://openrouter.ai/api/v1',
    balanceUrl: '',
    balanceJsonPath: '',
    rechargeUrl: 'https://openrouter.ai/settings/credits',
    currency: 'USD',
    models: ['openrouter/auto', 'deepseek/deepseek-chat', 'anthropic/claude-sonnet-4'],
  },
];

export function presetById(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}

// 按 Base URL 匹配预设（兼容自定义 id 的账户，如 acc-xxx 但 baseUrl 是智谱的）
export function presetByBaseUrl(baseUrl: string): PlatformPreset | undefined {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  return PLATFORM_PRESETS.find((p) => p.baseUrl.replace(/\/+$/, '') === b);
}

// 账户 -> 预设：先按 id，再按 baseUrl
export function presetForAccount(account: { id: string; baseUrl: string }): PlatformPreset | undefined {
  return presetById(account.id) || presetByBaseUrl(account.baseUrl);
}

export const CUSTOM_PRESET: PlatformPreset = {
  id: 'custom',
  name: '自定义平台',
  badgeColor: '#8b90a0',
  baseUrl: 'https://api.example.com/v1',
  balanceUrl: '',
  balanceJsonPath: '',
  currency: 'CNY',
  models: [],
};
