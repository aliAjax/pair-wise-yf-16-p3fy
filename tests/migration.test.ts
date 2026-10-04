import { describe, expect, it } from "vitest";
import { migrateLegacyBoards, type LegacyBoardRecord } from "../src/domain/migration";
import { TuningStore } from "../src/domain/store";

function legacyRecord(overrides: Partial<LegacyBoardRecord>): LegacyBoardRecord {
  return {
    legacyId: "OLD-1",
    brand: "Salomon",
    lengthCm: 154,
    boardType: "公园板",
    customerName: "陈先生",
    edgeThicknessMm: 1.7,
    sideAngleDeg: 89,
    baseAngleDeg: 1,
    waxType: "通用蜡",
    baseDamage: "无",
    ...overrides,
  };
}

function setup() {
  const store = new TuningStore();
  store.addTechnician("老周", "master");
  return store;
}

describe("旧数据升级", () => {
  it("带刃角的旧记录：档案正常，刃角只生成待确认草稿方案", () => {
    const store = setup();
    const summary = migrateLegacyBoards(store, [legacyRecord({})]);

    expect(summary.pendingReview).toEqual([]);
    expect(summary.draftPlanIds).toHaveLength(1);
    const plan = store.getPlan(summary.draftPlanIds[0]);
    expect(plan.status).toBe("draft");
    expect(store.getBoard(summary.imported[0]).status).toBe("active");
  });

  it("缺方案的标成待复核，复核前开工不放行", () => {
    const store = setup();
    const master = store.listTechnicians()[0];
    const summary = migrateLegacyBoards(store, [
      legacyRecord({ legacyId: "OLD-2", sideAngleDeg: null, baseAngleDeg: null }),
    ]);

    expect(summary.pendingReview).toHaveLength(1);
    const board = store.getBoard(summary.pendingReview[0]);
    expect(board.status).toBe("pending_review");
    expect(store.ledger.some((e) => e.kind === "migration_review")).toBe(true);

    // 待复核的板直接派单，放行检查必须拦下
    const order = store.createWorkOrder(board.id, null, "wax", master.id);
    const decision = store.releaseWorkOrder(order.id, order.version);
    expect(decision.allowed).toBe(false);
    expect(decision.checks.boardReviewed).toBe(false);
  });

  it("缺边刃厚度的同样标待复核", () => {
    const store = setup();
    const summary = migrateLegacyBoards(store, [
      legacyRecord({ legacyId: "OLD-3", edgeThicknessMm: null }),
    ]);
    expect(summary.pendingReview).toHaveLength(1);
  });

  it("复核通过后档案恢复正常", () => {
    const store = setup();
    const summary = migrateLegacyBoards(store, [
      legacyRecord({ legacyId: "OLD-4", sideAngleDeg: null, baseAngleDeg: null }),
    ]);
    const board = store.getBoard(summary.pendingReview[0]);
    store.markReviewed(board.id, board.version);
    expect(store.getBoard(board.id).status).toBe("active");
  });
});
