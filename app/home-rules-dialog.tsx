"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const subscribeToHydration = () => () => undefined;

export default function HomeRulesDialog() {
  const [open, setOpen] = useState(false);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const openDialog = useCallback(() => {
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    if (window.location.hash === "#rules-modal") {
      const url = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(window.history.state, "", url || "/");
    }
  }, []);

  useEffect(() => {
    if (window.location.hash !== "#rules-modal") return undefined;
    const frame = window.requestAnimationFrame(() => setOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";

    const focusable = () => dialogRef.current
      ? [...dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute("disabled"))
      : [];
    window.requestAnimationFrame(() => focusable()[0]?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (previousFocus ?? trigger)?.focus();
    };
  }, [closeDialog, open]);

  return (
    <>
      <button ref={triggerRef} className="home-rules-dialog-trigger" type="button" disabled={!hydrated} onClick={openDialog}>
        查看完整收录与判定规则 →
      </button>
      {open && (
        <div
          className="modal-backdrop home-rules-dialog"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && closeDialog()}
        >
          <section
            ref={dialogRef}
            className="modal rules-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-rules-title"
            aria-describedby="home-rules-summary"
          >
            <button className="modal-close" type="button" onClick={closeDialog} aria-label="关闭">×</button>
            <h2 id="home-rules-title">收录与判定规则</h2>
            <p id="home-rules-summary">输入一首 ilem 作品。提交后，各项线索会与答案比较；绿色为一致，黄色为部分重合。</p>
            <div className="rule-samples">
              <span className="correct">完全一致</span>
              <span className="partial">歌手、引擎部分重合，或投稿年份相同</span>
              <span className="wrong">不一致；箭头指向正确答案</span>
            </div>
            <h3>收录与统计口径</h3>
            <ul>
              <li><b>标准题库</b>收录 ilem Bilibili 视频投稿中的音乐作品。</li>
              <li><b>扩展题库</b>在标准题库基础上，补充了ilem/onyk作为staff参与的原创作品和被删除的作品。(不包含翻唱和remix)</li>
              <li>题库可在本局开始前，通过游戏面板顶部的“本局题库”切换；多人模式由房主在房间内选择。</li>
              <li>播放量为定期更新的精确数字快照，不是实时数据。</li>
              <li>纯音乐的演唱与引擎均记为“无”。</li>
              <li>投稿日期年月日完全一致为绿色；年份相同但月日不同为黄色。</li>
            </ul>
            <h3>普通与困难模式</h3>
            <ul className="rules-mode-list">
              <li><b>普通模式</b>显示全部六项线索，共有 6 次机会。</li>
              <li><b>困难模式</b>与普通模式显示相同的全部六项线索，但只有 4 次机会。</li>
              <li>单人模式在首次提交前可以切换题库和模式；多人模式进入房间后由房主选择，开局后锁定。</li>
            </ul>
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
            <p className="fine-print">每轮题袋抽完前不会重复；多人房间会在长时间无活动或服务更新后关闭。</p>
          </section>
        </div>
      )}
    </>
  );
}
