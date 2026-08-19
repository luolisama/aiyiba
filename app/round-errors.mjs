export const ROUND_INVALIDATED_MESSAGE = "由于推送了一个热更新，本局已失效，请刷新后继续游玩。";

export function isRoundInvalidatedError(error) {
  if (!error || typeof error !== "object") return false;
  const candidate = error;
  return candidate.code === "round_expired" || candidate.status === 410;
}
