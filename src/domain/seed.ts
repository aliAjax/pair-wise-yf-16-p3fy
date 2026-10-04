import { TuningStore } from "./store";
import type { LegacyBoardRecord } from "./migration";

export interface SeedRefs {
  masterId: string;
  technicianId: string;
  apprenticeId: string;
  boardIds: string[];
}

/** 造一批演示数据：三种角色的技师、三块板、已确认方案和若干工单 */
export function seedStore(): { store: TuningStore; refs: SeedRefs } {
  const store = new TuningStore();

  const master = store.addTechnician("老周", "master");
  const tech = store.addTechnician("小林", "technician");
  const apprentice = store.addTechnician("阿豪", "apprentice");

  // B-001：全能板，方案已确认，厚度健康
  const b1 = store.addBoard({
    brand: "Burton Custom",
    lengthCm: 156,
    boardType: "全能板",
    edgeThicknessMm: 2.0,
    waxType: "低温蜡",
    baseDamage: "无",
    customerName: "王先生",
    preference: { sideAngleDeg: 88, baseAngleDeg: 1, note: "常规全能" },
  });
  const p1 = store.createPlan(b1.id, { sideAngleDeg: 88, baseAngleDeg: 1 }, master.id);
  store.confirmPlan(p1.id, p1.version);
  // 学徒想磨刃 → 应被角色权限拦下
  store.createWorkOrder(b1.id, p1.id, "edge_grind", apprentice.id);
  // 老师傅磨刃 → 应放行
  store.createWorkOrder(b1.id, p1.id, "edge_grind", master.id);

  // B-002：竞速板，边刃已磨到 1.5mm，低于竞速板 1.6mm 下限
  const b2 = store.addBoard({
    brand: "Atomic Redster",
    lengthCm: 165,
    boardType: "竞速板",
    edgeThicknessMm: 1.5,
    waxType: "竞速蜡",
    baseDamage: "底板划痕 12cm",
    customerName: "李女士",
    preference: { sideAngleDeg: 87, baseAngleDeg: 0.5, note: "竞速强咬雪" },
  });
  const p2 = store.createPlan(b2.id, { sideAngleDeg: 87, baseAngleDeg: 0.5 }, master.id);
  store.confirmPlan(p2.id, p2.version);
  // 老师傅也不能开工：边刃太薄
  store.createWorkOrder(b2.id, p2.id, "edge_grind", master.id);

  // B-003：粉雪板，方案已确认，用来演示客户改偏好 → 方案失效、工单退回
  const b3 = store.addBoard({
    brand: "Jones Powder",
    lengthCm: 158,
    boardType: "粉雪板",
    edgeThicknessMm: 1.8,
    waxType: "粉雪蜡",
    baseDamage: "刃口锈斑",
    customerName: "赵女士",
    preference: { sideAngleDeg: 89, baseAngleDeg: 1, note: "弱咬雪" },
  });
  const p3 = store.createPlan(b3.id, { sideAngleDeg: 89, baseAngleDeg: 1 }, tech.id);
  store.confirmPlan(p3.id, p3.version);
  store.createWorkOrder(b3.id, p3.id, "edge_grind", tech.id);

  return {
    store,
    refs: {
      masterId: master.id,
      technicianId: tech.id,
      apprenticeId: apprentice.id,
      boardIds: [b1.id, b2.id, b3.id],
    },
  };
}

/** 待导入的旧系统数据：一条带刃角、一条缺刃角 */
export const LEGACY_RECORDS: LegacyBoardRecord[] = [
  {
    legacyId: "OLD-771",
    brand: "Salomon Craft",
    lengthCm: 154,
    boardType: "公园板",
    customerName: "陈先生",
    edgeThicknessMm: 1.7,
    sideAngleDeg: 89,
    baseAngleDeg: 1,
    waxType: "通用蜡",
    baseDamage: "板头磕碰",
  },
  {
    legacyId: "OLD-772",
    brand: "K2 老款",
    lengthCm: 160,
    boardType: "全能板",
    customerName: "孙女士",
    edgeThicknessMm: null,
    sideAngleDeg: null,
    baseAngleDeg: null,
    waxType: "未知",
    baseDamage: "待检查",
  },
];
