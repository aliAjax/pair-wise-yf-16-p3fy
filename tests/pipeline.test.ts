import { describe, expect, it } from "vitest";
import {
  buildSnapshotSteps,
  runWritePipeline,
  StepLedger,
  type PersistenceAdapter,
  type WriteStep,
} from "../src/domain/pipeline";

class MemAdapter implements PersistenceAdapter {
  data = new Map<string, string>();
  failOn = new Set<string>();

  async put(key: string, value: string): Promise<void> {
    if (this.failOn.has(key)) throw new Error(`写库失败：${key}`);
    this.data.set(key, value);
  }
}

function countingSteps(
  adapter: PersistenceAdapter,
  runs: Map<string, number>
): WriteStep[] {
  return ["s1", "s2", "s3"].map((key) => ({
    key,
    label: `步骤${key}`,
    run: async () => {
      runs.set(key, (runs.get(key) ?? 0) + 1);
      await adapter.put(key, "x");
    },
  }));
}

describe("写库管线：失败只重试尚未记账的步骤", () => {
  it("第 2 步写库失败后，重试只补跑未记账步骤", async () => {
    const adapter = new MemAdapter();
    const ledger = new StepLedger();
    const runs = new Map<string, number>();
    const steps = countingSteps(adapter, runs);

    // 第一次执行：第 2 步写库失败
    adapter.failOn = new Set(["s2"]);
    const first = await runWritePipeline(steps, ledger);
    expect(first.failedKey).toBe("s2");
    expect(first.completed).toEqual(["s1"]);
    expect(runs.get("s1")).toBe(1);
    expect(runs.get("s2")).toBe(1);
    expect(runs.get("s3")).toBeUndefined();

    // 故障恢复后重试：s1 已记账直接跳过，只补 s2、s3
    adapter.failOn = new Set();
    const second = await runWritePipeline(steps, ledger);
    expect(second.failedKey).toBeNull();
    expect(second.skipped).toEqual(["s1"]);
    expect(second.completed).toEqual(["s2", "s3"]);
    expect(runs.get("s1")).toBe(1); // 没有重复执行
    expect(runs.get("s2")).toBe(2);
    expect(runs.get("s3")).toBe(1);

    expect(ledger.has("s1")).toBe(true);
    expect(ledger.has("s2")).toBe(true);
    expect(ledger.has("s3")).toBe(true);
  });

  it("全部成功后再重试：全部跳过，一步都不重跑", async () => {
    const adapter = new MemAdapter();
    const ledger = new StepLedger();
    const runs = new Map<string, number>();
    const steps = countingSteps(adapter, runs);

    const first = await runWritePipeline(steps, ledger);
    expect(first.completed).toEqual(["s1", "s2", "s3"]);

    const second = await runWritePipeline(steps, ledger);
    expect(second.completed).toEqual([]);
    expect(second.skipped).toEqual(["s1", "s2", "s3"]);
    expect(runs.get("s1")).toBe(1);
    expect(runs.get("s2")).toBe(1);
    expect(runs.get("s3")).toBe(1);
  });

  it("批次步骤键带批次号，保证幂等", () => {
    const adapter = new MemAdapter();
    const steps = buildSnapshotSteps(
      "B007",
      { boards: [], plans: [], workOrders: [], ledger: [] },
      adapter
    );
    expect(steps.map((s) => s.key)).toEqual([
      "batch:B007:boards",
      "batch:B007:plans",
      "batch:B007:workOrders",
      "batch:B007:ledger",
    ]);
  });
});
