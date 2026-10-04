import type { TuningStore } from "./store";
import type { BoardType } from "./types";

/** 旧系统导出的雪板记录：没有方案概念，刃角只是两个数字，厚度也可能缺 */
export interface LegacyBoardRecord {
  legacyId: string;
  brand: string;
  lengthCm: number;
  boardType: BoardType;
  customerName: string;
  edgeThicknessMm: number | null;
  sideAngleDeg: number | null;
  baseAngleDeg: number | null;
  waxType: string;
  baseDamage: string;
}

export interface MigrationSummary {
  imported: string[];
  pendingReview: string[];
  draftPlanIds: string[];
}

/**
 * 旧数据升级：有刃角数据的生成草稿方案（仍待客户确认）；
 * 缺方案（或缺边刃厚度）的一律标成待复核，复核前不放行。
 */
export function migrateLegacyBoards(
  store: TuningStore,
  records: LegacyBoardRecord[]
): MigrationSummary {
  const summary: MigrationSummary = { imported: [], pendingReview: [], draftPlanIds: [] };

  for (const rec of records) {
    const missing: string[] = [];
    if (rec.sideAngleDeg === null || rec.baseAngleDeg === null) missing.push("缺刃角方案");
    if (rec.edgeThicknessMm === null) missing.push("缺边刃厚度");

    const board = store.importBoard({
      brand: rec.brand,
      lengthCm: rec.lengthCm,
      boardType: rec.boardType,
      customerName: rec.customerName,
      edgeThicknessMm: rec.edgeThicknessMm ?? 0,
      waxType: rec.waxType,
      baseDamage: rec.baseDamage,
      preference:
        rec.sideAngleDeg !== null && rec.baseAngleDeg !== null
          ? { sideAngleDeg: rec.sideAngleDeg, baseAngleDeg: rec.baseAngleDeg, note: "旧数据带入" }
          : { sideAngleDeg: 0, baseAngleDeg: 0, note: "旧数据缺失，待与客户核对" },
    });
    summary.imported.push(board.id);

    if (rec.sideAngleDeg !== null && rec.baseAngleDeg !== null) {
      // 旧记录里的刃角只能算草稿，客户确认前不算数
      const anyTech = store.listTechnicians()[0];
      if (anyTech) {
        const plan = store.createPlan(
          board.id,
          { sideAngleDeg: rec.sideAngleDeg, baseAngleDeg: rec.baseAngleDeg },
          anyTech.id
        );
        summary.draftPlanIds.push(plan.id);
      }
    }

    if (missing.length > 0) {
      store.markPendingReview(board.id, `旧数据 ${rec.legacyId} 升级：${missing.join("、")}`);
      summary.pendingReview.push(board.id);
    }
  }

  return summary;
}
