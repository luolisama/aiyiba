import type { Metadata } from "next";

import { HomeTopBar } from "./cyber-nav";
import ClassicHomeContent from "./home-classic";
import { HomeModeGrid, HomeRuleNote, HomeRulesGrid } from "./home-shared";
import searchSongsJson from "./data/search-songs.json";
import hardcoreSearchSongsJson from "./data/hardcore-search-songs.json";
import songsJson from "./data/songs.json";
import { compareSong } from "./game-logic.mjs";
import { siteOriginFromEnv, siteUrl } from "./site-origin.mjs";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function demoSong(name: string) {
  const song = songsJson.items.find((item) => item.name === name);
  if (!song) throw new Error(`Missing homepage demo song: ${name}`);
  return song;
}

function demoTone(tone: string) {
  if (tone === "correct") return "hit";
  if (tone === "partial") return "near";
  return "miss";
}

const demoAnswer = demoSong("离乡");
const demoRows = [demoSong("达拉崩吧"), demoSong("葬歌")].map((song) => {
  const cells = compareSong(song, demoAnswer);
  const displayCells = cells.map((cell, index) => {
    const direction = cell.hint?.startsWith("↑") ? " ↑" : cell.hint?.startsWith("↓") ? " ↓" : "";
    const text = index === 4 ? cell.text.slice(0, 4) : cell.text;
    return { text: `${text}${direction}`, tone: demoTone(cell.tone) };
  });
  return {
    name: song.name,
    cells: displayCells,
  };
});

const demoLabels = ["作品", "演唱", "引擎", "字数", "日期", "播放"];

export default function HomePage() {
  const standardCount = searchSongsJson.itemCount;
  const extendedCount = hardcoreSearchSongsJson.itemCount;
  const websiteStructuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "哎一把",
    url: siteUrl(siteOriginFromEnv(process.env.SITE_ORIGIN), "/"),
  };

  return (
    <main className="home-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData).replaceAll("<", "\\u003c") }}
      />
      <HomeTopBar />
      <div className="home-cyber-view">

      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero-copy">
          <p className="home-kicker"><span>ONLINE</span> ILEM 作品猜歌 · 随时开局</p>
          <h1 id="home-title">哎一把</h1>
          <p className="home-hero-english">GUESS THE ILEM SONG</p>
          <p className="home-hero-intro">从演唱、引擎、投稿日期和播放等级等线索中，一步步锁定 ilem 的作品。一个人推理，或者叫上朋友竞速。</p>
          <div className="home-hero-actions">
            <a className="pixel-cta primary" href="/solo">开始猜歌 <span aria-hidden="true">→</span></a>
            <a className="pixel-cta secondary" href="/multi">多人模式</a>
          </div>
        </div>
        <div className="home-demo-board" aria-label="经典推理判定示意">
          <div className="demo-board-top"><span>TODAY · NO.127</span><strong>GUESS LOG</strong><i>{6 - demoRows.length} / 6</i></div>
          <div className="demo-board-head">{demoLabels.map((label) => <span key={label}>{label}</span>)}</div>
          {demoRows.map((row, rowIndex) => (
            <div className={`demo-board-row${rowIndex ? " demo-row-secondary" : ""}`} key={row.name}>
              {row.cells.map((cell, index) => index === 0
                ? <strong className={cell.tone} key={demoLabels[index]}>{cell.text}</strong>
                : <span className={cell.tone} key={demoLabels[index]}>{cell.text}</span>)}
            </div>
          ))}
          <div className="demo-board-row current"><strong>下一次猜测</strong>{demoLabels.slice(1).map((label) => <span key={label}>?</span>)}</div>
          <div className="demo-board-status"><span>● SYSTEM READY</span><strong>第三猜由你决定</strong></div>
        </div>
      </section>

      <div className="home-marquee" aria-hidden="true"><div>DALABENGBABA · GOUZHIQISHI · JIECAOBAOZALE · PUTONGDISCO · DALABENGBABA · GOUZHIQISHI · JIECAOBAOZALE · PUTONGDISCO ·</div></div>

      <section className="home-modes" id="modes" aria-labelledby="mode-title">
        <div className="home-section-heading">
          <span>SELECT MODE / 选择玩法</span>
          <h2 id="mode-title">这次想怎么猜？</h2>
        </div>
        <HomeModeGrid variant="cyber" />
      </section>

      <section className="home-rules" id="rules" aria-labelledby="rules-title">
        <div className="home-section-heading">
          <span>HOW TO PLAY / 游戏规则</span>
          <h2 id="rules-title">四步进入状态</h2>
          <p>选作品、看反馈、跟箭头，再用下一次猜测验证你的推理。</p>
        </div>
        <HomeRulesGrid />
        <HomeRuleNote />
      </section>

      <section className="home-library" id="library" aria-labelledby="library-title">
        <div>
          <span className="pixel-kicker">SONG DATABASE</span>
          <h2 id="library-title">两套题库，同一套推理语言</h2>
          <p>标准题库聚焦 ilem 主账号音乐投稿；扩展题库补充 staff 原创与已删除作品。搜索、拼音、别名与判定规则完全共用。</p>
          <div className="library-counts"><strong>{standardCount}<small>标准题库</small></strong><i>+</i><strong>{extendedCount - standardCount}<small>扩展新增</small></strong></div>
        </div>
        <div className="library-character-art">
          <span aria-hidden="true">CHARACTER SIGNAL · 66CCFF</span>
          {/* Vinext's next/image shim currently duplicates React in development; keep this static local asset native. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/luo-tianyi-cyber.webp"
            alt="参考洛天依 ACE AI 星空投影人设创作的原创像素插画"
            width={1024}
            height={1536}
            loading="lazy"
            decoding="async"
          />
          <b aria-hidden="true">AIYIBA DATABASE</b>
        </div>
      </section>

      <footer className="home-footer">
        <div className="footer-meta">
          <span>题库：标准题库与扩展题库</span>
          <span className="credits">
            如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！ · 感谢<a href="https://space.bilibili.com/3493105640671353" target="_blank" rel="noreferrer">元应如是</a>提供了数据支持 · 感谢一个坑提供了域名解析帮助
          </span>
        </div>
        <div className="footer-wordmark" aria-hidden="true">AIYIBA</div>
      </footer>
      </div>
      <ClassicHomeContent />
    </main>
  );
}
