import { useState } from "react";
import type { Session } from "../types";
import { useI18n } from "../i18n";
import { PageHeading, SessionCard } from "../components/ui";
export function HistoryPage({
  sessions,
  open,
}: {
  sessions: Session[];
  open: (s: Session) => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<"all" | "sports" | "vehicle">("all");
  const visible = sessions.filter(
    (s) =>
      filter === "all" ||
      (filter === "vehicle" ? s.type === "vehicle" : s.type !== "vehicle"),
  );
  return (
    <>
      <PageHeading eyebrow={t("local")} title={t("history")}>
        <p>
          {sessions.length} {t("sessions").toLowerCase()}
        </p>
      </PageHeading>
      <div className="filter-tabs">
        {(["all", "sports", "vehicle"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={filter === f ? "selected" : ""}
          >
            {t(f === "all" ? "filterAll" : f)}
          </button>
        ))}
      </div>
      <div className="history-list">
        {visible.map((s) => (
          <SessionCard key={s.id} session={s} onClick={() => open(s)} />
        ))}
        {!visible.length && <p className="notice">{t("empty")}</p>}
      </div>
    </>
  );
}
