import { useState } from "react";
import {
  BOARD_TYPES,
  MIN_EDGE_THICKNESS,
  PREFERENCES,
  ROLE_PERMS,
  fmtTime,
} from "./domain";
import {
  changePreference,
  concurrentEditDemo,
  confirmPlan,
  migrateLegacy,
  resetAll,
  retryRelease,
  runRelease,
  updateSettings,
  updateThickness,
} from "./store";
import type { Board, EdgePlan, FailMode, ReleaseRecord, TechRole, WorkOrder } from "./types";
import {
  Badge,
  Btn,
  Empty,
  Panel,
  PreferenceSelect,
  boardStatusTone,
  orderStatusTone,
  planStatusTone,
  releaseStatusTone,
  stepStatusTone,
} from "./ui";

// ============================================================
// 概览
// ============================================================

export function OverviewPanel({
  counts,
  onOpenRelease,
}: {
  counts: {
    boards: number;
    pendingReview: number;
    orders: number;
    pendingOrders: number;
    activeTechs: number;
    releases: number;
    failedReleases: number;
  };
  onOpenRelease: (id: string) => void;
}) {
  const metrics = [
    { label: "雪板档案", value: counts.boards, hint: `待复核 ${counts.pendingReview}` },
    { label: "刃角工单", value: counts.orders, hint: `待确认/待开工 ${counts.pendingOrders}` },
    { label: "在岗技师", value: counts.activeTechs, hint: "含学徒/技师/高级/主管" },
    { label: "放行单", value: counts.releases, hint: `待重试 ${counts.failedReleases}` },
  ];

  return (
    <Panel
      title="放行工作台"
      subtitle="开工前按客户确认的方案、最新边刃厚度与技师角色权限放行；不满足不放行。"
      extra={
        <Btn variant="danger" size="sm" onClick={resetAll} title="清空本地数据并恢复演示种子">
          重置演示数据
        </Btn>
      }
    >
      <div className="metrics">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <small>{m.label}</small>
            <strong>{m.value}</strong>
            <span className="metric-hint">{m.hint}</span>
          </article>
        ))}
      </div>

      <div className="banner">
        <strong>放行规则</strong>
        <ul>
          <li>方案必须<strong>已客户确认</strong>，且方案偏好与客户当前偏好一致；偏好一改，方案立即失效、工单退回待确认。</li>
          <li>最新边刃厚度低于 {MIN_EDGE_THICKNESS}mm 禁止磨削（边刃磨薄没人拦的问题由系统拦）。</li>
          <li>学徒无刃角作业资质，不得独立开工；技师按角色权限放行。</li>
          <li>两台平板同时修改同一块板，只接受一边（乐观锁）。</li>
        </ul>
      </div>

      {counts.failedReleases > 0 ? (
        <div className="banner banner-warn">
          <strong>有 {counts.failedReleases} 张放行单写库失败待重试</strong>
          <span>请前往「放行账」重试尚未记账的步骤，已记账步骤不会重复执行。</span>
          <Btn size="sm" variant="warn" onClick={() => onOpenRelease("__ledger__")}>
            去放行账处理
          </Btn>
        </div>
      ) : null}
    </Panel>
  );
}

// ============================================================
// 雪板档案
// ============================================================

function BoardCard({ board }: { board: Board }) {
  const [thickness, setThickness] = useState<string>(String(board.edgeThickness));
  const [msg, setMsg] = useState<{ type: "err" | "ok"; text: string } | null>(null);

  const onPref = (v: Board["preference"]) => {
    try {
      changePreference(board.id, v, board.version);
      setMsg({ type: "ok", text: `偏好已变更，方案失效、工单退回待确认（v${board.version + 1}）` });
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    }
  };

  const onThickness = () => {
    const t = parseFloat(thickness);
    if (Number.isNaN(t) || t < 0.3 || t > 2.0) {
      setMsg({ type: "err", text: "厚度需在 0.3–2.0mm 之间" });
      return;
    }
    try {
      updateThickness(board.id, Math.round(t * 100) / 100, board.version);
      setMsg({ type: "ok", text: `边刃厚度已更新（v${board.version + 1}）` });
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message });
    }
  };

  const onConcurrent = async () => {
    setMsg({ type: "ok", text: "并发演示已触发，见操作日志…" });
    await concurrentEditDemo(board.id);
  };

  return (
    <article className="board-card">
      <div className="board-head">
        <div>
          <h3>
            {board.id}
            <Badge tone={boardStatusTone(board.status)}>{board.status}</Badge>
            {board.legacy ? <Badge tone="gray">旧数据</Badge> : null}
          </h3>
          <p className="board-meta">
            {board.brand} · {board.length}cm · {board.type} · v{board.version}
          </p>
        </div>
        <div className="board-thickness">
          <small>最新边刃厚度</small>
          <strong className={board.edgeThickness < MIN_EDGE_THICKNESS ? "text-danger" : ""}>
            {board.edgeThickness}mm
          </strong>
          {board.edgeThickness < MIN_EDGE_THICKNESS ? (
            <Badge tone="red">低于限值 {MIN_EDGE_THICKNESS}mm</Badge>
          ) : (
            <Badge tone="green">可磨削</Badge>
          )}
        </div>
      </div>

      <div className="board-grid">
        <label>
          <span>品牌</span>
          <input value={board.brand} readOnly />
        </label>
        <label>
          <span>长度</span>
          <input value={`${board.length}cm`} readOnly />
        </label>
        <label>
          <span>板型</span>
          <input value={board.type} readOnly />
        </label>
        <label>
          <span>底板损伤</span>
          <input value={board.baseDamage} readOnly />
        </label>
        <label>
          <span>修补位置</span>
          <input value={board.repairPosition} readOnly />
        </label>
        <label>
          <span>当前刃角偏好</span>
          <PreferenceSelect value={board.preference} onChange={onPref} />
        </label>
      </div>

      <div className="board-actions">
        <label className="thickness-input">
          <span>量边刃厚度(mm)</span>
          <input
            type="number"
            step="0.05"
            min="0.3"
            max="2.0"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
          />
        </label>
        <Btn size="sm" onClick={onThickness}>
          更新厚度
        </Btn>
        <Btn size="sm" variant="warn" onClick={onConcurrent} title="模拟两台平板同时修改同一块板，只接受一边">
          模拟两台平板同时改
        </Btn>
      </div>

      {msg ? (
        <p className={msg.type === "err" ? "msg msg-err" : "msg msg-ok"}>{msg.text}</p>
      ) : null}
    </article>
  );
}

export function BoardsPanel({ boards }: { boards: Board[] }) {
  const legacyCount = boards.filter((b) => b.legacy).length;
  return (
    <Panel
      title="雪板档案"
      subtitle="边刃厚度取最新测量值；旧数据升级后缺方案的标为待复核。"
      extra={
        <Btn variant="primary" size="sm" onClick={migrateLegacy}>
          旧数据升级（{legacyCount}）
        </Btn>
      }
    >
      <div className="board-list">
        {boards.map((b) => (
          <BoardCard key={b.id} board={b} />
        ))}
      </div>
    </Panel>
  );
}

// ============================================================
// 刃角方案
// ============================================================

export function PlansPanel({
  plans,
  boards,
}: {
  plans: EdgePlan[];
  boards: Board[];
}) {
  const boardName = (id: string) => {
    const b = boards.find((x) => x.id === id);
    return b ? `${b.brand} ${b.length}cm` : id;
  };
  return (
    <Panel title="刃角方案" subtitle="方案须经客户确认；客户偏好变更后方案立即失效。">
      <div className="table">
        <div className="t-row t-head">
          <span>方案号</span>
          <span>雪板</span>
          <span>侧刃</span>
          <span>底刃</span>
          <span>偏好依据</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {plans.map((p) => (
          <div className="t-row" key={p.id}>
            <span className="mono">FA-{p.id}</span>
            <span>{boardName(p.boardId)}</span>
            <span>{p.sideEdgeAngle}°</span>
            <span>{p.baseEdgeAngle}°</span>
            <span>
              {p.preference}
              {p.invalidatedAt ? <em className="text-danger">（已失效）</em> : null}
            </span>
            <span>
              <Badge tone={planStatusTone(p.status)}>{p.status}</Badge>
            </span>
            <span>
              {p.status === "待确认" ? (
                <Btn size="sm" variant="success" onClick={() => confirmPlan(p.id)}>
                  客户确认
                </Btn>
              ) : p.status === "已失效" ? (
                <Btn size="sm" variant="ghost" disabled>
                  已失效
                </Btn>
              ) : (
                <Btn size="sm" variant="ghost" disabled>
                  已确认
                </Btn>
              )}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ============================================================
// 刃角工单
// ============================================================

export function WorkOrdersPanel({
  orders,
  boards,
  plans,
  techs,
  onOpenRelease,
}: {
  orders: WorkOrder[];
  boards: Board[];
  plans: { id: string; sideEdgeAngle: number; baseEdgeAngle: number; preference: string; status: string }[];
  techs: { id: string; name: string; role: string }[];
  onOpenRelease: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const board = (id: string) => boards.find((b) => b.id === id);
  const plan = (id?: string) => (id ? plans.find((p) => p.id === id) : undefined);
  const tech = (id?: string) => techs.find((t) => t.id === id);

  const onRelease = async (wo: WorkOrder) => {
    if (!wo.techId) return;
    setBusy(wo.id);
    const id = await runRelease(wo.id, wo.techId);
    setBusy(null);
    if (id) onOpenRelease(id);
  };

  return (
    <Panel title="刃角工单" subtitle="开工前放行校验：方案确认 + 边刃厚度 + 技师资质，任一不满足不放行。">
      <div className="wo-list">
        {orders.map((wo) => {
          const b = board(wo.boardId);
          const p = plan(wo.planId);
          const t = tech(wo.techId);
          const canRelease = wo.status === "待开工" || wo.status === "待确认";
          return (
            <article key={wo.id} className="wo-card">
              <div className="wo-main">
                <div className="wo-id">
                  <span className="mono">{wo.id}</span>
                  <Badge tone={orderStatusTone(wo.status)}>{wo.status}</Badge>
                </div>
                <div className="wo-info">
                  <p>
                    <strong>{wo.boardId}</strong> · {b?.brand} {b?.length}cm · {b?.type}
                    {b ? (
                      <>
                        {" "}
                        · 边刃 <strong className={b.edgeThickness < MIN_EDGE_THICKNESS ? "text-danger" : ""}>
                          {b.edgeThickness}mm
                        </strong>
                      </>
                    ) : null}
                  </p>
                  <p className="wo-sub">
                    方案：
                    {p ? (
                      <span>
                        FA-{p.id}（侧刃 {p.sideEdgeAngle}°/底刃 {p.baseEdgeAngle}°，{p.preference}）
                      </span>
                    ) : (
                      <span className="text-danger">缺方案</span>
                    )}
                    {" · "}技师：
                    {t ? (
                      <span>
                        {t.name}（{t.role}）
                      </span>
                    ) : (
                      <span className="text-danger">未指派</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="wo-actions">
                {wo.status === "已放行" ? (
                  <Btn size="sm" onClick={() => onOpenRelease(wo.releaseId ?? "")}>
                    查看放行账
                  </Btn>
                ) : wo.status === "已完工" ? (
                  <Btn size="sm" onClick={() => onOpenRelease(wo.releaseId ?? "")}>
                    查看放行账
                  </Btn>
                ) : (
                  <Btn
                    size="sm"
                    variant="primary"
                    disabled={!canRelease || busy === wo.id || !wo.techId}
                    onClick={() => onRelease(wo)}
                    title={!wo.techId ? "未指派技师" : "开工放行校验"}
                  >
                    {busy === wo.id ? "校验中…" : "开工放行"}
                  </Btn>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

// ============================================================
// 技师资质
// ============================================================

export function TechsPanel({
  techs,
}: {
  techs: { id: string; name: string; role: TechRole; active: boolean; certs: string[] }[];
}) {
  return (
    <Panel title="技师资质" subtitle="角色权限决定能否放行刃角作业；学徒无刃角资质。">
      <div className="tech-grid">
        {techs.map((t) => {
          const perm = ROLE_PERMS[t.role];
          return (
            <article key={t.id} className="tech-card">
              <div className="tech-head">
                <strong>{t.name}</strong>
                <Badge tone={t.role === "学徒" ? "amber" : "blue"}>{t.role}</Badge>
              </div>
              <p className="tech-perm">{perm.desc}</p>
              <div className="tech-certs">
                {t.certs.map((c) => (
                  <Badge key={c} tone="gray">
                    {c}
                  </Badge>
                ))}
              </div>
              <p className="tech-status">
                {t.active ? <Badge tone="green">在岗</Badge> : <Badge tone="red">离岗</Badge>}
              </p>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

// ============================================================
// 放行账
// ============================================================

export function LedgerPanel({
  releases,
  onOpenRelease,
}: {
  releases: ReleaseRecord[];
  onOpenRelease: (id: string) => void;
}) {
  return (
    <Panel title="放行账" subtitle="每一步写库成功才记账；写库失败只重试尚未记账的步骤。">
      {releases.length === 0 ? <Empty>暂无放行单。在「刃角工单」中对工单执行开工放行。</Empty> : null}
      <div className="ledger-list">
        {releases.map((r) => {
          const failedSteps = r.steps.filter((s) => s.status === "失败").length;
          const recordedSteps = r.steps.filter((s) => s.status === "已记账").length;
          return (
            <article key={r.id} className="ledger-card" onClick={() => onOpenRelease(r.id)}>
              <div className="ledger-head">
                <span className="mono">{r.id}</span>
                <Badge tone={releaseStatusTone(r.status)}>{r.status}</Badge>
              </div>
              <p className="ledger-meta">
                工单 {r.workOrderId} · 雪板 {r.boardId} · 方案 {r.planId ? `FA-${r.planId}` : "—"} · 技师{" "}
                {r.techId ?? "—"}
              </p>
              {r.status === "校验未通过" ? (
                <p className="ledger-fail">
                  未通过项：{r.checks.filter((c) => !c.passed).map((c) => c.label).join("、")}
                </p>
              ) : (
                <p className="ledger-meta">
                  记账进度 {recordedSteps}/{r.steps.length}
                  {failedSteps > 0 ? <span className="text-danger"> · {failedSteps} 步失败待重试</span> : null}
                </p>
              )}
              <p className="ledger-time">{fmtTime(r.updatedAt)}</p>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

// ============================================================
// 放行单抽屉（校验 + 步骤记账 + 重试）
// ============================================================

export function ReleaseDrawer({
  release,
  onClose,
}: {
  release: ReleaseRecord | null;
  onClose: () => void;
}) {
  if (!release) return null;
  const passed = release.status !== "校验未通过";
  const recorded = release.steps.filter((s) => s.status === "已记账").length;
  const failed = release.steps.some((s) => s.status === "失败");

  return (
    <div className="drawer-mask" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <p className="drawer-kicker">放行单</p>
            <h3 className="mono">{release.id}</h3>
          </div>
          <div className="drawer-head-right">
            <Badge tone={releaseStatusTone(release.status)}>{release.status}</Badge>
            <Btn size="sm" onClick={onClose}>
              关闭
            </Btn>
          </div>
        </div>

        <div className="drawer-body">
          <section className="drawer-section">
            <h4>开工前校验</h4>
            <ul className="check-list">
              {release.checks.map((c) => (
                <li key={c.key} className={c.passed ? "check-ok" : "check-no"}>
                  <span className="check-icon">{c.passed ? "✓" : "✕"}</span>
                  <div>
                    <strong>{c.label}</strong>
                    <p>{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {passed ? (
            <section className="drawer-section">
              <h4>
                放行账记账步骤
                <span className="ledger-progress">
                  {recorded}/{release.steps.length} 已记账
                </span>
              </h4>
              <ol className="step-list">
                {release.steps.map((s, i) => (
                  <li key={s.key} className={`step-${s.status}`}>
                    <span className="step-num">{i + 1}</span>
                    <div className="step-body">
                      <div className="step-head">
                        <strong>{s.label}</strong>
                        <Badge tone={stepStatusTone(s.status)}>{s.status}</Badge>
                      </div>
                      <p className="step-detail">
                        {s.detail ?? "等待执行"}
                        {s.attempts > 0 ? ` · 尝试 ${s.attempts} 次` : ""}
                        {s.recordedAt ? ` · ${fmtTime(s.recordedAt)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>

              {release.status === "放行失败待重试" || failed ? (
                <div className="retry-bar">
                  <p>写库失败的步骤未记账；重试只执行尚未记账的步骤，已记账步骤不重复执行。</p>
                  <Btn variant="warn" onClick={() => retryRelease(release.id)}>
                    重试未记账步骤
                  </Btn>
                </div>
              ) : null}

              {release.status === "放行成功" ? (
                <div className="banner banner-ok">
                  <strong>✓ 放行成功</strong>
                  <span>工单 {release.workOrderId} 已放行开工，方案已锁定，边刃厚度基线已记账。</span>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="banner banner-stop">
              <strong>⛔ 不放行</strong>
              <span>以上校验未通过，工单不得开工。请补方案、确认方案、更换技师或处理边刃后再放行。</span>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ============================================================
// 操作日志
// ============================================================

export function EventLogPanel({ events }: { events: { id: string; at: string; level: string; message: string }[] }) {
  return (
    <Panel title="操作日志" subtitle="方案失效、并发冲突、写库失败与记账动作实时留痕。">
      <ul className="event-list">
        {events.map((e) => (
          <li key={e.id} className={`event-${e.level}`}>
            <span className="event-time mono">{fmtTime(e.at)}</span>
            <span className="event-msg">{e.message}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ============================================================
// 写库模拟设置
// ============================================================

export function SettingsBar({ settings }: { settings: { failMode: FailMode; failRate: number } }) {
  const modes: { value: FailMode; label: string }[] = [
    { value: "none", label: "不失败" },
    { value: "first", label: "每单首次必失败" },
    { value: "random", label: "随机失败(30%)" },
  ];
  return (
    <div className="settings-bar">
      <span className="settings-label">写库模拟：</span>
      {modes.map((m) => (
        <button
          key={m.value}
          type="button"
          className={settings.failMode === m.value ? "seg seg-on" : "seg"}
          onClick={() => updateSettings({ failMode: m.value })}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
