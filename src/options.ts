export interface DiffSettings {
  gitPath: string;
  showMarkers: boolean;
  fontSize: number;
  contextLines: number;
  inlineHighlights: boolean;
  showWhitespace: boolean;
  followEditor: boolean;
  followNavigation: boolean;
  editDelayMs: number;
  gitPollSeconds: number;
  maxFileMiB: number;
  maxLines: number;
}

export type DocumentLimits = Pick<DiffSettings, 'maxFileMiB' | 'maxLines'>;

export const DEFAULT_SETTINGS: DiffSettings = {
  gitPath: 'git', showMarkers: true, fontSize: 13, contextLines: 3,
  inlineHighlights: true, showWhitespace: true, followEditor: true, followNavigation: true,
  editDelayMs: 350, gitPollSeconds: 5, maxFileMiB: 2, maxLines: 20_000,
};

export const SETTING_LIMITS = {
  maxFileMiB: [1, 20, 1], maxLines: [1000, 200_000, 1000],
  fontSize: [10, 22, 1], contextLines: [0, 10, 1], editDelayMs: [100, 2000, 50], gitPollSeconds: [2, 60, 1],
} as const;

// Dropdown presets. A stored value outside a list is still offered, so nothing is lost on upgrade.
const range = (min: number, max: number): number[] => Array.from({ length: max - min + 1 }, (_, index) => min + index);
export const SETTING_CHOICES: Record<keyof typeof SETTING_LIMITS, readonly number[]> = {
  fontSize: range(10, 22), contextLines: range(0, 10),
  editDelayMs: [100, 200, 350, 500, 1000, 2000], gitPollSeconds: [2, 5, 10, 30, 60],
  maxFileMiB: [1, 2, 5, 10, 20], maxLines: [1000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000],
};

export function normalizeSettings(value: unknown): DiffSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_SETTINGS };
  if (typeof input.gitPath === 'string' && input.gitPath.trim()) result.gitPath = input.gitPath.trim();
  for (const key of ['showMarkers', 'inlineHighlights', 'showWhitespace', 'followEditor', 'followNavigation'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  for (const key of Object.keys(SETTING_LIMITS) as (keyof typeof SETTING_LIMITS)[]) {
    const number = input[key];
    const [min, max] = SETTING_LIMITS[key];
    if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.min(max, Math.max(min, Math.round(number)));
  }
  return result;
}
