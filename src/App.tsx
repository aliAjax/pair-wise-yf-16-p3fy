import { useEffect, useMemo, useState } from "react";
import { ROLE_PERMS } from "./domain";
import { useStore } from "./store";
import {
  BoardsPanel,
  EventLogPanel,
  LedgerPanel,
  OverviewPanel,
  PlansPanel,
  ReleaseDrawer,
  SettingsBar,
  TechsPanel,
  WorkOrdersPanel,
} from "./panels";
import type { TechRole } from "./types";

type Tab = "overview" | "boards" | "plans" | "orders" | "techs" | "ledger";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "boards", label: "雪板档案" },
  { key: "plans", label: "刃角方案" },
  { key: "orders", label: "刃角工单" },
  { key: "techs", label: "技师资质" },
  { key: "ledger", label: "放行账" },
];

function Toaster({ events }: { events: { id: string; level: string; message: string }[] }) {
  const [toast, setToast] = useState<{ id: string; level: string; message: string } | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    setToast(latest);
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [events]);

  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.level}`} key={toast.id}>
      {toast.message}
    </div>
  );
}

export default function App() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      boards: s.boards.length,
      pendingReview: s.boards.filter((b) => b.status === "待复核").length,
      orders: s.workOrders.length,
      pendingOrders: s.workOrders.filter((w) => w.status === "待开工" || w.status === "待确认").length,
      activeTechs: s.technicians.filter((t) => t.active).length,
      releases: s.releases.length,
      failedReleases: s.releases.filter((r) => r.status === "放行失败待重试").length,
    }),
    [s]
  );

  const drawerRelease = useMemo(
    () => (drawerId ? s.releases.find((r) => r.id === drawerId) ?? null : null),
    [drawerId, s.releases]
  );

  const openRelease = (id: string) => {
    if (id === "__ledger__") {
      setTab("ledger");
      return;
    }
    if (!id) return;
    setDrawerId(id);
  };

  return (
    <main className="app">
      <header className="hero">
        <div className="hero-top">
          <div>
            <p className="hero-kicker">hxyfront-62004 · 滑雪板调校维护</p>
            <h1>刃角放行账</h1>
            <p className="hero-sub">
              雪板档案 · 刃角方案 · 刃角工单 · 技师资质 四账合一，开工前按规则放行，不满足不放行。
            </p>
          </div>
          <SettingsBar settings={s.settings} />
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={tab === t.key ? "tab tab-on" : "tab"}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === "ledger" && counts.failedReleases > 0 ? (
                <span className="tab-badge">{counts.failedReleases}</span>
              ) : null}
              {t.key === "boards" && counts.pendingReview > 0 ? (
                <span className="tab-badge tab-badge-warn">{counts.pendingReview}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <div className="tab-body">
        {tab === "overview" ? (
          <>
            <OverviewPanel counts={counts} onOpenRelease={openRelease} />
            <EventLogPanel events={s.events} />
          </>
        ) : null}
        {tab === "boards" ? <BoardsPanel boards={s.boards} /> : null}
        {tab === "plans" ? <PlansPanel plans={s.plans} boards={s.boards} /> : null}
        {tab === "orders" ? (
          <WorkOrdersPanel
            orders={s.workOrders}
            boards={s.boards}
            plans={s.plans}
            techs={s.technicians}
            onOpenRelease={openRelease}
          />
        ) : null}
        {tab === "techs" ? (
          <TechsPanel
            techs={s.technicians.map((t) => ({ ...t, role: t.role as TechRole }))}
          />
        ) : null}
        {tab === "ledger" ? (
          <>
            <LedgerPanel releases={s.releases} onOpenRelease={openRelease} />
            <EventLogPanel events={s.events} />
          </>
        ) : null}
      </div>

      <ReleaseDrawer release={drawerRelease} onClose={() => setDrawerId(null)} />
      <Toaster events={s.events} />
    </main>
  );
}
