import { useSyncExternalStore } from "react";
import { MIN_EDGE_THICKNESS, ROLE_PERMS, nextId, nowIso, seed } from "./domain";
import type {
  Board,
  CheckResult,
  EdgePlan,
  EventLog,
  FailMode,
  Preference,
  ReleaseRecord,
  Settings,
  State,
  WorkOrder,
} from "./types";

const STORAGE_KEY = "ski-tuning-ledger-v1";

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed && Array.isArray(parsed.boards) && Array.isArray(parsed.workOrders)) {
        return parsed;
      }
    }
  } catch {
    // 落库数据损坏时回退到种子数据
  }
  return seed();
}

let state: State = loadState();
const listeners = new Set<() => void>();

/**
 * 全局状态更新：在 draft 上就地修改后，用展开运算产生新的顶层引用，
 * 触发 useSyncExternalStore 重渲染；随后落库 localStorage。
 */
function setState(updater: (draft: State) => void): void {
  const draft = state;
  updater(draft);
  state = { ...draft };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 落库失败不阻断内存流程，放行账仍以内存为准
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): State {
  return state;
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState);
}

// ---------- 工具 ----------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pushEvent(draft: State, level: EventLog["level"], message: string): void {
  draft.events.unshift({
    id: nextId("EV", draft.events.map((e) => e.id)),
    at: nowIso(),
    level,
    message,
  });
}

function findBoard(s: State, id: string): Board | undefined {
  return s.boards.find((b) => b.id === id);
}
function findPlan(s: State, id?: string): EdgePlan | undefined {
  return id ? s.plans.find((p) => p.id === id) : undefined;
}
function findOrder(s: State, id: string): WorkOrder | undefined {
  return s.workOrders.find((w) => w.id === id);
}

/** 并发冲突：两台平板同时修改同一块板，只接受一边 */
export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyError";
  }
}

// ---------- 开工前校验（只读，不写库） ----------

function checkPlan(plan: EdgePlan | undefined, board: Board | undefined): CheckResult {
  if (!plan) {
    return {
      key: "plan",
      label: "刃角方案",
      passed: false,
      detail: "缺少刃角方案，无法放行（旧数据升级后待复核，请先补方案）",
    };
  }
  if (plan.status === "已失效") {
    return {
      key: "plan",
      label: "刃角方案",
      passed: false,
      detail: `方案 FA-${plan.id} 已失效：客户偏好已变更（当前偏好「${board?.preference}」，方案依据「${plan.preference}」）`,
    };
  }
  if (plan.status === "待确认") {
    return {
      key: "plan",
      label: "刃角方案",
      passed: false,
      detail: `方案 FA-${plan.id} 尚未经客户确认，不得开工`,
    };
  }
  if (board && plan.preference !== board.preference) {
    return {
      key: "plan",
      label: "刃角方案",
      passed: false,
      detail: `方案偏好「${plan.preference}」与客户当前偏好「${board.preference}」不一致`,
    };
  }
  return {
    key: "plan",
    label: "刃角方案",
    passed: true,
    detail: `FA-${plan.id} 已确认（侧刃 ${plan.sideEdgeAngle}° / 底刃 ${plan.baseEdgeAngle}°，依据「${plan.preference}」）`,
  };
}

function checkThickness(board: Board | undefined): CheckResult {
  if (!board || typeof board.edgeThickness !== "number") {
    return { key: "thickness", label: "边刃厚度", passed: false, detail: "缺少最新边刃厚度测量值" };
  }
  if (board.edgeThickness < MIN_EDGE_THICKNESS) {
    return {
      key: "thickness",
      label: "边刃厚度",
      passed: false,
      detail: `最新边刃厚度 ${board.edgeThickness}mm 低于安全限值 ${MIN_EDGE_THICKNESS}mm，边刃已磨薄，禁止磨削`,
    };
  }
  return {
    key: "thickness",
    label: "边刃厚度",
    passed: true,
    detail: `最新边刃厚度 ${board.edgeThickness}mm ≥ ${MIN_EDGE_THICKNESS}mm，可磨削`,
  };
}

function checkTech(s: State, plan: EdgePlan | undefined, techId?: string): CheckResult {
  if (!techId) {
    return { key: "tech", label: "技师资质", passed: false, detail: "未指定施工技师" };
  }
  const tech = s.technicians.find((t) => t.id === techId);
  if (!tech) {
    return { key: "tech", label: "技师资质", passed: false, detail: "技师档案不存在" };
  }
  if (!tech.active) {
    return { key: "tech", label: "技师资质", passed: false, detail: `${tech.name} 已离岗，不得施工` };
  }
  const perm = ROLE_PERMS[tech.role];
  if (!perm.edgeAngle) {
    return {
      key: "tech",
      label: "技师资质",
      passed: false,
      detail: `${tech.name}（${tech.role}）无刃角作业资质：${perm.desc}，不得放行`,
    };
  }
  if (plan && plan.sideEdgeAngle < perm.minSideAngle) {
    return {
      key: "tech",
      label: "技师资质",
      passed: false,
      detail: `${tech.name}（${tech.role}）不可做侧刃 ${plan.sideEdgeAngle}°：${perm.desc}`,
    };
  }
  return {
    key: "tech",
    label: "技师资质",
    passed: true,
    detail: `${tech.name} · ${tech.role}，具备刃角作业资质（${perm.desc}）`,
  };
}

// ---------- 放行账写库步骤 ----------

const STEP_DEFS = [
  { key: "lockPlan", label: "锁定刃角方案" },
  { key: "updateOrder", label: "更新工单为已放行" },
  { key: "recordThickness", label: "记录边刃厚度基线" },
  { key: "postVoucher", label: "登记放行账凭证" },
] as const;

/**
 * 模拟一次写库。失败模式：
 * - none：不失败
 * - first：每单第一次写库必失败（演示用，保证可复现）
 * - random：按 failRate 随机失败
 */
function writeWillFail(s: State, release: ReleaseRecord): boolean {
  if (s.settings.failMode === "none") return false;
  if (s.settings.failMode === "first") return !release.forcedFailDone;
  return Math.random() < s.settings.failRate;
}

/** 单步写库的实际落库内容（幂等：重复执行不会重复记账） */
function applyStepWrite(draft: State, release: ReleaseRecord, stepKey: string): void {
  const now = nowIso();
  if (stepKey === "lockPlan") {
    const plan = findPlan(draft, release.planId);
    if (plan && plan.lockedByRelease !== release.id) {
      plan.lockedByRelease = release.id;
    }
  } else if (stepKey === "updateOrder") {
    const wo = findOrder(draft, release.workOrderId);
    if (wo && (wo.status !== "已放行" || wo.releaseId !== release.id)) {
      wo.status = "已放行";
      wo.releaseId = release.id;
    }
  } else if (stepKey === "recordThickness") {
    const board = findBoard(draft, release.boardId);
    if (board && !board.history.some((h) => h.releaseId === release.id)) {
      board.history.push({ at: now, thickness: board.edgeThickness, releaseId: release.id });
    }
  } else if (stepKey === "postVoucher") {
    release.voucherPosted = true;
  }
}

/**
 * 尝试执行一个放行账步骤。
 * 已记账的步骤直接跳过（幂等）；写库失败则该步不记账，等待重试。
 */
async function attemptStep(releaseId: string, stepKey: string): Promise<void> {
  const s = getState();
  const release = s.releases.find((r) => r.id === releaseId);
  const step = release?.steps.find((st) => st.key === stepKey);
  if (!release || !step) return;
  if (step.status === "已记账") return; // 已记账：不重复执行

  step.attempts += 1;
  await delay(450);

  if (writeWillFail(getState(), release)) {
    setState((draft) => {
      const r = draft.releases.find((x) => x.id === releaseId);
      const st = r?.steps.find((x) => x.key === stepKey);
      if (r && st) {
        st.status = "失败";
        st.detail = "写库失败（模拟），本步未记账";
        r.updatedAt = nowIso();
        if (draft.settings.failMode === "first") r.forcedFailDone = true;
        pushEvent(draft, "error", `放行单 ${r.id} 步骤「${st.label}」写库失败，未记账，可重试该步`);
      }
    });
    return;
  }

  setState((draft) => {
    const r = draft.releases.find((x) => x.id === releaseId);
    const st = r?.steps.find((x) => x.key === stepKey);
    if (r && st) {
      applyStepWrite(draft, r, stepKey);
      st.status = "已记账";
      st.recordedAt = nowIso();
      st.detail = "已记账";
      r.updatedAt = nowIso();
      pushEvent(draft, "success", `放行单 ${r.id} 步骤「${st.label}」记账成功`);
    }
  });
}

// ---------- 开工放行 ----------

/** 开工前校验 + 生成放行账；校验通过才逐步写库记账。 */
export async function runRelease(workOrderId: string, techId: string): Promise<string | undefined> {
  const s = getState();
  const wo = findOrder(s, workOrderId);
  if (!wo) return undefined;
  const board = findBoard(s, wo.boardId);
  const plan = findPlan(s, wo.planId);

  const checks: CheckResult[] = [
    checkPlan(plan, board),
    checkThickness(board),
    checkTech(s, plan, techId),
  ];
  const passed = checks.every((c) => c.passed);

  const release: ReleaseRecord = {
    id: nextId("REL", s.releases.map((r) => r.id)),
    workOrderId,
    boardId: wo.boardId,
    planId: plan?.id,
    techId,
    status: passed ? "放行成功" : "校验未通过",
    checks,
    steps: passed
      ? STEP_DEFS.map((d) => ({ key: d.key, label: d.label, status: "未开始" as const, attempts: 0 }))
      : [],
    forcedFailDone: false,
    voucherPosted: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  setState((draft) => {
    draft.releases.unshift(release);
    pushEvent(
      draft,
      passed ? "info" : "warn",
      passed
        ? `工单 ${workOrderId} 开工校验通过，生成放行单 ${release.id}，开始记账`
        : `工单 ${workOrderId} 开工校验未通过，不放行（${checks
            .filter((c) => !c.passed)
            .map((c) => c.label)
            .join("、")}）`
    );
  });

  if (!passed) return release.id;

  for (const stepDef of STEP_DEFS) {
    await attemptStep(release.id, stepDef.key);
    const r = getState().releases.find((x) => x.id === release.id);
    const st = r?.steps.find((x) => x.key === stepDef.key);
    if (st?.status === "失败") {
      setState((draft) => {
        const rr = draft.releases.find((x) => x.id === release.id);
        if (rr) {
          rr.status = "放行失败待重试";
          rr.updatedAt = nowIso();
        }
      });
      return release.id;
    }
  }

  setState((draft) => {
    const rr = draft.releases.find((x) => x.id === release.id);
    if (rr) {
      rr.status = "放行成功";
      rr.updatedAt = nowIso();
      pushEvent(draft, "success", `放行单 ${rr.id} 全部步骤记账完成，工单已放行开工`);
    }
  });
  return release.id;
}

/** 重试放行：只重试尚未记账（失败/未开始）的步骤，已记账步骤跳过。 */
export async function retryRelease(releaseId: string): Promise<void> {
  const s = getState();
  const release = s.releases.find((r) => r.id === releaseId);
  if (!release || release.status === "放行成功") return;

  setState((draft) => {
    const r = draft.releases.find((x) => x.id === releaseId);
    if (r) {
      r.status = "放行成功"; // 占位，若仍有失败会被打回
      r.updatedAt = nowIso();
      pushEvent(draft, "info", `放行单 ${r.id} 开始重试：仅重试尚未记账的步骤，已记账步骤不重复执行`);
    }
  });

  for (const stepDef of STEP_DEFS) {
    const r0 = getState().releases.find((x) => x.id === releaseId);
    const st0 = r0?.steps.find((x) => x.key === stepDef.key);
    if (st0?.status === "已记账") continue; // 已记账：跳过
    await attemptStep(releaseId, stepDef.key);
    const r = getState().releases.find((x) => x.id === releaseId);
    const st = r?.steps.find((x) => x.key === stepDef.key);
    if (st?.status === "失败") {
      setState((draft) => {
        const rr = draft.releases.find((x) => x.id === releaseId);
        if (rr) {
          rr.status = "放行失败待重试";
          rr.updatedAt = nowIso();
        }
      });
      return;
    }
  }

  setState((draft) => {
    const rr = draft.releases.find((x) => x.id === releaseId);
    if (rr) {
      rr.status = "放行成功";
      rr.updatedAt = nowIso();
      pushEvent(draft, "success", `放行单 ${rr.id} 重试完成，全部步骤已记账`);
    }
  });
}

// ---------- 业务动作 ----------

/**
 * 客户变更刃角偏好：
 * - 方案立刻失效（已确认/待确认的当前方案置为已失效）
 * - 相关在制工单退回「待确认」
 * - 乐观锁：expectedVersion 与当前版本不一致则拒绝（并发修改只接受一边）
 */
export function changePreference(
  boardId: string,
  preference: Preference,
  expectedVersion: number
): void {
  const s = getState();
  const board = findBoard(s, boardId);
  if (!board) return;
  if (board.version !== expectedVersion) {
    setState((draft) => {
      pushEvent(
        draft,
        "error",
        `并发冲突：对雪板 ${boardId} 的修改基于旧版本 v${expectedVersion}，当前已是 v${board.version}，本次修改被拒绝（同一块板只接受一边）`
      );
    });
    throw new ConcurrencyError(
      `雪板 ${boardId} 已被其他平板修改（v${expectedVersion} → v${board.version}），请刷新后重试`
    );
  }

  setState((draft) => {
    const b = draft.boards.find((x) => x.id === boardId);
    if (!b) return;
    b.preference = preference;
    b.version += 1;

    const plan = draft.plans.find((p) => p.boardId === boardId && p.status !== "已失效");
    if (plan) {
      plan.status = "已失效";
      plan.invalidatedAt = nowIso();
    }
    let returned = 0;
    draft.workOrders.forEach((w) => {
      if (w.boardId === boardId && ["待开工", "已放行", "施工中"].includes(w.status)) {
        w.status = "待确认";
        returned += 1;
      }
    });
    pushEvent(
      draft,
      "warn",
      `客户变更雪板 ${boardId} 刃角偏好为「${preference}」：方案 ${plan ? `FA-${plan.id}` : "（无）"} 立即失效，${returned} 张在制工单退回待确认`
    );
  });
}

/** 更新边刃厚度（带乐观锁） */
export function updateThickness(boardId: string, thickness: number, expectedVersion: number): void {
  const s = getState();
  const board = findBoard(s, boardId);
  if (!board) return;
  if (board.version !== expectedVersion) {
    throw new ConcurrencyError(
      `雪板 ${boardId} 已被其他平板修改（v${expectedVersion} → v${board.version}），请刷新后重试`
    );
  }
  setState((draft) => {
    const b = draft.boards.find((x) => x.id === boardId);
    if (!b) return;
    b.edgeThickness = thickness;
    b.version += 1;
    pushEvent(draft, "info", `雪板 ${boardId} 边刃厚度更新为 ${thickness}mm（v${b.version}）`);
  });
}

/** 客户确认方案 */
export function confirmPlan(planId: string): void {
  setState((draft) => {
    const plan = draft.plans.find((p) => p.id === planId);
    if (!plan || plan.status !== "待确认") return;
    plan.status = "已确认";
    plan.confirmedAt = nowIso();
    pushEvent(draft, "success", `方案 FA-${plan.id} 经客户确认（侧刃 ${plan.sideEdgeAngle}°/底刃 ${plan.baseEdgeAngle}°，依据「${plan.preference}」），可排产`);
  });
}

/**
 * 旧数据升级：缺有效方案的雪板标为「待复核」，相关工单退回待确认。
 */
export function migrateLegacy(): void {
  setState((draft) => {
    let pending = 0;
    let returned = 0;
    draft.boards.forEach((b) => {
      const hasValidPlan = draft.plans.some(
        (p) => p.boardId === b.id && p.status === "已确认"
      );
      // 仅旧数据中缺有效方案的雪板标为「待复核」；已有方案（含待确认）的不在此列
      if (b.legacy && !hasValidPlan) {
        if (b.status !== "待复核") {
          b.status = "待复核";
          pending += 1;
        }
        draft.workOrders.forEach((w) => {
          if (w.boardId === b.id && ["待开工", "已放行", "施工中"].includes(w.status)) {
            w.status = "待确认";
            returned += 1;
          }
        });
      }
    });
    draft.migrated = true;
    pushEvent(
      draft,
      "info",
      `旧数据升级完成：${pending} 块雪板缺有效刃角方案，已标为「待复核」；${returned} 张工单退回待确认，待补方案后放行`
    );
  });
}

/** 模拟两台平板同时修改同一块板：只接受一边 */
export async function concurrentEditDemo(boardId: string): Promise<void> {
  const s = getState();
  const board = findBoard(s, boardId);
  if (!board) return;
  const baseVersion = board.version;
  const prefA: Preference = board.preference === "强咬雪" ? "弱咬雪" : "强咬雪";
  const prefB: Preference = board.preference === "中性" ? "强咬雪" : "中性";

  pushEvent(getState(), "info", `并发演示：两台平板同时读取雪板 ${boardId}（v${baseVersion}），先后提交修改`);
  listeners.forEach((l) => l());

  await delay(300);
  // 平板 A 先提交（基于旧版本）→ 成功
  try {
    changePreference(boardId, prefA, baseVersion);
    pushEvent(getState(), "success", `平板 A 提交成功：雪板 ${boardId} 偏好改为「${prefA}」（v${baseVersion} → v${baseVersion + 1}）`);
    listeners.forEach((l) => l());
  } catch (e) {
    pushEvent(getState(), "error", `平板 A 提交异常：${(e as Error).message}`);
    listeners.forEach((l) => l());
  }

  await delay(300);
  // 平板 B 仍基于旧版本提交 → 冲突，被拒绝
  try {
    changePreference(boardId, prefB, baseVersion);
  } catch (e) {
    pushEvent(getState(), "warn", `平板 B 提交被拒绝：${(e as Error).message}。同一块板只接受一边，以平板 A 为准`);
    listeners.forEach((l) => l());
  }
}

/** 更新写库失败模拟设置 */
export function updateSettings(patch: Partial<Settings>): void {
  setState((draft) => {
    Object.assign(draft.settings, patch);
  });
}

/** 重置演示数据 */
export function resetAll(): void {
  setState(() => seed());
}
