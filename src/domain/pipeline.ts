/**
 * 写库管线：一批写库步骤逐步执行，每完成一步就在步骤账上记账。
 * 写库失败后重试时，已记账的步骤直接跳过，只补尚未记账的步骤。
 */

export interface WriteStep {
  /** 幂等键：同一批次的同一步骤键不变，重试时凭它跳过 */
  key: string;
  label: string;
  run: () => Promise<void>;
}

export interface StepLedgerEntry {
  key: string;
  label: string;
  at: number;
}

/** 步骤账：记录哪些写库步骤已经落库 */
export class StepLedger {
  private recordedKeys = new Set<string>();
  readonly entries: StepLedgerEntry[] = [];

  has(key: string): boolean {
    return this.recordedKeys.has(key);
  }

  record(key: string, label: string): void {
    if (this.recordedKeys.has(key)) return;
    this.recordedKeys.add(key);
    this.entries.push({ key, label, at: Date.now() });
  }
}

export interface PipelineResult {
  /** 本次执行真正落库的步骤 */
  completed: string[];
  /** 已记账被跳过的步骤 */
  skipped: string[];
  failedKey: string | null;
  error: unknown;
}

export async function runWritePipeline(
  steps: WriteStep[],
  ledger: StepLedger
): Promise<PipelineResult> {
  const result: PipelineResult = { completed: [], skipped: [], failedKey: null, error: null };
  for (const step of steps) {
    if (ledger.has(step.key)) {
      result.skipped.push(step.key);
      continue;
    }
    try {
      await step.run();
    } catch (error) {
      result.failedKey = step.key;
      result.error = error;
      return result;
    }
    ledger.record(step.key, step.label);
    result.completed.push(step.key);
  }
  return result;
}

/** 写库适配器：真正的落库动作；测试/演示时可注入失败 */
export interface PersistenceAdapter {
  put(key: string, value: string): Promise<void>;
}

export class LocalStorageAdapter implements PersistenceAdapter {
  /** 模拟写库失败：命中这些键的写入会抛错 */
  failOnKeys = new Set<string>();

  async put(key: string, value: string): Promise<void> {
    if (this.failOnKeys.has(key)) {
      throw new Error(`写库失败：${key}`);
    }
    localStorage.setItem(key, value);
  }
}

export interface SnapshotSource {
  boards: unknown;
  plans: unknown;
  workOrders: unknown;
  ledger: unknown;
}

/** 把当前四本账打成一个写库批次，步骤键带批次号保证幂等 */
export function buildSnapshotSteps(
  batchId: string,
  source: SnapshotSource,
  adapter: PersistenceAdapter
): WriteStep[] {
  const parts: Array<[string, unknown]> = [
    ["boards", source.boards],
    ["plans", source.plans],
    ["workOrders", source.workOrders],
    ["ledger", source.ledger],
  ];
  return parts.map(([name, data]) => ({
    key: `batch:${batchId}:${name}`,
    label: `写入${name}快照（批次 ${batchId}）`,
    run: () => adapter.put(`tuning:${batchId}:${name}`, JSON.stringify(data)),
  }));
}
