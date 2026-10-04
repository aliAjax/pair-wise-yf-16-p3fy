import { describe, expect, it } from "vitest";
import { evaluateRelease } from "../src/domain/release";
import type {
  BoardProfile,
  EdgePlan,
  Technician,
  WorkOrder,
} from "../src/domain/types";

function makeBoard(overrides: Partial<BoardProfile> = {}): BoardProfile {
  return {
    id: "B-1",
    brand: "Burton",
    lengthCm: 156,
    boardType: "全能板",
    edgeThicknessMm: 2.0,
    waxType: "低温蜡",
    baseDamage: "无",
    customerName: "客户",
    preference: { sideAngleDeg: 88, baseAngleDeg: 1, note: "" },
    preferenceVersion: 1,
    status: "active",
    version: 1,
    ...overrides,
  };
}

function makePlan(overrides: Partial<EdgePlan> = {}): EdgePlan {
  return {
    id: "P-1",
    boardId: "B-1",
    sideAngleDeg: 88,
    baseAngleDeg: 1,
    preferenceVersion: 1,
    status: "confirmed",
    createdBy: "T-1",
    createdAt: 0,
    confirmedAt: 1,
    invalidatedAt: null,
    invalidateReason: null,
    version: 1,
    ...overrides,
  };
}

function makeOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "WO-1",
    boardId: "B-1",
    planId: "P-1",
    operation: "edge_grind",
    technicianId: "T-1",
    status: "pending_confirmation",
    version: 1,
    createdAt: 0,
    ...overrides,
  };
}

const master: Technician = { id: "T-1", name: "老周", role: "master" };
const tech: Technician = { id: "T-2", name: "小林", role: "technician" };
const apprentice: Technician = { id: "T-3", name: "阿豪", role: "apprentice" };

describe("开工放行检查", () => {
  it("方案已确认、厚度达标、权限匹配 → 放行", () => {
    const d = evaluateRelease({
      board: makeBoard(),
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(true);
    expect(d.reasons).toEqual([]);
  });

  it("学徒磨刃 → 不放行；学徒打蜡 → 放行", () => {
    const grind = evaluateRelease({
      board: makeBoard(),
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: apprentice,
    });
    expect(grind.allowed).toBe(false);
    expect(grind.reasons.join()).toContain("学徒");

    const wax = evaluateRelease({
      board: makeBoard(),
      plan: makePlan(),
      workOrder: makeOrder({ operation: "wax" }),
      technician: apprentice,
    });
    expect(wax.allowed).toBe(true);
  });

  it("技师在竞速板上磨刃 → 不放行，老师傅才行", () => {
    const raceBoard = makeBoard({ boardType: "竞速板", edgeThicknessMm: 2.0 });
    const byTech = evaluateRelease({
      board: raceBoard,
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: tech,
    });
    expect(byTech.allowed).toBe(false);
    expect(byTech.reasons.join()).toContain("老师傅");

    const byMaster = evaluateRelease({
      board: raceBoard,
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(byMaster.allowed).toBe(true);
  });

  it("边刃磨薄到低于板型下限 → 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard({ boardType: "竞速板", edgeThicknessMm: 1.5 }),
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.checks.thicknessOk).toBe(false);
    expect(d.reasons.join()).toContain("1.5mm");
  });

  it("方案未经客户确认 → 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard(),
      plan: makePlan({ status: "draft", confirmedAt: null }),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join()).toContain("尚未经客户确认");
  });

  it("客户改过偏好导致方案版本落后 → 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard({ preferenceVersion: 2 }),
      plan: makePlan({ preferenceVersion: 1 }),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.checks.planCurrent).toBe(false);
  });

  it("方案已失效 → 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard(),
      plan: makePlan({ status: "invalidated", invalidateReason: "客户改动刃角偏好" }),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join()).toContain("已失效");
  });

  it("工单未关联方案（口头定角）→ 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard(),
      plan: null,
      workOrder: makeOrder({ planId: null }),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join()).toContain("口头定角");
  });

  it("档案待复核 → 不放行", () => {
    const d = evaluateRelease({
      board: makeBoard({ status: "pending_review" }),
      plan: makePlan(),
      workOrder: makeOrder(),
      technician: master,
    });
    expect(d.allowed).toBe(false);
    expect(d.checks.boardReviewed).toBe(false);
  });
});
