export type ShareTone = "correct" | "partial" | "wrong";

export type ShareCardRow = {
  label: string;
  title: string;
  detail?: string;
  tones?: ShareTone[];
  fields?: Array<{
    label: string;
    value: string;
    tone: ShareTone;
  }>;
};

export type ShareCardModel = {
  gameLabel: string;
  outcome: string;
  outcomeDetail: string;
  answerName: string;
  answerMeta: string;
  answerDetail: string;
  rows: ShareCardRow[];
  footer: string;
  url: string;
};

const COLORS = {
  paper: "#f7f2e8",
  panel: "#fffdf8",
  ink: "#111a2e",
  muted: "#6f6b64",
  line: "#d9d0c1",
  accent: "#c93b25",
  accentSoft: "#f0c6ba",
  correct: "#347f64",
  partial: "#dda32d",
  wrong: "#606b82",
};

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function truncate(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  const characters = [...text];
  while (characters.length && context.measureText(`${characters.join("")}…`).width > maxWidth) characters.pop();
  return `${characters.join("")}…`;
}

function drawText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number) {
  context.fillText(truncate(context, text, maxWidth), x, y);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器未能生成图片")), "image/png");
  });
}

export async function renderShareCard(model: ShareCardModel) {
  if (document.fonts?.ready) await document.fonts.ready;
  const width = 1080;
  const rows = model.rows.slice(0, 8);
  const historyHeight = rows.length
    ? rows.reduce((total, row) => total + (row.fields?.length ? 174 : 100), 0)
    : 104;
  const height = Math.max(1080, 850 + historyHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持图片生成");

  context.fillStyle = COLORS.paper;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(92, 80, 62, .08)";
  context.lineWidth = 2;
  for (let y = 66; y < height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = COLORS.ink;
  roundedRect(context, 74, 62, 74, 74, 20);
  context.fill();
  context.fillStyle = COLORS.panel;
  context.font = '900 38px "Noto Serif SC", "Microsoft YaHei", serif';
  context.textAlign = "center";
  context.fillText("哎", 111, 112);
  context.textAlign = "left";
  context.fillStyle = COLORS.ink;
  context.font = '900 38px "Noto Serif SC", "Microsoft YaHei", serif';
  context.fillText("哎一把", 171, 110);
  context.fillStyle = COLORS.accent;
  context.font = '800 19px "Microsoft YaHei", sans-serif';
  context.fillText(model.gameLabel, 78, 186);

  context.fillStyle = COLORS.ink;
  context.font = '900 78px "Noto Serif SC", "Songti SC", serif';
  drawText(context, model.outcome, 76, 286, 928);
  context.fillStyle = COLORS.muted;
  context.font = '500 25px "Microsoft YaHei", sans-serif';
  context.fillText(model.outcomeDetail, 80, 334);

  roundedRect(context, 66, 382, 948, 190, 28);
  context.fillStyle = COLORS.panel;
  context.fill();
  context.strokeStyle = COLORS.line;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = COLORS.accent;
  context.font = '800 19px "Microsoft YaHei", sans-serif';
  context.fillText("本局答案", 98, 426);
  context.fillStyle = COLORS.ink;
  context.font = '900 46px "Noto Serif SC", "Microsoft YaHei", serif';
  drawText(context, model.answerName, 98, 486, 850);
  context.fillStyle = COLORS.muted;
  context.font = '500 21px "Microsoft YaHei", sans-serif';
  drawText(context, model.answerMeta, 100, 525, 850);
  context.font = '700 20px "Microsoft YaHei", sans-serif';
  drawText(context, model.answerDetail, 100, 556, 850);

  context.fillStyle = COLORS.ink;
  context.font = '900 30px "Noto Serif SC", "Microsoft YaHei", serif';
  context.fillText("本轮过程", 76, 634);
  let y = 666;
  if (!rows.length) {
    roundedRect(context, 66, y, 948, 88, 18);
    context.fillStyle = COLORS.panel;
    context.fill();
    context.fillStyle = COLORS.muted;
    context.font = '500 22px "Microsoft YaHei", sans-serif';
    context.fillText("本轮没有提交猜测", 96, y + 54);
    y += 104;
  } else {
    for (const row of rows) {
      const detailed = Boolean(row.fields?.length);
      const rowHeight = detailed ? 158 : 84;
      roundedRect(context, 66, y, 948, rowHeight, 18);
      context.fillStyle = "rgba(255, 253, 248, .9)";
      context.fill();
      context.strokeStyle = COLORS.line;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = COLORS.accent;
      context.font = '800 17px "Microsoft YaHei", sans-serif';
      drawText(context, row.label, 94, y + 31, 150);
      context.fillStyle = COLORS.ink;
      context.font = '800 23px "Microsoft YaHei", sans-serif';
      drawText(context, row.title, 244, y + 34, detailed ? 720 : 610);
      if (detailed) {
        (row.fields ?? []).slice(0, 5).forEach((field, index) => {
          const column = index % 3;
          const line = Math.floor(index / 3);
          const x = 92 + column * 302;
          const fieldY = y + 54 + line * 47;
          roundedRect(context, x, fieldY, 286, 37, 9);
          context.fillStyle = `${COLORS[field.tone]}18`;
          context.fill();
          context.fillStyle = COLORS[field.tone];
          roundedRect(context, x, fieldY, 8, 37, 4);
          context.fill();
          context.fillStyle = COLORS.muted;
          context.font = '700 14px "Microsoft YaHei", sans-serif';
          context.fillText(field.label, x + 18, fieldY + 24);
          context.fillStyle = COLORS.ink;
          context.font = '800 16px "Microsoft YaHei", sans-serif';
          drawText(context, field.value || "无", x + 72, fieldY + 24, 200);
        });
      } else {
        context.fillStyle = COLORS.muted;
        context.font = '500 17px "Microsoft YaHei", sans-serif';
        drawText(context, row.detail || "", 244, y + 65, 620);
        const tones = (row.tones ?? []).slice(0, 6);
        tones.forEach((tone, index) => {
          context.fillStyle = COLORS[tone];
          roundedRect(context, 876 + (index % 3) * 34, y + 17 + Math.floor(index / 3) * 28, 22, 22, 6);
          context.fill();
        });
      }
      y += rowHeight + 16;
    }
  }

  const footerY = height - 124;
  context.strokeStyle = COLORS.accentSoft;
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(70, footerY - 30);
  context.lineTo(1010, footerY - 30);
  context.stroke();
  context.fillStyle = COLORS.ink;
  context.font = '800 24px "Microsoft YaHei", sans-serif';
  context.fillText(model.footer, 76, footerY + 18);
  context.fillStyle = COLORS.accent;
  context.font = '700 21px "Microsoft YaHei", sans-serif';
  context.textAlign = "right";
  context.fillText(model.url, 1004, footerY + 18);
  context.textAlign = "left";

  return canvasBlob(canvas);
}

export function shareCardFileName(model: ShareCardModel) {
  const safeName = model.answerName.replace(/[\\/:*?"<>|]/g, "-").slice(0, 36) || "战绩";
  return `哎一把-${safeName}.png`;
}
