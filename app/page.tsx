import type { Metadata } from "next";

import HomeRulesDialog from "./home-rules-dialog";
import { siteOriginFromEnv, siteUrl } from "./site-origin.mjs";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
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
      <header className="topbar home-topbar">
        <div className="brand" aria-label="哎一把">
          <a
            className="brand-note"
            href="https://space.bilibili.com/3379951"
            target="_blank"
            rel="noreferrer"
            aria-label="访问 ilem B站个人主页"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ilem-avatar.jpg" alt="ilem头像" />
          </a>
          <span>哎一把</span>
        </div>
        <a className="home-rules-link" href="#rules">游戏规则</a>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-kicker">猜 ilem 的作品</p>
        <h1 id="home-title">听过很多遍，<br /><span>你真的认得它吗？</span></h1>
        <p>哎一把是以 ilem 音乐作品为题库的中文猜歌网站；从歌手、引擎、投稿日期和播放等级等线索中，一步步找出正确答案。</p>
      </section>

      <section className="home-modes" aria-labelledby="mode-title">
        <div className="home-section-heading">
          <span>选择玩法</span>
          <h2 id="mode-title">这次想怎么猜？</h2>
        </div>
        <div className="home-mode-grid">
          <a className="home-mode-card solo" href="/solo">
            <div>
              <span className="home-mode-label">一个人随时开局</span>
              <h3>经典推理</h3>
              <p>比较演唱、引擎、日期等六项信息，用颜色与箭头逐步锁定作品。</p>
            </div>
            <strong>开始猜歌 <span aria-hidden="true">→</span></strong>
          </a>
          <a className="home-mode-card multi" href="/multi">
            <div>
              <span className="home-mode-label">叫上朋友一起玩</span>
              <h3>多人模式</h3>
              <p>支持 2–8 人同房竞技，由房主选择题库与难度，第一位猜中者获胜。</p>
            </div>
            <strong>进入大厅 <span aria-hidden="true">→</span></strong>
          </a>
          <a className="home-mode-card clues" href="/clues">
            <div>
              <span className="home-mode-label">线索逐层揭晓</span>
              <h3>线索阶梯</h3>
              <p>从引擎开始，前四次猜错或跳过会逐步揭示线索，最后一次不再追加提示。</p>
            </div>
            <strong>挑战阶梯 <span aria-hidden="true">→</span></strong>
          </a>
          <a className="home-mode-card timeline" href="/timeline">
            <div>
              <span className="home-mode-label">沿着投稿日期旅行</span>
              <h3>时光机</h3>
              <p>连续排列十首作品，把隐藏日期的作品插入正确时间线，放置后立即揭晓真实日期。</p>
            </div>
            <strong>启动时光机 <span aria-hidden="true">→</span></strong>
          </a>
        </div>
      </section>

      <section className="home-rules" id="rules" aria-labelledby="rules-title">
        <div className="home-section-heading">
          <span>游戏规则</span>
          <h2 id="rules-title">选择适合你的猜法</h2>
          <p>逐项推理、逐层揭晓、排列年代，或者叫上朋友一起竞速。</p>
        </div>
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
        <div className="home-rule-note">
          <p><strong>普通模式</strong>有 6 次机会。</p>
          <p><strong>困难模式</strong>有 4 次机会。</p>
          <HomeRulesDialog />
        </div>
      </section>

      <footer className="home-footer">
        <div className="footer-meta">
          <span>题库：标准题库与扩展题库</span>
          <span className="credits">
            如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！ · 感谢<a href="https://space.bilibili.com/3493105640671353" target="_blank" rel="noreferrer">元应如是</a>提供了数据支持 · 感谢一个坑提供了域名解析帮助
          </span>
        </div>
      </footer>
    </main>
  );
}
