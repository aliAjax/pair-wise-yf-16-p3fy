import { useReducer, useRef, useState } from "react";
import "./styles.css";
import { seedStore, LEGACY_RECORDS } from "./domain/seed";
import { migrateLegacyBoards } from "./domain/migration";
import { MIN_EDGE_THICKNESS_MM, ROLE_PERMISSIONS, type ReleaseDecision } from "./domain/release";
import {
  buildSnapshotSteps,
  LocalStorageAdapter,
  runWritePipeline,
  StepLedger,
  type PipelineResult,
  type WriteStep,
} from "./domain/pipeline";
import type {
  BoardProfile,
  LedgerKind,
  OperationType,
  WorkOrderStatus,
} from "./domain/types";
import {
  OPERATION_LABELS,
  PLAN_STATUS_LABELS,
  ROLE_LABELS,
  WORK_ORDER_STATUS_LABELS,
} from "./domain/types";

const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  release_allowed: "放行",
  release_rejected: "拒放",
  preference_changed: "改偏好",
  plan_invalidated: "方案失效",
  order_returned: "工单退回",
  conflict_rejected: "冲突拒写",
  migration_review: "待复核",
  profile_updated: "档案更新",
  write_step: "写库记账",
};

const ORDER_FILTERS: Array<"all" | WorkOrderStatus> = [
  "all",
  "pending_confirmation",
  "released",
  "in_progress",
  "done",
];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function App() {
  const [{ store, refs }] = useState(() => seedStore());
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const [selectedBoardId, setSelectedBoardId] = useState(refs.boardIds[0]);
  const [boardFilter, setBoardFilter] = useState<"all" | "pending_review" | "thin">("all");
  const [orderFilter, setOrderFilter] = useState<"all" | WorkOrderStatus>("all");
  const [notice, setNotice] = useState("");
  const [releaseResult, setReleaseResult] = useState<{
    orderId: string;
    decision: ReleaseDecision;
  } | null>(null);

  // 新建工单表单
  const [newOp, setNewOp] = useState<OperationType>("edge_grind");
  const [newTechId, setNewTechId] = useState(refs.technicianId);
  const [newPlanChoice, setNewPlanChoice] = useState<string>("auto");
  const [thicknessText, setThicknessText] = useState("1.8");

  // 写库管线
  const stepLedgerRef = useRef(new StepLedger());
  const adapterRef = useRef(new LocalStorageAdapter());
  const batchSeqRef = useRef(0);
  const [batch, setBatch] = useState<{ id: string; steps: WriteStep[] } | null>(null);
  const [failMode, setFailMode] = useState(true);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);

  const board = store.getBoard(selectedBoardId);
  const boards = store.listBoards().filter((b) => {
    if (boardFilter === "pending_review") return b.status === "pending_review";
    if (boardFilter === "thin") return b.edgeThicknessMm < MIN_EDGE_THICKNESS_MM[b.boardType];
    return true;
  });
  const orders = store
    .listWorkOrders()
    .filter((o) => orderFilter === "all" || o.status === orderFilter);
  const boardPlans = store.plansOf(board.id);
  const confirmedPlans = boardPlans.filter((p) => p.status === "confirmed");

  const metrics = {
    pending: store.listWorkOrders().filter((o) => o.status === "pending_confirmation").length,
    released: store.listWorkOrders().filter((o) => o.status === "released").length,
    review: store.listBoards().filter((b) => b.status === "pending_review").length,
    ledger: store.ledger.length,
  };

  function act(fn: () => string | void) {
    try {
      const msg = fn();
      if (msg) setNotice(msg);
    } catch (e) {
      setNotice(errMsg(e));
    }
    bump();
  }

  // ---------- 事件 ----------

  const handleRelease = (orderId: string) =>
    act(() => {
      const order = store.getWorkOrder(orderId);
      const decision = store.releaseWorkOrder(order.id, order.version);
      setReleaseResult({ orderId, decision });
      return decision.allowed ? `工单 ${orderId} 已放行` : `工单 ${orderId} 不放行，原因已记放行账`;
    });

  const handleChangePreference = () =>
    act(() => {
      const next = {
        sideAngleDeg: board.preference.sideAngleDeg >= 90 ? 87 : board.preference.sideAngleDeg + 1,
        baseAngleDeg: board.preference.baseAngleDeg,
        note: "客户临时改口",
      };
      const { invalidatedPlanIds, returnedOrderIds } = store.updatePreference(
        board.id,
        next,
        board.version
      );
      setReleaseResult(null);
      return `客户偏好已改（v${board.preferenceVersion}）：${invalidatedPlanIds.length} 个方案失效，${returnedOrderIds.length} 张工单退回待确认`;
    });

  const handleNewPlan = () =>
    act(() => {
      const plan = store.createPlan(
        board.id,
        {
          sideAngleDeg: board.preference.sideAngleDeg,
          baseAngleDeg: board.preference.baseAngleDeg,
        },
        refs.technicianId
      );
      return `已按当前偏好 v${board.preferenceVersion} 出方案 ${plan.id}，待客户确认`;
    });

  const handleConfirmPlan = (planId: string) =>
    act(() => {
      const plan = store.getPlan(planId);
      store.confirmPlan(plan.id, plan.version);
      return `方案 ${planId} 已经客户确认`;
    });

  const handleCreateOrder = () =>
    act(() => {
      const planId =
        newPlanChoice === "auto"
          ? confirmedPlans[confirmedPlans.length - 1]?.id ?? null
          : newPlanChoice === "none"
            ? null
            : newPlanChoice;
      const order = store.createWorkOrder(board.id, planId, newOp, newTechId);
      return `工单 ${order.id} 已建（待确认），放行前要先过开工检查`;
    });

  const handleMeasureThickness = () =>
    act(() => {
      const mm = Number(thicknessText);
      if (!Number.isFinite(mm) || mm <= 0) return "厚度数值无效";
      store.updateEdgeThickness(board.id, mm, board.version);
      return `${board.id} 最新边刃厚度已记为 ${mm}mm`;
    });

  const handleSimulateTablets = () =>
    act(() => {
      // 两台平板同时读到同一版本
      const tabletA = board.version;
      const tabletB = board.version;
      store.updatePreference(
        board.id,
        { ...board.preference, note: "平板A：客户现场确认" },
        tabletA
      );
      try {
        store.updateEdgeThickness(board.id, board.edgeThicknessMm - 0.1, tabletB);
        return "模拟异常：两台平板的修改都被接受了？";
      } catch (e) {
        return `平板A 的修改已接受；平板B 被拒：${errMsg(e)}`;
      }
    });

  const handleMigrate = () =>
    act(() => {
      const summary = migrateLegacyBoards(store, LEGACY_RECORDS);
      return `旧数据升级完成：导入 ${summary.imported.length} 块板，${summary.pendingReview.length} 块缺方案已标待复核（${summary.pendingReview.join("、") || "无"}）`;
    });

  const handleMarkReviewed = (boardId: string) =>
    act(() => {
      const b = store.getBoard(boardId);
      store.markReviewed(b.id, b.version);
      return `${boardId} 复核通过`;
    });

  const handleMakeBatch = () =>
    act(() => {
      batchSeqRef.current += 1;
      const id = `B${String(batchSeqRef.current).padStart(3, "0")}`;
      const steps = buildSnapshotSteps(
        id,
        {
          boards: store.listBoards(),
          plans: boardPlans,
          workOrders: store.listWorkOrders(),
          ledger: store.ledger,
        },
        adapterRef.current
      );
      setBatch({ id, steps });
      setPipelineResult(null);
      return `写库批次 ${id} 已生成，共 ${steps.length} 步`;
    });

  const handleRunPipeline = (simulateFailure: boolean) => {
    if (!batch) return;
    adapterRef.current.failOnKeys = simulateFailure
      ? new Set([batch.steps[1].key])
      : new Set();
    void runWritePipeline(batch.steps, stepLedgerRef.current).then((res) => {
      setPipelineResult(res);
      res.completed.forEach((key) => store.recordWriteStep(`写库步骤已记账：${key}`));
      setNotice(
        res.failedKey
          ? `写库在 ${res.failedKey} 失败：已记账 ${res.completed.length} 步，重试只会补跑未记账步骤`
          : `批次 ${batch.id} 全部落库（本次实跑 ${res.completed.length} 步，跳过已记账 ${res.skipped.length} 步）`
      );
      bump();
    });
  };

  // ---------- 渲染 ----------

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62004 · 滑雪板调校维护 · 放行账</p>
        <h1>开工先过放行账</h1>
        <span>
          雪板档案、刃角工单、刃角方案、技师资质四本账合一：开工前按客户确认的方案、最新边刃厚度和技师角色权限判断，
          不满足不放行；客户改刃角偏好，方案立刻失效、工单退回待确认；两台平板同时改同一块板只接受一边；
          旧数据升级缺方案的标待复核；写库失败只重试尚未记账的步骤。
        </span>
      </section>

      <section className="metrics">
        <article><small>待确认工单</small><strong>{metrics.pending}</strong></article>
        <article><small>已放行工单</small><strong>{metrics.released}</strong></article>
        <article><small>待复核雪板</small><strong>{metrics.review}</strong></article>
        <article><small>放行账条目</small><strong>{metrics.ledger}</strong></article>
      </section>

      {notice && (
        <section className="notice" onClick={() => setNotice("")}>
          {notice}
          <em>（点击关闭）</em>
        </section>
      )}

      <section className="workspace">
        <aside className="panel">
          <h2>雪板档案</h2>
          <div className="chips">
            <button className={boardFilter === "all" ? "on" : ""} onClick={() => setBoardFilter("all")}>全部</button>
            <button className={boardFilter === "pending_review" ? "on" : ""} onClick={() => setBoardFilter("pending_review")}>待复核</button>
            <button className={boardFilter === "thin" ? "on" : ""} onClick={() => setBoardFilter("thin")}>刃厚不足</button>
          </div>
          <div className="board-list">
            {boards.map((b) => (
              <button
                key={b.id}
                className={`board-item ${b.id === selectedBoardId ? "on" : ""}`}
                onClick={() => setSelectedBoardId(b.id)}
              >
                <b>{b.id}</b>
                <span>
                  {b.brand} {b.lengthCm}cm · {b.boardType}
                </span>
                <small>
                  刃厚 {b.edgeThicknessMm}mm · 偏好 v{b.preferenceVersion} · 档案 v{b.version}
                  {b.status === "pending_review" && <i className="tag warn">待复核</i>}
                  {b.edgeThicknessMm < MIN_EDGE_THICKNESS_MM[b.boardType] && (
                    <i className="tag bad">刃薄</i>
                  )}
                </small>
              </button>
            ))}
          </div>
          <button className="primary wide" onClick={handleMigrate}>导入旧数据（升级）</button>
        </aside>

        <section className="panel">
          <div className="heading">
            <div>
              <p>{board.id} · {board.customerName}</p>
              <h2>{board.brand} {board.lengthCm}cm</h2>
            </div>
            {board.status === "pending_review" ? (
              <button className="primary" onClick={() => handleMarkReviewed(board.id)}>复核通过</button>
            ) : (
              <span className="tag ok">档案正常</span>
            )}
          </div>

          <div className="fact-grid">
            <div><small>板型</small><b>{board.boardType}</b></div>
            <div>
              <small>最新边刃厚度（下限 {MIN_EDGE_THICKNESS_MM[board.boardType]}mm）</small>
              <b className={board.edgeThicknessMm < MIN_EDGE_THICKNESS_MM[board.boardType] ? "bad-text" : ""}>
                {board.edgeThicknessMm}mm
              </b>
            </div>
            <div><small>客户偏好</small><b>侧刃{board.preference.sideAngleDeg}° / 底刃{board.preference.baseAngleDeg}°（v{board.preferenceVersion}）</b></div>
            <div><small>打蜡 / 底板</small><b>{board.waxType} · {board.baseDamage}</b></div>
          </div>

          <div className="actions">
            <button onClick={handleChangePreference}>客户改刃角偏好</button>
            <button onClick={handleSimulateTablets}>模拟双平板同时改这块板</button>
            <span className="inline-form">
              <input
                value={thicknessText}
                onChange={(e) => setThicknessText(e.target.value)}
                aria-label="复测边刃厚度"
              />
              <button onClick={handleMeasureThickness}>录入复测厚度</button>
            </span>
          </div>

          <h3>刃角方案</h3>
          <table className="table">
            <thead>
              <tr><th>方案</th><th>刃角</th><th>基于偏好</th><th>状态</th><th></th></tr>
            </thead>
            <tbody>
              {boardPlans.length === 0 && (
                <tr><td colSpan={5} className="empty">暂无方案——口头定角不算数，先出方案</td></tr>
              )}
              {boardPlans.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>侧刃{p.sideAngleDeg}° / 底刃{p.baseAngleDeg}°</td>
                  <td>v{p.preferenceVersion}{p.preferenceVersion !== board.preferenceVersion && "（已过时）"}</td>
                  <td><i className={`tag plan-${p.status}`}>{PLAN_STATUS_LABELS[p.status]}</i></td>
                  <td>
                    {p.status === "draft" && (
                      <button onClick={() => handleConfirmPlan(p.id)}>客户确认</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="primary" onClick={handleNewPlan}>按当前偏好出新方案</button>
        </section>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>技师资质</h2>
          <div className="tech-list">
            {store.listTechnicians().map((t) => {
              const perm = ROLE_PERMISSIONS[t.role];
              return (
                <article key={t.id}>
                  <b>{t.name} · {ROLE_LABELS[t.role]}</b>
                  <small>
                    工序：{perm.operations.map((o) => OPERATION_LABELS[o]).join("、")}
                    <br />
                    板型：{perm.boardTypes === "all" ? "不限" : perm.boardTypes.join("、")}
                  </small>
                </article>
              );
            })}
          </div>
        </aside>

        <section className="panel">
          <div className="heading">
            <div>
              <p>写库管线</p>
              <h2>失败只重试未记账步骤</h2>
            </div>
            <label className="switch">
              <input type="checkbox" checked={failMode} onChange={(e) => setFailMode(e.target.checked)} />
              模拟第 2 步写库失败
            </label>
          </div>
          <div className="actions">
            <button onClick={handleMakeBatch}>生成写库批次</button>
            <button className="primary" disabled={!batch} onClick={() => handleRunPipeline(failMode)}>
              执行写库
            </button>
            <button disabled={!batch || !pipelineResult?.failedKey} onClick={() => handleRunPipeline(false)}>
              重试（只补未记账步骤）
            </button>
          </div>
          {batch && (
            <ul className="steps">
              {batch.steps.map((s) => (
                <li key={s.key} className={stepLedgerRef.current.has(s.key) ? "done" : pipelineResult?.failedKey === s.key ? "failed" : ""}>
                  <b>{stepLedgerRef.current.has(s.key) ? "已记账" : pipelineResult?.failedKey === s.key ? "失败" : "未记账"}</b>
                  {s.label}
                </li>
              ))}
            </ul>
          )}
          {pipelineResult && (
            <p className="hint">
              本次实跑 {pipelineResult.completed.length} 步（{pipelineResult.completed.join("、") || "无"}），
              跳过已记账 {pipelineResult.skipped.length} 步
              {pipelineResult.failedKey && `，失败于 ${pipelineResult.failedKey}`}
            </p>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>刃角工单</p>
            <h2>开工放行</h2>
          </div>
          <div className="chips">
            {ORDER_FILTERS.map((f) => (
              <button key={f} className={orderFilter === f ? "on" : ""} onClick={() => setOrderFilter(f)}>
                {f === "all" ? "全部" : WORK_ORDER_STATUS_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="actions new-order">
          <span>给 {board.id} 派单：</span>
          <select value={newOp} onChange={(e) => setNewOp(e.target.value as OperationType)}>
            {Object.entries(OPERATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={newTechId} onChange={(e) => setNewTechId(e.target.value)}>
            {store.listTechnicians().map((t) => (
              <option key={t.id} value={t.id}>{t.name}（{ROLE_LABELS[t.role]}）</option>
            ))}
          </select>
          <select value={newPlanChoice} onChange={(e) => setNewPlanChoice(e.target.value)}>
            <option value="auto">最近已确认方案</option>
            <option value="none">不关联方案</option>
            {boardPlans.filter((p) => p.status !== "invalidated").map((p) => (
              <option key={p.id} value={p.id}>{p.id}（{PLAN_STATUS_LABELS[p.status]}）</option>
            ))}
          </select>
          <button className="primary" onClick={handleCreateOrder}>建工单</button>
        </div>

        <table className="table">
          <thead>
            <tr><th>工单</th><th>雪板</th><th>工序</th><th>技师</th><th>方案</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const tech = store.listTechnicians().find((t) => t.id === o.technicianId);
              return (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>{o.boardId}</td>
                  <td>{OPERATION_LABELS[o.operation]}</td>
                  <td>{tech ? `${tech.name}（${ROLE_LABELS[tech.role]}）` : o.technicianId}</td>
                  <td>{o.planId ?? "未关联"}</td>
                  <td><i className={`tag st-${o.status}`}>{WORK_ORDER_STATUS_LABELS[o.status]}</i></td>
                  <td className="row-actions">
                    {o.status === "pending_confirmation" && (
                      <button className="primary" onClick={() => handleRelease(o.id)}>开工放行检查</button>
                    )}
                    {o.status === "released" && (
                      <button onClick={() => act(() => { store.startWork(o.id, o.version); })}>开工</button>
                    )}
                    {o.status === "in_progress" && (
                      <button onClick={() => act(() => { store.completeWork(o.id, o.version); })}>完工</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {releaseResult && (
          <div className={`decision ${releaseResult.decision.allowed ? "ok" : "bad"}`}>
            <b>{releaseResult.orderId} 放行检查：{releaseResult.decision.allowed ? "放行" : "不放行"}</b>
            <ul>
              <li className={releaseResult.decision.checks.planConfirmed && releaseResult.decision.checks.planCurrent ? "pass" : "fail"}>
                客户确认的方案{releaseResult.decision.checks.planConfirmed && releaseResult.decision.checks.planCurrent ? " ✓" : " ✗"}
              </li>
              <li className={releaseResult.decision.checks.thicknessOk ? "pass" : "fail"}>
                最新边刃厚度{releaseResult.decision.checks.thicknessOk ? " ✓" : " ✗"}
              </li>
              <li className={releaseResult.decision.checks.roleAllowed ? "pass" : "fail"}>
                技师角色权限{releaseResult.decision.checks.roleAllowed ? " ✓" : " ✗"}
              </li>
              <li className={releaseResult.decision.checks.boardReviewed ? "pass" : "fail"}>
                档案非待复核{releaseResult.decision.checks.boardReviewed ? " ✓" : " ✗"}
              </li>
            </ul>
            {releaseResult.decision.reasons.length > 0 && (
              <p>{releaseResult.decision.reasons.join("；")}</p>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>只增不改</p>
            <h2>放行账</h2>
          </div>
        </div>
        <div className="ledger">
          {[...store.ledger].reverse().map((e) => (
            <article key={e.seq} className={`k-${e.kind}`}>
              <b>#{e.seq} {LEDGER_KIND_LABELS[e.kind]}</b>
              <p>{e.message}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
