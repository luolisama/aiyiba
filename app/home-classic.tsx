import { HomeModeGrid, HomeRuleNote, HomeRulesGrid } from "./home-shared";

export default function ClassicHomeContent() {
  return (
    <div className="home-classic-view">
      <section className="home-hero" aria-labelledby="classic-home-title">
        <p className="home-kicker">猜 ilem 的作品</p>
        <h1 id="classic-home-title">听过很多遍，<br /><span>你真的认得它吗？</span></h1>
        <p>哎一把是以 ilem 音乐作品为题库的中文猜歌网站；从歌手、引擎、投稿日期和播放等级等线索中，一步步找出正确答案。</p>
      </section>

      <section className="home-modes" aria-labelledby="classic-mode-title">
        <div className="home-section-heading">
          <span>选择玩法</span>
          <h2 id="classic-mode-title">这次想怎么猜？</h2>
        </div>
        <HomeModeGrid variant="classic" />
      </section>

      <section className="home-rules" id="classic-rules" aria-labelledby="classic-rules-title">
        <div className="home-section-heading">
          <span>游戏规则</span>
          <h2 id="classic-rules-title">选择适合你的猜法</h2>
          <p>逐项推理、逐层揭晓、排列年代，或者叫上朋友一起竞速。</p>
        </div>
        <HomeRulesGrid />
        <HomeRuleNote />
      </section>

      <footer className="home-footer">
        <div className="footer-meta">
          <span>题库：标准题库与扩展题库</span>
          <span className="credits">
            如果对这个项目有什么意见或者数据有误联系<a href="https://space.bilibili.com/477277447/" target="_blank" rel="noreferrer">叁忆玖</a>。记得支持i12喵，关注<a href="https://space.bilibili.com/372295491" target="_blank" rel="noreferrer">站宝</a>谢谢喵！ · 感谢<a href="https://space.bilibili.com/3493105640671353" target="_blank" rel="noreferrer">元应如是</a>提供了数据支持 · 感谢一个坑提供了域名解析帮助
          </span>
        </div>
      </footer>
    </div>
  );
}
