import type {
  Board,
  BoardType,
  EdgePlan,
  Preference,
  State,
  Technician,
  TechRole,
  WorkOrder,
} from "./types";

/** 边刃厚度安全限值 mm：低于此值禁止磨削（边刃磨薄风险） */
export const MIN_EDGE_THICKNESS = 0.8;

export const PREFERENCES: Preference[] = ["弱咬雪", "中性", "强咬雪"];
export const BOARD_TYPES: BoardType[] = ["全地域", "公园板", "竞速板", "粉雪板"];

/**
 * 技师角色权限：
 * - 学徒：无刃角作业资质，不得独立磨削刃角（只能打蜡）
 * - 技师：可做侧刃 87°–89°
 * - 高级技师：可做侧刃 85°–89°，可确认方案
 * - 主管：全部刃角资质，可确认方案
 */
export const ROLE_PERMS: Record<
  TechRole,
  { edgeAngle: boolean; confirmPlan: boolean; minSideAngle: number; desc: string }
> = {
  学徒: { edgeAngle: false, confirmPlan: false, minSideAngle: 0, desc: "仅可打蜡，禁止独立磨削刃角" },
  技师: { edgeAngle: true, confirmPlan: false, minSideAngle: 87, desc: "可做侧刃 87°–89°" },
  高级技师: { edgeAngle: true, confirmPlan: true, minSideAngle: 85, desc: "可做侧刃 85°–89°，可确认方案" },
  主管: { edgeAngle: true, confirmPlan: true, minSideAngle: 0, desc: "全部刃角资质，可确认方案" },
};

export const nowIso = () => new Date().toISOString();

export function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

let seq = 0;
export function nextId(prefix: string, existing: string[]): string {
  seq += 1;
  let id = `${prefix}-${1000 + seq}`;
  while (existing.includes(id)) {
    seq += 1;
    id = `${prefix}-${1000 + seq}`;
  }
  return id;
}

/** 初始演示数据 */
export function seed(): State {
  const boards: Board[] = [
    {
      id: "BD-001",
      brand: "Burton",
      length: 156,
      type: "全地域",
      edgeThickness: 1.0,
      baseDamage: "无明显损伤",
      repairPosition: "—",
      preference: "弱咬雪",
      status: "正常",
      legacy: false,
      planId: "FA-1001",
      version: 1,
      history: [],
    },
    {
      id: "BD-002",
      brand: "Fischer",
      length: 165,
      type: "竞速板",
      edgeThickness: 0.6,
      baseDamage: "板尾划痕 3cm",
      repairPosition: "板尾",
      preference: "强咬雪",
      status: "正常",
      legacy: false,
      planId: "FA-1002",
      version: 1,
      history: [],
    },
    {
      id: "BD-003",
      brand: "K2",
      length: 158,
      type: "粉雪板",
      edgeThickness: 0.9,
      baseDamage: "底板划痕 12cm",
      repairPosition: "板腰",
      preference: "中性",
      status: "正常",
      legacy: false,
      planId: "FA-1003",
      version: 1,
      history: [],
    },
    {
      id: "BD-004",
      brand: "Rossignol",
      length: 160,
      type: "全地域",
      edgeThickness: 0.85,
      baseDamage: "—",
      repairPosition: "—",
      preference: "中性",
      status: "正常",
      legacy: true,
      version: 1,
      history: [],
    },
    {
      id: "BD-005",
      brand: "Salomon",
      length: 153,
      type: "公园板",
      edgeThickness: 0.9,
      baseDamage: "—",
      repairPosition: "—",
      preference: "弱咬雪",
      status: "正常",
      legacy: true,
      version: 1,
      history: [],
    },
    {
      id: "BD-006",
      brand: "Atomic",
      length: 163,
      type: "竞速板",
      edgeThickness: 1.1,
      baseDamage: "—",
      repairPosition: "—",
      preference: "中性",
      status: "正常",
      legacy: false,
      planId: "FA-1004",
      version: 1,
      history: [],
    },
  ];

  const plans: EdgePlan[] = [
    {
      id: "FA-1001",
      boardId: "BD-001",
      sideEdgeAngle: 88,
      baseEdgeAngle: 1,
      preference: "弱咬雪",
      status: "已确认",
      confirmedAt: "2026-10-01T09:00:00Z",
      version: 1,
    },
    {
      id: "FA-1002",
      boardId: "BD-002",
      sideEdgeAngle: 86,
      baseEdgeAngle: 1.5,
      preference: "强咬雪",
      status: "已确认",
      confirmedAt: "2026-10-02T09:00:00Z",
      version: 1,
    },
    {
      id: "FA-1003",
      boardId: "BD-003",
      sideEdgeAngle: 89,
      baseEdgeAngle: 0.5,
      preference: "中性",
      status: "待确认",
      version: 1,
    },
    {
      id: "FA-1004",
      boardId: "BD-006",
      sideEdgeAngle: 88,
      baseEdgeAngle: 1,
      preference: "中性",
      status: "已确认",
      confirmedAt: "2026-10-03T09:00:00Z",
      version: 1,
    },
  ];

  const workOrders: WorkOrder[] = [
    {
      id: "ORD-106",
      boardId: "BD-001",
      planId: "FA-1001",
      techId: "T-03",
      status: "待开工",
      version: 1,
      createdAt: "2026-10-03T10:00:00Z",
    },
    {
      id: "ORD-112",
      boardId: "BD-002",
      planId: "FA-1002",
      techId: "T-04",
      status: "待开工",
      version: 1,
      createdAt: "2026-10-03T11:00:00Z",
    },
    {
      id: "ORD-118",
      boardId: "BD-003",
      planId: "FA-1003",
      techId: "T-02",
      status: "待确认",
      version: 1,
      createdAt: "2026-10-03T12:00:00Z",
    },
    {
      id: "ORD-119",
      boardId: "BD-006",
      planId: "FA-1004",
      techId: "T-04",
      status: "待开工",
      version: 1,
      createdAt: "2026-10-03T13:00:00Z",
    },
    {
      id: "ORD-120",
      boardId: "BD-005",
      techId: "T-03",
      status: "待开工",
      version: 1,
      createdAt: "2026-10-03T14:00:00Z",
    },
    {
      id: "ORD-100",
      boardId: "BD-001",
      planId: "FA-1001",
      techId: "T-02",
      status: "已完工",
      version: 1,
      createdAt: "2026-09-28T10:00:00Z",
    },
  ];

  const technicians: Technician[] = [
    { id: "T-01", name: "张师傅", role: "主管", active: true, certs: ["高级技师证", "刃角标定授权"] },
    { id: "T-02", name: "李师傅", role: "高级技师", active: true, certs: ["高级技师证"] },
    { id: "T-03", name: "王师傅", role: "技师", active: true, certs: ["技师证"] },
    { id: "T-04", name: "小赵", role: "学徒", active: true, certs: ["打蜡上岗证"] },
  ];

  return {
    boards,
    plans,
    workOrders,
    technicians,
    releases: [],
    events: [
      {
        id: "EV-0001",
        at: nowIso(),
        level: "info",
        message: "系统就绪：放行账已连接雪板档案、刃角方案、工单与技师资质。",
      },
    ],
    settings: { failMode: "first", failRate: 0.3 },
    migrated: false,
  };
}
