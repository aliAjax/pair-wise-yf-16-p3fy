/** 板型 */
export type BoardType = "全能板" | "竞速板" | "公园板" | "粉雪板";

/** 工单工序 */
export type OperationType = "edge_grind" | "wax" | "base_repair";

export const OPERATION_LABELS: Record<OperationType, string> = {
  edge_grind: "磨刃改角",
  wax: "打蜡",
  base_repair: "底板修补",
};

/** 技师角色 */
export type TechRole = "master" | "technician" | "apprentice";

export const ROLE_LABELS: Record<TechRole, string> = {
  master: "老师傅",
  technician: "技师",
  apprentice: "学徒",
};

export interface Technician {
  id: string;
  name: string;
  role: TechRole;
}

/** 雪板档案状态：待复核 = 旧数据升级后缺方案，复核前不放行 */
export type BoardStatus = "active" | "pending_review";

export interface CustomerPreference {
  sideAngleDeg: number;
  baseAngleDeg: number;
  note: string;
}

/** 雪板档案 */
export interface BoardProfile {
  id: string;
  brand: string;
  lengthCm: number;
  boardType: BoardType;
  /** 最新边刃厚度（mm），低于板型下限禁止开工 */
  edgeThicknessMm: number;
  waxType: string;
  baseDamage: string;
  customerName: string;
  preference: CustomerPreference;
  /** 客户刃角偏好版本：客户每改一次 +1，刃角方案按此版本绑定 */
  preferenceVersion: number;
  status: BoardStatus;
  /** 乐观锁版本：两台平板同时改同一块板，只接受一边 */
  version: number;
}

export type PlanStatus = "draft" | "confirmed" | "invalidated";

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: "草稿（待客户确认）",
  confirmed: "客户已确认",
  invalidated: "已失效",
};

/** 刃角方案 */
export interface EdgePlan {
  id: string;
  boardId: string;
  sideAngleDeg: number;
  baseAngleDeg: number;
  /** 方案基于的客户偏好版本；客户改偏好即失效 */
  preferenceVersion: number;
  status: PlanStatus;
  createdBy: string;
  createdAt: number;
  confirmedAt: number | null;
  invalidatedAt: number | null;
  invalidateReason: string | null;
  version: number;
}

export type WorkOrderStatus =
  | "pending_confirmation"
  | "released"
  | "in_progress"
  | "done";

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  pending_confirmation: "待确认",
  released: "已放行",
  in_progress: "施工中",
  done: "已完工",
};

/** 刃角工单 */
export interface WorkOrder {
  id: string;
  boardId: string;
  planId: string | null;
  operation: OperationType;
  technicianId: string;
  status: WorkOrderStatus;
  version: number;
  createdAt: number;
}

/** 放行账条目类型 */
export type LedgerKind =
  | "release_allowed"
  | "release_rejected"
  | "preference_changed"
  | "plan_invalidated"
  | "order_returned"
  | "conflict_rejected"
  | "migration_review"
  | "profile_updated"
  | "write_step";

/** 放行账：只增不改的流水 */
export interface LedgerEntry {
  seq: number;
  at: number;
  kind: LedgerKind;
  message: string;
  boardId?: string;
  workOrderId?: string;
  planId?: string;
  technicianId?: string;
  detail?: string[];
}
