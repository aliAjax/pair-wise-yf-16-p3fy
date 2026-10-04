// 雪板调校放行账 —— 领域类型定义

/** 板型 */
export type BoardType = "全地域" | "公园板" | "竞速板" | "粉雪板";

/** 客户刃角偏好（决定方案的侧刃/底刃取值取向） */
export type Preference = "弱咬雪" | "中性" | "强咬雪";

/** 雪板档案状态：正常 / 待复核（旧数据升级后缺方案） */
export type BoardStatus = "正常" | "待复核";

/** 边刃厚度测量记录（每次放行记账时留基线） */
export interface ThicknessRecord {
  at: string;
  /** 边刃厚度 mm */
  thickness: number;
  /** 关联的放行单号（记账后回写，保证幂等） */
  releaseId?: string;
}

/** 雪板档案 */
export interface Board {
  id: string;
  brand: string;
  length: number;
  type: BoardType;
  /** 最新边刃厚度 mm */
  edgeThickness: number;
  baseDamage: string;
  repairPosition: string;
  /** 客户当前刃角偏好 */
  preference: Preference;
  status: BoardStatus;
  /** 是否旧数据（升级前就存在、缺方案） */
  legacy: boolean;
  /** 当前关联方案 id */
  planId?: string;
  /** 乐观锁版本号：两台平板同时修改同一块板，只接受一边 */
  version: number;
  history: ThicknessRecord[];
}

/** 刃角方案状态 */
export type PlanStatus = "待确认" | "已确认" | "已失效";

/** 刃角方案 */
export interface EdgePlan {
  id: string;
  boardId: string;
  /** 侧刃角度 ° */
  sideEdgeAngle: number;
  /** 底刃角度 ° */
  baseEdgeAngle: number;
  /** 方案依据的客户偏好快照 */
  preference: Preference;
  status: PlanStatus;
  confirmedAt?: string;
  invalidatedAt?: string;
  /** 放行时锁定本方案的放行单号 */
  lockedByRelease?: string;
  version: number;
}

/** 工单状态 */
export type WorkOrderStatus = "待确认" | "待开工" | "已放行" | "施工中" | "已完工";

/** 刃角工单 */
export interface WorkOrder {
  id: string;
  boardId: string;
  planId?: string;
  techId?: string;
  status: WorkOrderStatus;
  releaseId?: string;
  version: number;
  createdAt: string;
}

/** 技师角色 */
export type TechRole = "学徒" | "技师" | "高级技师" | "主管";

/** 技师资质 */
export interface Technician {
  id: string;
  name: string;
  role: TechRole;
  active: boolean;
  certs: string[];
}

/** 放行账步骤状态：未开始 / 已记账 / 失败（写库失败，未记账） */
export type StepStatus = "未开始" | "已记账" | "失败";

/** 放行账步骤（每一步写库成功后才记账） */
export interface LedgerStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  recordedAt?: string;
  attempts: number;
}

/** 开工前校验结果（只读判断，不写库） */
export interface CheckResult {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** 放行单状态 */
export type ReleaseStatus = "校验未通过" | "放行成功" | "放行失败待重试";

/** 放行账（一次开工放行的完整凭证） */
export interface ReleaseRecord {
  id: string;
  workOrderId: string;
  boardId: string;
  planId?: string;
  techId?: string;
  status: ReleaseStatus;
  checks: CheckResult[];
  steps: LedgerStep[];
  /** 「首次必失败」模式标记：保证每单只强制失败一次 */
  forcedFailDone: boolean;
  voucherPosted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 操作日志 */
export interface EventLog {
  id: string;
  at: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

/** 写库失败模拟模式 */
export type FailMode = "none" | "random" | "first";

export interface Settings {
  failMode: FailMode;
  /** random 模式下每步写库失败概率 */
  failRate: number;
}

export interface State {
  boards: Board[];
  plans: EdgePlan[];
  workOrders: WorkOrder[];
  technicians: Technician[];
  releases: ReleaseRecord[];
  events: EventLog[];
  settings: Settings;
  /** 是否已执行旧数据升级 */
  migrated: boolean;
}
