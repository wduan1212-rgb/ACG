/* 意图路由：正则快通道（离线可用） + LLM 路由（带上下文，多轮可懂） */

import { llm } from "../api/llm.js";
import { parseJSONLoose } from "../core/util.js";
import { TAG_POOL } from "../domain/accounts.js";

export const INTENTS = ["plan_batch", "create_accounts", "run_generation", "approve_all", "deliver_all", "retry_failed", "status_query", "chat"];

/* 离线兜底：从指令里抠 主题/标签/范围/风格（自 v4 移植增强） */
export function parseGoalFallback(goal) {
  const tags = TAG_POOL.filter(t => goal.includes(t) || goal.includes(t.slice(0, 2)));
  const group = goal.includes("图文") ? "图文组"
    : (goal.includes("真人") || goal.includes("数字人")) ? "真人"
    : (goal.includes("素材") || goal.includes("无数字人")) ? "素材" : "all";
  const styleM = goal.match(/[，,。]\s*(偏[^，,。]+|风格[^，,。]+)/);
  let topic = goal.replace(/给.*?账号|所有|的账号|做一期|来一期|，?偏[^，,。]*风?$/g, "").replace(/[「」"']/g, "").trim();
  const tm = goal.match(/[「"]([^」"]+)[」"]/);
  if (tm) topic = tm[1];
  return { topic: topic.slice(0, 30) || goal.slice(0, 20), tags, group, style: styleM ? styleM[1] : "" };
}

/* 快通道正则：明确动作不必走模型 */
function fastRoute(text) {
  if (/(建|创建|新增).{0,8}(账号|号)/.test(text)) return { intent: "create_accounts", params: {} };
  if (/(开始|继续)?(全部|批量)?生成/.test(text) && !/账号|脚本|方案/.test(text)) return { intent: "run_generation", params: {} };
  if (/(全部|都|所有).{0,6}(通过|过审)/.test(text)) return { intent: "approve_all", params: {} };
  if (/(全部|都|所有).{0,6}(交付|定稿|入库)/.test(text) || /(交付|定稿).{0,4}(全部|所有)/.test(text)) return { intent: "deliver_all", params: {} };
  if (/重试|再试/.test(text) && /失败|错误/.test(text)) return { intent: "retry_failed", params: {} };
  if (/^(状态|进度|怎么样了|到哪了|情况)[?？。!！]*$/.test(text.trim()) || /(现在|当前|批次).{0,6}(状态|进度|情况)/.test(text)) return { intent: "status_query", params: {} };
  return null;
}

export async function routeIntent(text, contextSummary = "") {
  const fast = fastRoute(text);
  if (fast) return fast;
  try {
    const r = await llm([
      { role: "system", content: `你是内容生产工作台的指令路由器。把用户输入归类为一个 intent 并提取参数，只输出 JSON。
可选 intent：
- plan_batch：发起一批内容量产（提到主题/选号/做一期/量产/批量创作等）。params: {"topic":"创作主题","tags":[仅限:${TAG_POOL.join("/")}],"group":"图文组|真人|素材|all","style":"风格策略，可空","count":数字或null}
- create_accounts：创建/新增账号。params:{}
- run_generation：开始/继续生成已就绪的任务。params:{}
- approve_all：批量通过审核。params:{}
- deliver_all：批量交付/定稿入库。params:{}
- retry_failed：重试失败任务。params:{}
- status_query：询问进度/状态。params:{}
- chat：闲聊、提问、与以上都不符。params:{}
输出格式：{"intent":"...","params":{...}}
当前工作台上下文（供判断指代）：${contextSummary || "无进行中的批次"}` },
      { role: "user", content: text }
    ], { json: true, temperature: 0.1 });
    const d = parseJSONLoose(r);
    if (!INTENTS.includes(d.intent)) throw new Error("未知意图");
    if (d.intent === "plan_batch") {
      d.params = d.params || {};
      d.params.tags = (d.params.tags || []).filter(t => TAG_POOL.includes(t));
      if (!d.params.topic) d.params = { ...parseGoalFallback(text), ...d.params, topic: parseGoalFallback(text).topic };
    }
    return d;
  } catch (e) {
    // 离线：看起来像量产目标就按 plan_batch，否则当 chat
    if (text.length >= 6 && /做|出|来|生成|写|期|条|批/.test(text)) {
      return { intent: "plan_batch", params: parseGoalFallback(text), offline: true };
    }
    return { intent: "chat", params: {}, offline: true };
  }
}
