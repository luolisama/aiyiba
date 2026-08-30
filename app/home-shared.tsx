import HomeRulesDialog from "./home-rules-dialog";

const HOME_MODES = [
  {
    key: "solo",
    href: "/solo",
    label: "一个人随时开局",
    title: "经典推理",
    description: "比较演唱、引擎、日期等六项信息，用颜色与箭头逐步锁定作品。",
    action: "开始猜歌",
    icon: "▦",
  },
  {
    key: "multi",
    href: "/multi",
    label: "叫上朋友一起玩",
    title: "多人模式",
    description: "支持 2–8 人同房竞技，由房主选择题库与玩法；经典推理竞速，线索阶梯支持同层并列获胜。",
    action: "进入大厅",
    icon: "⚔",
  },
  {
    key: "clues",
    href: "/clues",
    label: "线索逐层揭晓",
    title: "线索阶梯",
    description: "从引擎开始，前四次猜错或跳过会逐步揭示线索，最后一次不再追加提示。",
    action: "挑战阶梯",
    icon: "▤",
  },
  {
    key: "timeline",
    href: "/timeline",
    label: "沿着投稿日期旅行",
    title: "时光机",
    description: "连续排列十首作品，把隐藏日期的作品插入正确时间线，放置后立即揭晓真实日期。",
    action: "启动时光机",
    icon: "↔",
  },
] as const;

type HomeModeGridProps = {
  variant: "classic" | "cyber";
};

export function HomeModeGrid({ variant }: HomeModeGridProps) {
  return (
    <div className="home-mode-grid">
      {HOME_MODES.map((mode, index) => (
        <a className={`home-mode-card ${mode.key}`} href={mode.href} key={mode.key}>
          {variant === "cyber" && <>
            <span className="home-mode-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="home-mode-icon" aria-hidden="true">{mode.icon}</span>
          </>}
          <div>
            <span className="home-mode-label">{mode.label}</span>
            <h3>{mode.title}</h3>
            <p>{mode.description}</p>
          </div>
          <strong>{mode.action} <span aria-hidden="true">→</span></strong>
        </a>
      ))}
    </div>
  );
}

export function HomeRulesGrid() {
  return (
    <div className="home-rule-grid">
      <article>
        <span>1</span>
        <h3>输入作品</h3>
        <p>支持歌名和拼音搜索，从候选项中选择作品后提交。</p>
      </article>
      <article>
        <span>2</span>
        <h3>查看颜色</h3>
        <p><b className="rule-dot correct" />绿色表示完全一致，<b className="rule-dot partial" />黄色表示部分重合。</p>
      </article>
      <article>
        <span>3</span>
        <h3>跟随箭头</h3>
        <p>日期、歌名字数和播放等级不一致时，箭头会指向正确方向。</p>
      </article>
      <article>
        <span>4</span>
        <h3>选择题库</h3>
        <p>标准题库聚焦主账号投稿；扩展题库补充了ilem/onyk作为staff参与的原创作品和被删除的作品（不包含翻唱和remix）。</p>
      </article>
    </div>
  );
}

export function HomeRuleNote() {
  return (
    <div className="home-rule-note">
      <p><strong>普通模式</strong>有 6 次机会。</p>
      <p><strong>困难模式</strong>有 4 次机会。</p>
      <HomeRulesDialog />
    </div>
  );
}
