import type {
  BoardProfile,
  BoardType,
  EdgePlan,
  OperationType,
  Technician,
  TechRole,
  WorkOrder,
} from "./types";
import { OPERATION_LABELS, ROLE_LABELS } from "./types";

/** 各板型边刃厚度安全下限（mm）：低于此值禁止再磨，边刃磨薄了必须有人拦 */
export const MIN_EDGE_THICKNESS_MM: Record<BoardType, number> = {
  竞速板: 1.6,
  全能板: 1.4,
  公园板: 1.3,
  粉雪板: 1.3,
};

/** 技师角色权限：能做什么工序、能在什么板型上做 */
export const ROLE_PERMISSIONS: Record<
  TechRole,
  { operations: OperationType[]; boardTypes: BoardType[] | "all" }
> = {
  master: { operations: ["edge_grind", "wax", "base_repair"], boardTypes: "all" },
  technician: {
    operations: ["edge_grind", "wax", "base_repair"],
    // 竞速板磨刃只能老师傅上手
    boardTypes: ["全能板", "公园板", "粉雪板"],
  },
  // 学徒不得磨刃改角，只能打蜡和底板修补
  apprentice: { operations: ["wax", "base_repair"], boardTypes: "all" },
};

export interface ReleaseInput {
  board: BoardProfile;
  plan: EdgePlan | null;
  workOrder: WorkOrder;
  technician: Technician;
}

export interface ReleaseDecision {
  allowed: boolean;
  reasons: string[];
  checks: {
    boardReviewed: boolean;
    planConfirmed: boolean;
    planCurrent: boolean;
    thicknessOk: boolean;
    roleAllowed: boolean;
  };
}

/**
 * 开工放行检查：客户确认的方案 + 最新边刃厚度 + 技师角色权限，
 * 任一不满足就不放行。纯函数，结果由调用方记进放行账。
 */
export function evaluateRelease(input: ReleaseInput): ReleaseDecision {
  const { board, plan, workOrder, technician } = input;
  const reasons: string[] = [];

  const boardReviewed = board.status !== "pending_review";
  if (!boardReviewed) {
    reasons.push("雪板档案待复核：旧数据升级后缺方案，复核前不放行");
  }

  const planConfirmed = plan !== null && plan.status === "confirmed";
  if (plan === null) {
    reasons.push("工单未关联刃角方案：口头定角不算数，先出方案并经客户确认");
  } else if (plan.status === "draft") {
    reasons.push(`方案 ${plan.id} 尚未经客户确认`);
  } else if (plan.status === "invalidated") {
    reasons.push(
      `方案 ${plan.id} 已失效（${plan.invalidateReason ?? "客户改动刃角偏好"}），需重新出方案`
    );
  }

  const planCurrent =
    plan !== null && plan.preferenceVersion === board.preferenceVersion;
  if (plan !== null && !planCurrent) {
    reasons.push(
      `方案基于偏好 v${plan.preferenceVersion}，客户当前偏好 v${board.preferenceVersion}，方案已过时`
    );
  }

  const minThickness = MIN_EDGE_THICKNESS_MM[board.boardType];
  const thicknessOk = board.edgeThicknessMm >= minThickness;
  if (!thicknessOk) {
    reasons.push(
      `最新边刃厚度 ${board.edgeThicknessMm}mm 低于${board.boardType}安全下限 ${minThickness}mm，禁止再磨`
    );
  }

  const perm = ROLE_PERMISSIONS[technician.role];
  const operationOk = perm.operations.includes(workOrder.operation);
  const boardTypeOk =
    perm.boardTypes === "all" || perm.boardTypes.includes(board.boardType);
  const roleAllowed = operationOk && boardTypeOk;
  if (!operationOk) {
    reasons.push(
      `${ROLE_LABELS[technician.role]}无权执行「${OPERATION_LABELS[workOrder.operation]}」`
    );
  } else if (!boardTypeOk) {
    reasons.push(
      `${ROLE_LABELS[technician.role]}无权在${board.boardType}上执行「${OPERATION_LABELS[workOrder.operation]}」，需老师傅`
    );
  }

  const allowed =
    boardReviewed && planConfirmed && planCurrent && thicknessOk && roleAllowed;

  return {
    allowed,
    reasons,
    checks: { boardReviewed, planConfirmed, planCurrent, thicknessOk, roleAllowed },
  };
}
