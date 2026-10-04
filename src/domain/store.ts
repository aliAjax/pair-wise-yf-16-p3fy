import { ConflictError, NotFoundError, RuleError } from "./errors";
import { evaluateRelease, type ReleaseDecision } from "./release";
import type {
  BoardProfile,
  BoardStatus,
  BoardType,
  CustomerPreference,
  EdgePlan,
  LedgerEntry,
  LedgerKind,
  OperationType,
  Technician,
  TechRole,
  WorkOrder,
} from "./types";

export interface NewBoardInput {
  brand: string;
  lengthCm: number;
  boardType: BoardType;
  edgeThicknessMm: number;
  waxType: string;
  baseDamage: string;
  customerName: string;
  preference: CustomerPreference;
  status?: BoardStatus;
}

interface LedgerRef {
  boardId?: string;
  workOrderId?: string;
  planId?: string;
  technicianId?: string;
  detail?: string[];
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new NotFoundError(`${label}不存在`);
  return value;
}

/**
 * 调校店放行账核心：雪板档案、刃角工单、刃角方案、技师资质四本账
 * 合在一起，所有状态变化都记进只增不改的放行账。
 */
export class TuningStore {
  private boards = new Map<string, BoardProfile>();
  private plans = new Map<string, EdgePlan>();
  private workOrders = new Map<string, WorkOrder>();
  private technicians = new Map<string, Technician>();
  readonly ledger: LedgerEntry[] = [];
  private ledgerSeq = 0;
  private idSeq = 0;

  private nextId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}-${String(this.idSeq).padStart(3, "0")}`;
  }

  private append(kind: LedgerKind, message: string, ref: LedgerRef = {}): void {
    this.ledgerSeq += 1;
    this.ledger.push({ seq: this.ledgerSeq, at: Date.now(), kind, message, ...ref });
  }

  /** 供写库管线把"步骤已记账"也写进放行账 */
  recordWriteStep(message: string): void {
    this.append("write_step", message);
  }

  // ---------- 查询 ----------

  listBoards(): BoardProfile[] {
    return [...this.boards.values()];
  }

  getBoard(id: string): BoardProfile {
    return must(this.boards.get(id), `雪板档案 ${id}`);
  }

  getPlan(id: string): EdgePlan {
    return must(this.plans.get(id), `刃角方案 ${id}`);
  }

  getWorkOrder(id: string): WorkOrder {
    return must(this.workOrders.get(id), `工单 ${id}`);
  }

  listWorkOrders(): WorkOrder[] {
    return [...this.workOrders.values()];
  }

  listTechnicians(): Technician[] {
    return [...this.technicians.values()];
  }

  plansOf(boardId: string): EdgePlan[] {
    return [...this.plans.values()].filter((p) => p.boardId === boardId);
  }

  workOrdersOf(boardId: string): WorkOrder[] {
    return [...this.workOrders.values()].filter((w) => w.boardId === boardId);
  }

  // ---------- 乐观锁：两台平板同时改，只接受一边 ----------

  private assertVersion(
    entityLabel: string,
    entity: { id: string; version: number },
    expectedVersion: number
  ): void {
    if (entity.version !== expectedVersion) {
      this.append(
        "conflict_rejected",
        `${entityLabel} ${entity.id} 版本冲突：对方基于 v${expectedVersion} 修改，当前已是 v${entity.version}，本次修改被拒绝`,
        { boardId: entity.id }
      );
      throw new ConflictError(
        `${entityLabel} ${entity.id} 已被另一台设备修改（当前 v${entity.version}），请刷新后重试`
      );
    }
  }

  // ---------- 档案与资质 ----------

  addTechnician(name: string, role: TechRole): Technician {
    const tech: Technician = { id: this.nextId("T"), name, role };
    this.technicians.set(tech.id, tech);
    return tech;
  }

  addBoard(input: NewBoardInput): BoardProfile {
    const board: BoardProfile = {
      id: this.nextId("B"),
      ...input,
      status: input.status ?? "active",
      preferenceVersion: 1,
      version: 1,
    };
    this.boards.set(board.id, board);
    return board;
  }

  /** 技师测量后录入最新边刃厚度 */
  updateEdgeThickness(boardId: string, mm: number, expectedVersion: number): void {
    const board = this.getBoard(boardId);
    this.assertVersion("雪板档案", board, expectedVersion);
    const old = board.edgeThicknessMm;
    board.edgeThicknessMm = mm;
    board.version += 1;
    this.append(
      "profile_updated",
      `${boardId} 边刃厚度复测 ${old}mm → ${mm}mm`,
      { boardId }
    );
  }

  /** 待复核档案复核通过 */
  markReviewed(boardId: string, expectedVersion: number): void {
    const board = this.getBoard(boardId);
    this.assertVersion("雪板档案", board, expectedVersion);
    if (board.status !== "pending_review") return;
    board.status = "active";
    board.version += 1;
    this.append("profile_updated", `${boardId} 复核通过，档案恢复正常`, { boardId });
  }

  // ---------- 客户改刃角偏好：方案立刻失效，工单退回待确认 ----------

  updatePreference(
    boardId: string,
    preference: CustomerPreference,
    expectedVersion: number
  ): { invalidatedPlanIds: string[]; returnedOrderIds: string[] } {
    const board = this.getBoard(boardId);
    this.assertVersion("雪板档案", board, expectedVersion);

    board.preference = preference;
    board.preferenceVersion += 1;
    board.version += 1;
    this.append(
      "preference_changed",
      `${board.customerName} 改动刃角偏好为 侧刃${preference.sideAngleDeg}°/底刃${preference.baseAngleDeg}°，偏好升至 v${board.preferenceVersion}`,
      { boardId }
    );

    const invalidatedPlanIds: string[] = [];
    for (const plan of this.plans.values()) {
      if (plan.boardId === boardId && plan.status !== "invalidated") {
        plan.status = "invalidated";
        plan.invalidatedAt = Date.now();
        plan.invalidateReason = "客户改动刃角偏好";
        plan.version += 1;
        invalidatedPlanIds.push(plan.id);
        this.append(
          "plan_invalidated",
          `方案 ${plan.id} 失效：基于偏好 v${plan.preferenceVersion}，客户已到 v${board.preferenceVersion}`,
          { boardId, planId: plan.id }
        );
      }
    }

    const returnedOrderIds: string[] = [];
    for (const order of this.workOrders.values()) {
      if (
        order.boardId === boardId &&
        (order.status === "pending_confirmation" ||
          order.status === "released" ||
          order.status === "in_progress")
      ) {
        order.status = "pending_confirmation";
        order.version += 1;
        returnedOrderIds.push(order.id);
        this.append(
          "order_returned",
          `工单 ${order.id} 退回待确认：方案失效，需客户重新确认后再放行`,
          { boardId, workOrderId: order.id }
        );
      }
    }

    return { invalidatedPlanIds, returnedOrderIds };
  }

  // ---------- 刃角方案 ----------

  /** 按客户当前偏好出方案（草稿），方案绑定当前偏好版本 */
  createPlan(
    boardId: string,
    angles: { sideAngleDeg: number; baseAngleDeg: number },
    technicianId: string
  ): EdgePlan {
    const board = this.getBoard(boardId);
    must(this.technicians.get(technicianId), `技师 ${technicianId}`);
    const plan: EdgePlan = {
      id: this.nextId("PLAN"),
      boardId,
      sideAngleDeg: angles.sideAngleDeg,
      baseAngleDeg: angles.baseAngleDeg,
      preferenceVersion: board.preferenceVersion,
      status: "draft",
      createdBy: technicianId,
      createdAt: Date.now(),
      confirmedAt: null,
      invalidatedAt: null,
      invalidateReason: null,
      version: 1,
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  /** 客户确认方案；方案基于的偏好已过时则拒绝确认 */
  confirmPlan(planId: string, expectedVersion: number): void {
    const plan = this.getPlan(planId);
    this.assertVersion("刃角方案", plan, expectedVersion);
    if (plan.status !== "draft") {
      throw new RuleError(`方案 ${planId} 当前状态不允许确认`);
    }
    const board = this.getBoard(plan.boardId);
    if (plan.preferenceVersion !== board.preferenceVersion) {
      throw new RuleError(
        `方案基于偏好 v${plan.preferenceVersion}，客户已到 v${board.preferenceVersion}，需重新出方案`
      );
    }
    plan.status = "confirmed";
    plan.confirmedAt = Date.now();
    plan.version += 1;
  }

  // ---------- 刃角工单与开工放行 ----------

  createWorkOrder(
    boardId: string,
    planId: string | null,
    operation: OperationType,
    technicianId: string
  ): WorkOrder {
    this.getBoard(boardId);
    must(this.technicians.get(technicianId), `技师 ${technicianId}`);
    if (planId !== null) {
      const plan = this.getPlan(planId);
      if (plan.boardId !== boardId) {
        throw new RuleError(`方案 ${planId} 不属于雪板 ${boardId}`);
      }
    }
    const order: WorkOrder = {
      id: this.nextId("WO"),
      boardId,
      planId,
      operation,
      technicianId,
      status: "pending_confirmation",
      version: 1,
      createdAt: Date.now(),
    };
    this.workOrders.set(order.id, order);
    return order;
  }

  /**
   * 开工放行检查：按客户确认的方案、最新边刃厚度、技师角色权限判断，
   * 满足才放行并记账；不满足记拒绝账，工单留在待确认。
   */
  releaseWorkOrder(workOrderId: string, expectedVersion: number): ReleaseDecision {
    const order = this.getWorkOrder(workOrderId);
    this.assertVersion("工单", order, expectedVersion);
    if (order.status !== "pending_confirmation") {
      throw new RuleError(`工单 ${workOrderId} 当前状态为 ${order.status}，不能放行`);
    }
    const board = this.getBoard(order.boardId);
    const plan = order.planId === null ? null : this.getPlan(order.planId);
    const technician = must(
      this.technicians.get(order.technicianId),
      `技师 ${order.technicianId}`
    );

    const decision = evaluateRelease({ board, plan, workOrder: order, technician });
    if (decision.allowed) {
      order.status = "released";
      order.version += 1;
      this.append(
        "release_allowed",
        `工单 ${order.id} 放行：方案 ${plan?.id ?? "-"}（偏好 v${plan?.preferenceVersion}）、边刃 ${board.edgeThicknessMm}mm、${technician.name} 权限核验通过`,
        { boardId: board.id, workOrderId: order.id, planId: plan?.id, technicianId: technician.id }
      );
    } else {
      this.append(
        "release_rejected",
        `工单 ${order.id} 不放行：${decision.reasons.join("；")}`,
        {
          boardId: board.id,
          workOrderId: order.id,
          planId: plan?.id,
          technicianId: technician.id,
          detail: decision.reasons,
        }
      );
    }
    return decision;
  }

  startWork(workOrderId: string, expectedVersion: number): void {
    const order = this.getWorkOrder(workOrderId);
    this.assertVersion("工单", order, expectedVersion);
    if (order.status !== "released") {
      throw new RuleError(`工单 ${workOrderId} 未放行，不能开工`);
    }
    order.status = "in_progress";
    order.version += 1;
  }

  completeWork(workOrderId: string, expectedVersion: number): void {
    const order = this.getWorkOrder(workOrderId);
    this.assertVersion("工单", order, expectedVersion);
    if (order.status !== "in_progress") {
      throw new RuleError(`工单 ${workOrderId} 未在施工中，不能完工`);
    }
    order.status = "done";
    order.version += 1;
  }

  // ---------- 旧数据升级 ----------

  /** 直接落一条档案（迁移专用），返回新建档案 */
  importBoard(input: NewBoardInput & { preferenceVersion?: number }): BoardProfile {
    const board: BoardProfile = {
      id: this.nextId("B"),
      ...input,
      status: input.status ?? "active",
      preferenceVersion: input.preferenceVersion ?? 1,
      version: 1,
    };
    this.boards.set(board.id, board);
    return board;
  }

  markPendingReview(boardId: string, reason: string): void {
    const board = this.getBoard(boardId);
    board.status = "pending_review";
    board.version += 1;
    this.append("migration_review", `${boardId} 标为待复核：${reason}`, { boardId });
  }
}
