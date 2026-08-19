"use client";

export type CatalogPool = "normal" | "hardcore";

type CatalogSelectorProps = {
  pool: CatalogPool;
  itemCount: number;
  locked: boolean;
  busy: boolean;
  onChange: (pool: CatalogPool) => void;
};

const CATALOGS: Record<CatalogPool, { label: string; description: string }> = {
  normal: {
    label: "标准题库",
    description: "聚焦 ilem 主账号音乐投稿",
  },
  hardcore: {
    label: "扩展题库",
    description: "包含 staff 原创与已删除作品",
  },
};

export default function CatalogSelector({ pool, itemCount, locked, busy, onChange }: CatalogSelectorProps) {
  const current = CATALOGS[pool];
  const status = busy ? "正在切换…" : locked ? "🔒 本局已锁定" : "首次行动后锁定";

  return (
    <section className={`catalog-selector ${pool === "hardcore" ? "extended" : "standard"}`} aria-label="本局题库">
      <div className="catalog-selector-copy">
        <span className="catalog-selector-kicker">本局题库</span>
        <div className="catalog-selector-heading">
          <strong>{current.label}</strong>
          <span className="catalog-current-badge">✓ 当前</span>
        </div>
        <span>{itemCount} 首作品 · {current.description}</span>
        <small className={locked ? "locked" : ""} role="status">{status}</small>
      </div>

      <div className="catalog-selector-actions" role="group" aria-label="选择本局题库">
        {(Object.keys(CATALOGS) as CatalogPool[]).map((option) => {
          const selected = option === pool;
          const label = CATALOGS[option].label;
          const ariaLabel = locked
            ? `${label}，本局已锁定`
            : selected
              ? `当前${label}`
              : `切换为${label}`;

          return (
            <button
              key={option}
              type="button"
              className={selected ? "active" : ""}
              aria-pressed={selected}
              aria-label={ariaLabel}
              disabled={locked || busy}
              onClick={() => !selected && onChange(option)}
            >
              <span aria-hidden="true">{selected ? "✓" : ""}</span>
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
