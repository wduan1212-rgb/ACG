/* 语言模型客户端：浏览器直连（内部调试用），设置页可覆盖 endpoint / key / model
   CORS 受阻时可起 proxy.py 并把 Provider 填成 http://localhost:8787/chat */

export const LLM_CONFIG = {
  endpoint: "https://api.deepseek.com/chat/completions",
  model: "deepseek-chat",
  apiKey: ""
};
window.DumateConfig = LLM_CONFIG; // 控制台可调试覆盖

/* 设置页保存的语言类 Key 覆盖默认配置 */
export function applyKeyOverrides(apiKeys) {
  const k = [...(apiKeys || [])].reverse().find(x => x.type === "language" && x.secret);
  if (k) {
    LLM_CONFIG.apiKey = k.secret;
    if (/^https?:\/\//.test(k.provider || "")) LLM_CONFIG.endpoint = k.provider;
    if (k.model) LLM_CONFIG.model = k.model;
  }
}

export async function llm(messages, { json = false, temperature = 0.7, signal } = {}) {
  if (!LLM_CONFIG.apiKey) throw new Error("未配置语言模型 Key");
  const res = await fetch(LLM_CONFIG.endpoint, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + LLM_CONFIG.apiKey },
    body: JSON.stringify({
      model: LLM_CONFIG.model, temperature, messages,
      ...(json ? { response_format: { type: "json_object" } } : {})
    })
  });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 160));
  const d = await res.json();
  return d.choices?.[0]?.message?.content || "";
}
