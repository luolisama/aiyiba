"use client";

type RulesDialogProps = {
  open: boolean;
  onClose: () => void;
  mode: "clues" | "timeline";
};

export default function RulesDialog({ open, onClose, mode }: RulesDialogProps) {
  if (!open) return null;

  const titleId = `${mode}-rules-title`;
  const summaryId = `${mode}-rules-summary`;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={summaryId}>
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">×</button>
        <h2 id={titleId}>收录与判定规则</h2>
        <p id={summaryId}>这里是题库收录口径、线索判定方式和各玩法规则的完整说明。</p>
        <div className="rule-samples">
          <span className="correct">完全一致</span>
          <span className="partial">歌手、引擎部分重合，或投稿年份相同</span>
          <span className="wrong">不一致；箭头指向正确答案</span>
        </div>

        <h3>收录与统计口径</h3>
        <ul>
          <li><b>标准题库</b>收录 ilem Bilibili 视频投稿中的音乐作品。</li>
          <li><b>扩展题库</b>在标准题库基础上，补充了ilem/onyk作为staff参与的原创作品和被删除的作品。(不包含翻唱和remix)</li>
          <li>播放量为定期更新的精确数字快照，不是实时数据。</li>
          <li>纯音乐的演唱与引擎均记为“无”。</li>
          <li>投稿日期年月日完全一致为绿色；年份相同但月日不同为黄色。</li>
          <li>题库可在本局开始前，通过游戏面板顶部的“本局题库”切换；多人模式由房主在房间内选择题库。</li>
        </ul>

        <h3>普通与困难模式</h3>
        <ul className="rules-mode-list">
          <li><b>普通模式</b>显示全部六项线索，共有 6 次机会。</li>
          <li><b>困难模式</b>与普通模式显示相同的全部六项线索，但只有 4 次机会。</li>
          <li>单人模式在第一次提交前可以切换题库和模式；多人经典推理由房主选择，开局后锁定。</li>
        </ul>

        <h3>{mode === "clues" ? "线索阶梯玩法" : "时光机玩法"}</h3>
        {mode === "clues" ? (
          <>
            <p>共有 6 次作答机会。前四次猜错或主动跳过会揭示下一条线索，第五次未命中后不再新增提示。</p>
            <ol className="clue-rule-steps">
              <li><b>引擎</b><span>从制作工具开始缩小范围</span></li>
              <li><b>播放等级</b><span>普通、殿堂、专兑、传说或神话</span></li>
              <li><b>演唱</b><span>揭示使用的歌手或歌姬</span></li>
              <li><b>投稿年份</b><span>只显示年份，不直接暴露完整日期</span></li>
              <li><b>歌名字数</b><span>忽略空格，标点也计入</span></li>
            </ol>
            <p className="fine-print">最多显示 5 条线索；第 6 次仍未猜中则本局结束。</p>
          </>
        ) : (
          <>
            <p>开局先给出一首带日期的作品。之后每轮出现一首隐藏日期的新作品，你需要判断它比时间线中的作品更早还是更晚。</p>
            <ol className="timeline-rule-steps">
              <li><b>观察作品</b><span>本玩法会直接告诉你歌名，不需要搜索输入。</span></li>
              <li><b>选择空位</b><span>点击两首作品之间、最前面或最后面的放置按钮。</span></li>
              <li><b>立即揭晓</b><span>无论放置是否正确，都会显示真实投稿日期并继续下一轮。</span></li>
              <li><b>完成旅程</b><span>一共放置 10 首作品，每次正确得 1 分。</span></li>
            </ol>
            <p className="fine-print">如果作品在同一天投稿，放在同日期作品相邻的任一位置均算正确。</p>
          </>
        )}

        <h3>歌名字数</h3>
        <p className="rules-copy">按网页中的作品名计算，忽略空格；<br className="rules-copy-break" />中文、英文、数字和标点各算一个字符。</p>

        <h3>播放等级</h3>
        <ul>
          <li><b>普通</b>：低于 10 万（扩展题库）</li>
          <li><b>殿堂</b>：10万—50万</li>
          <li><b>专兑</b>：50万—100万</li>
          <li><b>传说</b>：100万—1000万</li>
          <li><b>神话</b>：1000万以上</li>
        </ul>

        <p className="fine-print">每轮题袋抽完前不会重复；进行中的对局会临时保存在服务器，服务更新后可能需要刷新页面重新开始。</p>
        <button className="onboarding-start" type="button" onClick={onClose}>知道了，开始游戏</button>
      </section>
    </div>
  );
}
