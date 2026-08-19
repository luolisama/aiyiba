"use client";

import { useEffect, useRef, useState } from "react";
import { renderShareCard, shareCardFileName, type ShareCardModel } from "./share-card";

type Props = {
  model: ShareCardModel;
  onClose: () => void;
};

export default function ShareImageDialog({ model, onClose }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let active = true;
    void renderShareCard(model).then((nextBlob) => {
      if (!active) return;
      setBlob(nextBlob);
      const reader = new FileReader();
      reader.onload = () => {
        if (active && typeof reader.result === "string") setPreviewUrl(reader.result);
      };
      reader.onerror = () => {
        if (active) setError("图片已生成，但当前浏览器无法显示预览");
      };
      reader.readAsDataURL(nextBlob);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "图片生成失败");
    });
    return () => {
      active = false;
    };
  }, [model]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const fileName = shareCardFileName(model);
  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
  const canShareFile = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }));

  function saveImage() {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
  }

  async function shareImage() {
    if (!file || !canShareFile) return;
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: "哎一把战绩", text: model.footer });
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("系统分享失败，可以改用保存图片");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="modal-backdrop share-image-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="modal share-image-modal" role="dialog" aria-modal="true" aria-labelledby="share-image-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭战绩图片">×</button>
        <div className="share-image-heading"><div><span>本机生成 · 不上传数据</span><h2 id="share-image-title">保存战绩图片</h2></div><p>图片包含本局答案和猜测过程。</p></div>
        <div className="share-image-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {previewUrl ? <img src={previewUrl} alt="生成的哎一把战绩图片预览" /> : error ? <p role="alert">{error}</p> : <div className="share-image-loading" role="status"><i /><span>正在排版战绩…</span></div>}
        </div>
        <div className="share-image-actions">
          {canShareFile && <button className="primary" type="button" disabled={sharing} onClick={() => void shareImage()}>{sharing ? "正在打开分享…" : "分享图片"}</button>}
          <button className={canShareFile ? "" : "primary"} type="button" disabled={!blob} onClick={saveImage}>保存 PNG</button>
        </div>
        <p className="fine-print">手机端可直接调用系统分享；电脑端会将 PNG 保存到下载目录。</p>
      </section>
    </div>
  );
}
