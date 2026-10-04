import type { ReactNode } from "react";
import type {
  BoardStatus,
  PlanStatus,
  Preference,
  ReleaseStatus,
  StepStatus,
  WorkOrderStatus,
} from "./types";

// ---------- 徽章 ----------

const toneClass: Record<string, string> = {
  green: "badge badge-green",
  red: "badge badge-red",
  amber: "badge badge-amber",
  blue: "badge badge-blue",
  gray: "badge badge-gray",
  teal: "badge badge-teal",
};

export function Badge({ tone, children }: { tone: keyof typeof toneClass | string; children: ReactNode }) {
  return <span className={toneClass[tone] ?? toneClass.gray}>{children}</span>;
}

export function boardStatusTone(s: BoardStatus): string {
  return s === "待复核" ? "amber" : "green";
}
export function planStatusTone(s: PlanStatus): string {
  if (s === "已确认") return "green";
  if (s === "已失效") return "red";
  return "amber";
}
export function orderStatusTone(s: WorkOrderStatus): string {
  switch (s) {
    case "已放行":
      return "blue";
    case "施工中":
      return "teal";
    case "已完工":
      return "green";
    case "待确认":
      return "amber";
    default:
      return "gray";
  }
}
export function releaseStatusTone(s: ReleaseStatus): string {
  if (s === "放行成功") return "green";
  if (s === "校验未通过") return "red";
  return "amber";
}
export function stepStatusTone(s: StepStatus): string {
  if (s === "已记账") return "green";
  if (s === "失败") return "red";
  return "gray";
}

// ---------- 按钮 ----------

type BtnVariant = "primary" | "ghost" | "danger" | "success" | "warn";

export function Btn({
  children,
  onClick,
  variant = "ghost",
  disabled,
  size = "md",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
}) {
  const cls =
    variant === "primary"
      ? "btn btn-primary"
      : variant === "danger"
        ? "btn btn-danger"
        : variant === "success"
          ? "btn btn-success"
          : variant === "warn"
            ? "btn btn-warn"
            : "btn btn-ghost";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${cls} ${size === "sm" ? "btn-sm" : ""}`}
    >
      {children}
    </button>
  );
}

// ---------- 面板骨架 ----------

export function Panel({
  title,
  subtitle,
  extra,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel-sub">{subtitle}</p> : null}
        </div>
        {extra ? <div className="panel-extra">{extra}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ---------- 偏好选择 ----------

export function PreferenceSelect({
  value,
  onChange,
  disabled,
}: {
  value: Preference;
  onChange: (v: Preference) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Preference)}
    >
      <option value="弱咬雪">弱咬雪</option>
      <option value="中性">中性</option>
      <option value="强咬雪">强咬雪</option>
    </select>
  );
}
