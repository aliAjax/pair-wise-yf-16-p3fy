import { describe, expect, it } from "vitest";
import { ConflictError, RuleError } from "../src/domain/errors";
import { TuningStore } from "../src/domain/store";

function setup() {
  const store = new TuningStore();
  const master = store.addTechnician("老周", "master");
  const apprentice = store.addTechnician("阿豪", "apprentice");
  const board = store.addBoard({
    brand: "Burton Custom",
    lengthCm: 156,
    boardType: "全能板",
    edgeThicknessMm: 2.0,
    waxType: "低温蜡",
    baseDamage: "无",
    customerName: "王先生",
    preference: { sideAngleDeg: 88, baseAngleDeg: 1, note: "" },
  });
  return { store, master, apprentice, board };
}

describe("客户改刃角偏好", () => {
  it("方案立刻失效，已放行工单退回待确认", () => {
    const { store, master, board } = setup();
    const plan = store.createPlan(board.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
    store.confirmPlan(plan.id, plan.version);
    const order = store.createWorkOrder(board.id, plan.id, "edge_grind", master.id);
    store.releaseWorkOrder(order.id, order.version);
    expect(store.getWorkOrder(order.id).status).toBe("released");

    const result = store.updatePreference(
      board.id,
      { sideAngleDeg: 89, baseAngleDeg: 1, note: "客户改口" },
      board.version
    );

    expect(result.invalidatedPlanIds).toEqual([plan.id]);
    expect(result.returnedOrderIds).toEqual([order.id]);
    expect(store.getPlan(plan.id).status).toBe("invalidated");
    expect(store.getWorkOrder(order.id).status).toBe("pending_confirmation");
    expect(store.getBoard(board.id).preferenceVersion).toBe(2);

    const kinds = store.ledger.map((e) => e.kind);
    expect(kinds).toContain("preference_changed");
    expect(kinds).toContain("plan_invalidated");
    expect(kinds).toContain("order_returned");
  });

  it("偏好已变的旧方案不允许再确认", () => {
    const { store, master, board } = setup();
    const plan = store.createPlan(board.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
    store.updatePreference(
      board.id,
      { sideAngleDeg: 89, baseAngleDeg: 1, note: "" },
      board.version
    );
    expect(() => store.confirmPlan(plan.id, store.getPlan(plan.id).version)).toThrow(
      /状态不允许确认|已失效/
    );
  });
});

describe("两台平板同时改同一块板", () => {
  it("只接受先写的一边，旧版本写入被拒并记账", () => {
    const { store, board } = setup();
    const tabletA = board.version;
    const tabletB = board.version; // 两台平板同时读到 v1

    // 平板A 先写：成功
    store.updatePreference(
      board.id,
      { sideAngleDeg: 89, baseAngleDeg: 1, note: "平板A" },
      tabletA
    );

    // 平板B 拿旧版本写：被拒，厚度不变
    expect(() => store.updateEdgeThickness(board.id, 1.1, tabletB)).toThrow(ConflictError);
    expect(store.getBoard(board.id).edgeThicknessMm).toBe(2.0);
    expect(store.ledger.some((e) => e.kind === "conflict_rejected")).toBe(true);
  });
});

describe("开工放行记账", () => {
  it("满足条件放行并记放行账", () => {
    const { store, master, board } = setup();
    const plan = store.createPlan(board.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
    store.confirmPlan(plan.id, plan.version);
    const order = store.createWorkOrder(board.id, plan.id, "edge_grind", master.id);

    const decision = store.releaseWorkOrder(order.id, order.version);
    expect(decision.allowed).toBe(true);
    expect(store.getWorkOrder(order.id).status).toBe("released");
    expect(store.ledger.some((e) => e.kind === "release_allowed")).toBe(true);
  });

  it("不满足条件不放行，工单留在待确认并记拒绝账", () => {
    const { store, master, apprentice, board } = setup();
    const plan = store.createPlan(board.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
    store.confirmPlan(plan.id, plan.version);
    // 学徒拿现成方案想磨刃
    const order = store.createWorkOrder(board.id, plan.id, "edge_grind", apprentice.id);

    const decision = store.releaseWorkOrder(order.id, order.version);
    expect(decision.allowed).toBe(false);
    expect(store.getWorkOrder(order.id).status).toBe("pending_confirmation");
    expect(store.ledger.some((e) => e.kind === "release_rejected")).toBe(true);
  });

  it("非待确认状态的工单不能重复放行", () => {
    const { store, master, board } = setup();
    const plan = store.createPlan(board.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
    store.confirmPlan(plan.id, plan.version);
    const order = store.createWorkOrder(board.id, plan.id, "edge_grind", master.id);
    store.releaseWorkOrder(order.id, order.version);
    expect(() =>
      store.releaseWorkOrder(order.id, store.getWorkOrder(order.id).version)
    ).toThrow(RuleError);
  });
});
