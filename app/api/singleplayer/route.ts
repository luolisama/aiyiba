const RETIRED_MESSAGE = "由于推送了一个热更新本局已失效请刷新后继续游玩。";

async function retiredResponse() {
  return new Response(JSON.stringify({ error: RETIRED_MESSAGE, code: "singleplayer_api_retired" }), {
    status: 410,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET = retiredResponse;
export const POST = retiredResponse;
