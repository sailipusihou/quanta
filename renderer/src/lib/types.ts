// 与 src/server/index.js snapshot() 返回结构一一对应

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  cacheHit: number;
  cacheMiss: number;
  totalTokens: number;
}

export interface Stats {
  requests: number;
  errors: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cacheHit: number;
  cacheMiss: number;
  cost: number;
}

export interface SeriesPoint extends Stats {
  start: number;
  end: number;
}

export interface BalanceSnapshot {
  ok: boolean;
  currency: string;
  isAvailable: boolean;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
  fetchedAt: number;
}

export interface BalanceError {
  message: string;
  fetchedAt: number;
}

export interface RequestEntry {
  kind: 'request';
  ts: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  stream: boolean;
  model: string | null;
  tag: string | null;
  keyId: string | null;
  originalModel: string | null;
  routed: boolean;
  failover: boolean;
  usage: Usage;
  cost: number;
  error: string | null;
}

export interface ModelStat {
  model: string;
  requests: number;
  totalTokens: number;
  cost: number;
  errors: number;
}

export interface TagStat {
  tag: string;
  requests: number;
  totalTokens: number;
  cost: number;
  errors: number;
}

export interface RechargeEntry {
  ts: number;
  amount: number;
  note: string;
}

export interface Account {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeys: ApiKeyItem[];
  models: string[];
  platformToken: string;
  hasPlatformToken: boolean;
  balanceUrl: string;
  balanceJsonPath: string;
  currency: string;
}

export interface TagRule {
  pattern: string;
  label: string;
}

export interface ModelRoute {
  pattern: string;
  to: string;
}

export interface ApiKeyItem {
  id: string;
  label: string;
  key: string; // 已掩码
}

export interface Profile {
  id: string;
  name: string;
  avatar: string | null;
  avatarUrl: string | null;
  accountId: string;
  apiKeyId: string;
  model: string;
  createdAt: number;
}

export interface AppConfig {
  proxyPort: number;
  balancePollMs: number;
  alertThreshold: number;
  requestNotify: string;
  language: string;
  theme: string;
  updateFeedUrl: string;
  tagRules: TagRule[];
  modelRoutes: ModelRoute[];
  failover: { enabled: boolean };
  autoStart: boolean;
  widget: { x: number | null; y: number | null; width: number; height: number; alwaysOnTop: boolean };
  selectedAccountId: string;
  selectedModel: string;
  accounts: Account[];
  hasApiKey: boolean;
}

export interface AppSnapshot {
  currentModel: string | null;
  daysLeft: number | null;
  todayOfficial: { consumed: number; toppedUp: number };
  last24hOfficial: { consumed: number; toppedUp: number };
  monthOfficial: { consumed: number; toppedUp: number };
  todayCalibration: { date: string; cost: number | null; tokens: number | null } | null;
  officialMonth: {
    ok: boolean;
    month: number;
    year: number;
    cost: number | null;
    tokens: number | null;
    requests: number | null;
    todayCost: number | null;
    todayTokens: number | null;
    todayRequests: number | null;
    raw?: string;
    error?: string | null;
    fetchedAt: number;
  } | null;
  officialToday: {
    ok: boolean;
    cost: number | null;
    tokens: number | null;
    requests: number | null;
    bucket: number | null;
    byModel: { model: string; cost: number; tokens: number; requests: number }[];
    hours: { start: number; cost: number }[];
    fetchedAt: number;
    error?: string | null;
  } | null;
  officialTrend: {
    ok: boolean;
    bucket: number | null;
    days: { start: number; end: number; cost: number; tokens: number; requests: number }[];
    fetchedAt: number;
    error?: string | null;
  } | null;
  balance: BalanceSnapshot | null;
  balanceError: BalanceError | null;
  estimatedTokens: number | null;
  stats: { today: Stats; month: Stats; last24h: Stats; week: Stats; all: Stats };
  series: { days: SeriesPoint[]; hours: SeriesPoint[] };
  byModel: ModelStat[];
  byTag: TagStat[];
  recent: RequestEntry[];
  recharges: {
    list: RechargeEntry[];
    total: number;
    consumedEstimate: number | null;
  };
  profiles: {
    activeId: string | null;
    list: Profile[];
  };
  server: { running: boolean; port: number | null };
  config: AppConfig;
  pricing: { period: string; accountName: string; priceSource: string };
  // 本地核销码授权状态
  license: {
    state: 'none' | 'active' | 'expired' | 'mismatch' | 'clock' | 'invalid';
    enforced: boolean;
    ok: boolean;
    tier: 'd7' | 'm30' | 'life' | null;
    tierLabel: string | null;
    activatedAt: number | null;
    expiresAt: number | null;
    daysLeft: number | null;
    hoursLeft: number | null;
    lifetime?: boolean;
    codeMasked: string | null;
    reason?: string;
    message?: string;
  };
}

export interface UpdateCheckResult {
  status: 'no-feed' | 'update-available' | 'up-to-date' | 'error';
  message?: string;
  version?: string;
  url?: string;
  notes?: string;
  currentVersion?: string;
}

export interface ExportResult {
  saved: boolean;
  reason?: string;
  path?: string;
}

export interface Api {
  getState(): Promise<AppSnapshot>;
  refreshBalance(): Promise<AppSnapshot>;
  saveSettings(patch: Record<string, unknown>): Promise<unknown>;
  switchAccount(id: string): Promise<unknown>;
  switchModel(accountId: string, model: string): Promise<unknown>;
  fetchModels(): Promise<{ fetched: number; reason?: string; error?: string; models?: string[] }>;
  priceCompare(
    promptTokens: number,
    completionTokens: number,
    force?: boolean
  ): Promise<{
    source: string;
    fetchedAt: number;
    rows: { platform: string; model: string; inRate: number; outRate: number; cost: number }[];
  }>;
  fetchOfficialUsage(): Promise<{
    ok: boolean;
    month: number;
    year: number;
    cost: number | null;
    tokens: number | null;
    requests: number | null;
    todayCost: number | null;
    todayTokens: number | null;
    todayRequests: number | null;
    raw?: string;
    error?: string | null;
  } | null>;
  saveCalibration(cost: number | null, tokens: number | null): Promise<unknown>;
  licenseStatus(): Promise<AppSnapshot['license']>;
  activateLicense(code: string): Promise<
    { ok: true; status: AppSnapshot['license'] } | { ok: false; reason: string; message: string; existingTier: string | null }
  >;
  listProfiles(): Promise<unknown>;
  createProfile(data: Record<string, unknown>): Promise<Profile>;
  updateProfile(id: string, patch: Record<string, unknown>): Promise<Profile | null>;
  deleteProfile(id: string): Promise<boolean>;
  switchProfile(id: string): Promise<unknown>;
  pickAvatar(profileId: string): Promise<{ saved: boolean; reason?: string; avatar?: string }>;
  addRecharge(amount: number, note: string): Promise<unknown>;
  exportCsv(): Promise<ExportResult>;
  checkUpdate(): Promise<UpdateCheckResult>;
  openExternal(url: string): Promise<void>;
  clearData(): Promise<boolean>;
  openDashboard(): Promise<void>;
  showWidget(): Promise<void>;
  setWidgetAlwaysOnTop(enabled: boolean): Promise<boolean>;
  hideWidget(): Promise<void>;
  minimize(): Promise<void>;
  maximizeToggle(): Promise<boolean>;
  closeWindow(): Promise<void>;
  quit(): Promise<void>;
  notifyWidgetMove(x: number, y: number): void;
  onState(cb: (s: AppSnapshot) => void): void;
}

declare global {
  interface Window {
    api: Api;
  }
}
