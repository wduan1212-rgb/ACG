/* AI 生成服务（脚本 / 提示词 / 文案 / 解析）：LLM 优先，失败回退本地模板
   每次调用记录 lastSource: "llm" | "mock"，UI 据此明确标注产物来源 */

import { llm } from "./llm.js";
import { DUMATE_BRIEF, PROMPT_FRAMEWORK, NO_DH_FRAMEWORK, DIR_POOL, TOPIC_POOL, STYLE_POOL } from "./prompts.js";
import { cleanText, sanitizeProduct, parseJSONLoose, delay } from "../core/util.js";
import { TAG_POOL } from "../domain/accounts.js";

export const AI = {
  lastSource: "mock",
  lastError: "",

  _ok(d) { this.lastSource = "llm"; this.lastError = ""; return d; },
  _fb(e) { this.lastSource = "mock"; this.lastError = (e && e.message) || String(e || "网络/CORS"); },

  sourceNote(okMsg) {
    return this.lastSource === "llm" ? okMsg : `API 未通（${this.lastError || "网络/CORS"}），已用本地模板`;
  },

  /* ---------- 脚本生成 ---------- */
  async generateScript({ topic, duration = 30, account, image, direction = "", style = "", imageCount = 6 }) {
    const dirText = direction ? `目标人群方向：${direction}（脚本语气、痛点、例子都贴合这个人群）。` : `人群方向：不限，自由发挥最合适的角度。`;
    const nImg = Math.max(3, Math.min(9, imageCount || 6));
    const sys = image
      ? `你是小红书爆款图文笔记策划，为百度 ACG 市场部写「小红书笔记图卡内容表」，每行是笔记里的一张配图（封面/步骤/结果卡片）。严格按小红书笔记习惯写：标题是口语化痛点钩子+数字干货感（如「3步把乱文件夹收拾干净」「打工人后悔没早用的整理神器」）；封面图文案要让人想点进来；中间每张是一步可复制的干货；结尾一张轻种草收束。语气、人群、用词都要按账号定位细化（账号定位会在用户消息里给出），写给该定位下刷小红书的真实用户看。图文没有口播，只有画面与图上文案。每行 idea 写清这张图要传达的信息；visual 必须非常具体（景别/构图/界面里出现的具体文字/配色/光线/Dumate logo 位置），先在脑内把这张图具象化成真实画面再写，不要用电影感、高级感、种草感这类抽象词。只输出 JSON：{"title":"小红书笔记风标题","shots":[{"idea":"核心思想","visual":"非常具体的画面","line":"图上文案(小红书笔记口吻、精简)"}]}，shots 必须正好 ${nImg} 行（即 ${nImg} 张图，第一张是封面、最后一张是收束）。`
      : (account.subType === "无数字人"
        ? `你是百度 ACG 市场部资深短视频编剧，写 Dumate 产品教程【无数字人】视频：没有固定出镜人物(可偶尔出现人，但以场景/产品界面混剪为主)，line 写专业画外音旁白(不是口播)。视频固定30秒，拆成正好8个镜头(每个约3-4秒)，时间0到30秒连续覆盖。偏教程专业可信、不要信息流硬广。visual 非常具体：景别、机位运镜(固定/缓推/横移/跟随)、产品界面里的具体文字、界面动效(卡片滑入/进度条/局部高亮)、配色、光线，禁止电影感/高级感/种草感等抽象词。画外音只作配音，visual 里不要安排叠加字幕/标题文字。只输出 JSON：{"title":"标题","shots":[{"time":"0-3s","idea":"核心思想","visual":"非常具体的画面分镜","line":"专业画外音旁白"}]}，正好8个镜头。`
        : `你是百度 ACG 市场部资深短视频编剧，写 Dumate 产品教程【数字人口播】视频。视频固定30秒，必须拆成正好8个镜头(每个约3-4秒)，时间从0秒连续覆盖到30秒。结构上：开头第1个镜头一定是数字人正面出镜口播开场，结尾最后一个镜头一定是数字人出镜做一句话口播收束，无论什么人群方向都保持这个数字人开场+收束的结构。内容丰富、偏教程专业可信(不要信息流硬广)：每个镜头 idea(核心思想)/visual(画面分镜)/line(口播原话)都写充实，口播口语化、有真实办公痛点、能直接念。visual 非常具体：景别、人物动作表情、界面具体文字、运镜、界面动效、配色、光线，禁止电影感/高级感/种草感等抽象词。口播只作配音，visual 里不要安排叠加字幕/标题文字。只输出 JSON：{"title":"标题","shots":[{"time":"0-3s","idea":"核心思想","visual":"非常具体的画面分镜","line":"口播原话"}]}，正好8个镜头。`);
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + sys },
        { role: "user", content: `账号定位：${account.position}\n语气：${account.tone || "教程感"}\n平台：${account.platform}\n内容模式：${account.mode}\n${dirText}\n${image ? `共生成 ${nImg} 张图。\n` : ""}${image && style ? `图文总风格：${style}（所有画面统一这个视觉风格）。\n` : ""}主题：${topic}\n${image ? "" : `目标时长：${duration}秒。`}围绕百度搭子 Dumate 的真实功能延展教学。` }
      ], { json: true });
      const d = parseJSONLoose(content);
      if (!d.shots || !d.shots.length) throw new Error("模型未返回 shots");
      const cleanShots = d.shots.map(x => ({ ...x, idea: cleanText(x.idea), visual: cleanText(x.visual), line: cleanText(x.line) }));
      return this._ok({ title: cleanText(d.title) || topic, shots: cleanShots });
    } catch (e) {
      this._fb(e);
      return this._mockScript({ topic, account, image, imageCount: nImg });
    }
  },

  /* ---------- 脚本优化 ---------- */
  async optimizeScript({ shots, direction, account, image }) {
    try {
      const content = await llm([
        { role: "system", content: `你在优化一张${image ? "图文" : "视频"}分镜脚本表。保持原有列结构${image ? "（idea/visual/line，无口播）" : "（time/idea/visual/line）"}，按用户的优化方向重写，使脚本更好。只输出 JSON：{"title":"可选新标题","shots":[...]}，shots 字段与输入一致。` },
        { role: "user", content: `账号定位：${account.position}\n优化方向：${direction}\n当前脚本（JSON）：\n${JSON.stringify(shots)}` }
      ], { json: true, temperature: 0.7 });
      const d = parseJSONLoose(content);
      if (!d.shots || !d.shots.length) throw new Error("模型未返回 shots");
      return this._ok({ title: d.title, shots: d.shots });
    } catch (e) {
      this._fb(e);
      await delay(400);
      return { shots: shots.map(s => ({ ...s, idea: (s.idea || "") + `（按"${direction}"优化）` })) };
    }
  },

  /* ---------- 视频提示词（两段式） ---------- */
  _sceneGroups(shots, duration = 30) {
    const scenes = Math.max(1, Math.round((duration || 30) / 30));
    const per = Math.max(1, Math.ceil(shots.length / scenes));
    const groups = [];
    for (let i = 0; i < scenes; i++) {
      const slice = shots.slice(i * per, (i + 1) * per);
      const half = Math.ceil(slice.length / 2) || 1;
      groups.push({ all: slice, front: slice.slice(0, half), back: slice.slice(half) });
    }
    return groups;
  },

  async generatePrompts({ shots, duration = 30, account }) {
    const groups = this._sceneGroups(shots || [], duration);
    const scenesText = groups.map((g, i) =>
      `【场景${i + 1}】\n  第一段(0-15秒)对应脚本镜头：\n${(g.front.length ? g.front : g.all).map((x, j) => `   镜头${j + 1} 画面：${x.visual || ""}｜口播：${x.line || ""}`).join("\n") || "   （无）"}\n  第二段(0-15秒)对应脚本镜头：\n${(g.back.length ? g.back : g.all).map((x, j) => `   镜头${j + 1} 画面：${x.visual || ""}｜口播：${x.line || ""}`).join("\n") || "   （无）"}`
    ).join("\n\n");
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + (account.subType === "无数字人" ? NO_DH_FRAMEWORK : PROMPT_FRAMEWORK) },
        { role: "user", content: `账号定位：${account.position}\n语气：${account.tone || "教程感"}\n平台：${account.platform}\n\n以下是已确定的分镜脚本，严格据此改写（每段都是独立的0-15秒视频，不要写衔接性措辞）：\n${scenesText}\n\n请为每个场景输出 segA(第一段0-15秒) 与 segB(第二段0-15秒) 完整提示词。` }
      ], { json: true, temperature: 0.6 });
      const d = parseJSONLoose(content);
      const prompts = (d.scenes || []).map((x, i) => ({
        name: cleanText(x.title) || `场景 ${String(i + 1).padStart(2, "0")}`,
        time: "0-15s",
        front: cleanText(x.segA || x.front), back: cleanText(x.segB || x.back), ui: x.ui !== false
      }));
      if (!prompts.length) throw new Error("模型未返回 scenes");
      return this._ok({ prompts });
    } catch (e) {
      this._fb(e);
      return this._mockPrompts({ groups, account });
    }
  },

  /* ---------- 分镜图提示词 ---------- */
  fallbackStoryboardPrompt(shot, account, style, sharedRefName) {
    const styleTxt = style || "白底极简、蓝紫渐变品牌色(#3f6bff 到 #9a45ff)、圆角卡片 UI、大留白、干净办公感";
    const refTxt = sharedRefName ? `统一参考「${sharedRefName}」保持品牌/角色一致；` : "";
    const v = (shot.visual || "数字人坐在办公桌前").trim();
    return cleanText(`9:16 竖图，${styleTxt}。画面内容：${v}。镜头：中近景、固定机位、人物三分位构图；光线：正面偏侧暖色柔光；界面元素：Dumate 产品界面与 logo（logo 居右上角），界面文字精简、大字号、清晰可读；主体动作与表情：自然放松、看向镜头或界面；背景：简洁办公桌面、浅景深虚化。${refTxt}无字幕、不叠加标题花字，不要二维码、不要乱码、不要密集小字、不要 emoji、不要出现除 Dumate 外的具体产品名。`);
  },

  async generateStoryboardPrompts({ shots, account, style, sharedRefName }) {
    const refLine = sharedRefName ? `所有分镜图统一参考「${sharedRefName}」，保持品牌/角色一致。` : "";
    const sys = `你是 Dumate 视频分镜图设计师。脚本每个镜头对应生成一张静态分镜图(9:16竖图)的画面提示词，数量必须与脚本镜头数完全一致、不能少、不能留空。${style ? "统一风格：" + style + "。" : "默认白底极简、蓝紫渐变品牌色、圆角卡片 UI、大留白。"}${refLine}写每条前，先把脚本那句画面在脑内具象化成一个完整真实场景（空间环境里有什么物件、光线从哪来、人物正在做哪个具体动作、屏幕里显示什么文字数据），脚本一句话至少扩成 3-5 个可落地的具体视觉细节。每条都要非常具体：景别(中近景/特写/全景)、机位与构图、人物动作与表情、界面里出现的具体文字、配色、光线方向与冷暖、背景元素、Dumate logo 位置。整体偏教程、专业、可信，不是信息流硬广，画面干净克制。画面里不要叠加字幕/标题/花字(产品界面本身自带的少量UI文字可以)。禁止使用『电影感/高级感/种草感/氛围感/科技感』等抽象词，要把这种感觉翻译成具体构图/光线/景深来写。不要 emoji、不要二维码、不要乱码、除 Dumate 外不要出现具体产品名。只输出 JSON：{"shots":[{"prompt":"..."}]}，shots 数量=脚本镜头数。`;
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + sys },
        { role: "user", content: `账号定位：${account.position}\n共 ${shots.length} 个镜头，请输出 ${shots.length} 条提示词：\n${shots.map((x, i) => (i + 1) + ". " + (x.visual || "")).join("\n")}` }
      ], { json: true, temperature: 0.7 });
      const d = parseJSONLoose(content);
      if (!d.shots || !d.shots.length) throw new Error("模型未返回 shots");
      return this._ok({ shots: shots.map((x, i) => ({ prompt: cleanText((d.shots[i] && d.shots[i].prompt || "").trim()) || this.fallbackStoryboardPrompt(x, account, style, sharedRefName) })) });
    } catch (e) {
      this._fb(e);
      await delay(400);
      return { shots: shots.map(x => ({ prompt: this.fallbackStoryboardPrompt(x, account, style, sharedRefName) })) };
    }
  },

  /* ---------- 图文：逐张图片提示词 ---------- */
  async generateImagePrompts({ script, account, style }) {
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + `你是小红书笔记配图的图片提示词设计师，为 Dumate 图文笔记出图。把脚本逐行拆成静态图片(封面/步骤/结果卡片)的画面提示词，一行脚本对应一张图，数量与脚本行数一致。每条 prompt 开头固定写「小红书笔记风格配图，竖版3:4」，再按账号定位细化风格语气。${style ? "所有图统一这个总风格：" + style + "。" : "默认白底极简、蓝紫渐变品牌色、圆角卡片排版、大留白、清爽种草感。"}写每条前，先把这张图在脑内具象化成一张真实的小红书配图（版式怎么排、主视觉是什么、界面截图放哪、文字落在哪个区域、用什么底色装饰），脚本一行至少扩成 3-5 个具体视觉细节。每条 prompt 都要非常具体：构图版式/主视觉元素/界面里出现的具体文字内容/图上文案的具体内容与摆放位置/配色/光线/Dumate logo 位置，文字精简清晰。禁止使用电影感/高级感/种草感/氛围感等抽象词，要把这种感觉翻译成具体画面元素去写。结尾带负面提示(不要乱码/不要密集小字/不要二维码/不要 emoji/除Dumate外不出现具体产品名)。只输出 JSON：{"shots":[{"title":"图片标题","prompt":"非常具体的完整画面提示词","ui":true}]}` },
        { role: "user", content: `账号定位：${account.position}\n语气：${account.tone || "教程感"}\n脚本：\n${script || "(据定位自拟)"}` }
      ], { json: true, temperature: 0.8 });
      const d = parseJSONLoose(content);
      if (!d.shots || !d.shots.length) throw new Error("模型未返回 shots");
      return this._ok({ shots: d.shots });
    } catch (e) {
      this._fb(e);
      await delay(400);
      const NEG = "负面提示：不要乱码、不要密集小字、不要硬广、不要复杂背景。";
      const titles = ["封面 · 痛点标题", "步骤一 · 打开 Dumate", "步骤二 · 输入任务", "结果 · 结构化输出", "结尾 · 品牌卡片"];
      return {
        shots: titles.map((t, i) => ({
          title: t, ui: i > 0 && i < 4,
          prompt: `小红书笔记风格配图，竖版3:4，白底极简，蓝紫渐变品牌色，圆角卡片排版，大留白。${t}：围绕「${(account.position || "").split("，")[0]}」，画面含 Dumate logo 与简洁界面元素，文字精简大字号。${NEG}`
        }))
      };
    }
  },

  /* ---------- 发布文案（交付包随附） ---------- */
  async generateCopy({ topic, shots, account, style, kind = "image" }) {
    const script = kind === "video"
      ? (shots || []).map((s, i) => `镜头${i + 1}｜${s.time || ""}｜口播：${s.line || ""}`).join("\n")
      : (shots || []).map((s, i) => `图${i + 1}｜${s.idea || ""}｜图上文案：${s.line || ""}`).join("\n");
    const sys = kind === "video"
      ? `你是短视频发布文案写手，为成片写发布标题与简介（发布平台：${account.platform}，按该平台调性写）：
- title：20字以内的爆款标题，口语化痛点钩子+数字/干货感，带1-2个贴合的emoji（如🔥✨📁💻⏰）。
- copy：80-180字简介，结构：一句共鸣开头 → 视频里的2-3个亮点（来自口播脚本，每点一行）→ 一句互动引导（提问/求关注）→ 最后一行3-5个话题标签（#开头，贴合账号定位）。
语气按账号定位细化，像真人发视频，不要硬广腔。除 Dumate/百度搭子外不出现其他品牌名。只输出 JSON：{"title":"...","copy":"..."}`
      : `你是小红书爆款笔记文案写手。根据图卡脚本写一篇配套笔记：
- title：20字以内的爆款标题，口语化痛点钩子+数字/干货感，带1-2个贴合的emoji（如🔥✨📁💻⏰）。
- copy：150-300字正文，结构：第一句钩子共鸣痛点 → 按脚本分点干货（每点一行，可用 ①②③ 或 ✅ 开头）→ 结尾一句互动引导（提问/求收藏）→ 最后一行3-5个话题标签（#开头，贴合账号定位）。
语气按账号定位细化，像真人发笔记，不要硬广腔。除 Dumate/百度搭子外不出现其他品牌名。只输出 JSON：{"title":"...","copy":"..."}`;
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + sys },
        { role: "user", content: `账号定位：${account.position}\n语气：${account.tone || "教程感"}\n主题：${topic}\n${style ? "图片风格：" + style + "\n" : ""}图卡脚本：\n${script}` }
      ], { json: true, temperature: 0.9 });
      const d = parseJSONLoose(content);
      if (!d.title || !d.copy) throw new Error("模型未返回 title/copy");
      return this._ok({ title: sanitizeProduct(d.title), copy: sanitizeProduct(d.copy) });
    } catch (e) {
      this._fb(e);
      await delay(400);
      return this._mockCopy({ topic, shots, account });
    }
  },

  async randomTitle({ topic, account }) {
    try {
      const r = await llm([{ role: "user", content: `给小红书笔记起一个爆款标题，主题「${topic || "Dumate 办公效率"}」，账号定位「${account.position}」。20字以内，口语化痛点钩子+干货感，带1-2个emoji。只回标题本身，不要引号不要解释。` }], { temperature: 1.1 });
      const t = sanitizeProduct(String(r).trim().replace(/^["'「]|["'」]$/g, "").slice(0, 30));
      if (t) return this._ok(t);
      throw new Error("空");
    } catch (e) {
      this._fb(e);
      return this._mockCopy({ topic, shots: [], account }).title;
    }
  },

  /* ---------- 随机骰子 ---------- */
  async randomPick({ kind, account }) {
    try {
      const ask = kind === "direction"
        ? `给我一个适合做 Dumate 办公效率产品教程短视频的目标人群方向，要主流、好理解、贴近大众（比如 职场白领 / 宝妈 / 大学生 / 老师 / 电商卖家 这类），不要冷门抽象概念。只回一个3-6字的词，不要标点不要解释。`
        : kind === "style"
        ? `为小红书图文笔记配图想一个总视觉风格短语，账号定位「${account.position}」。可以超出常见标签、有新鲜感但要好落地（例如：奶油色清晨书桌风 / 蓝白格子手帐风 / 低饱和莫兰迪办公风）。只回一个5-12字的风格短语，不要标点不要解释。`
        : `给我一个 Dumate 办公效率产品的短视频选题，贴合人群「${account.position}」，只回一句不超过15字的主题，不要标点不要解释。`;
      const r = await llm([{ role: "user", content: ask }], { temperature: 1.0 });
      const t = String(r).trim().replace(/[。.\n"'`]/g, "").slice(0, kind === "style" ? 16 : 18);
      if (t) return this._ok(kind === "direction" ? (t.endsWith("方向") ? t : t + "方向") : t);
      throw new Error("空");
    } catch (e) {
      this._fb(e);
      const pool = kind === "direction" ? DIR_POOL : kind === "style" ? STYLE_POOL : TOPIC_POOL;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return kind === "direction" ? pick + "方向" : pick;
    }
  },

  /* ---------- md / 自然语言 → 批量账号 ---------- */
  async parseAccountsMd(text) {
    try {
      const content = await llm([
        { role: "system", content: `把用户的 markdown 解析成账号数组。每个账号字段：name(必填)、platform(小红书|视频号)、mode(图文|视频)、subType(数字人|无数字人，仅视频)、position(账号定位描述)、qtags(数组，仅限：${TAG_POOL.join("/")})。缺失字段合理推断。只输出 JSON：{"accounts":[...]}` },
        { role: "user", content: text.slice(0, 6000) }
      ], { json: true, temperature: 0.2 });
      const d = parseJSONLoose(content);
      if (d.accounts && d.accounts.length) return this._ok(d.accounts);
      throw new Error("空");
    } catch (e) {
      this._fb(e);
      const blocks = text.split(/\n(?=#{1,3}\s|\d+[.、]\s|-\s+[^\s])/).map(b => b.trim()).filter(Boolean);
      return blocks.map(b => {
        const name = (b.match(/^[#\d.、\-\s]*([^\n｜|：:]+)/) || [])[1]?.trim().slice(0, 20);
        if (!name) return null;
        return {
          name,
          platform: b.includes("视频号") ? "视频号" : "小红书",
          mode: b.includes("图文") ? "图文" : "视频",
          subType: b.includes("无数字人") ? "无数字人" : "数字人",
          position: (b.match(/定位[：:]\s*([^\n]+)/) || [])[1] || "",
          qtags: TAG_POOL.filter(t => b.includes(t))
        };
      }).filter(Boolean);
    }
  },

  /* ---------- 自由对话（Agent chat 兜底走状态摘要） ---------- */
  async chat(messages) {
    return llm(messages, { temperature: 0.6 });
  },

  /* ---------- 本地回退模板 ---------- */
  async _mockScript({ topic, account, image, imageCount }) {
    await delay(600);
    const clean = (topic || "").replace(/Dumate|百度搭子/g, "").trim() || "杂事";
    if (image) {
      const n = Math.max(3, Math.min(9, imageCount || 6));
      const cover = { idea: "痛点钩子，引出场景", visual: "封面：白底大留白，居中大字标题 + Dumate logo 浮现", line: `${clean}太费时？` };
      const ending = { idea: "品牌收束", visual: "Dumate logo 居中 + 极简完成卡片", line: "效率交给 Dumate" };
      const stepsPool = [
        { idea: "引入 Dumate 入口", visual: "Dumate 首页圆角输入框，浅蓝网格背景", line: "打开 Dumate" },
        { idea: "演示输入任务", visual: "输入框内出现任务文字，发送按钮高亮", line: "一句话交给它" },
        { idea: "展示自动执行过程", visual: "任务卡片展开，进度条推进，蓝紫扫描线", line: "它自己动手干" },
        { idea: "展示结构化结果", visual: "结果卡片三个分区，蓝紫完成圆点", line: "几秒出结果" },
        { idea: "展示更多功能", visual: "白色卡片排列三个小图标：转格式/提信息/批量改名", line: "不止这一招" },
        { idea: "对比前后效果", visual: "左乱右整对比图，中间箭头指向 Dumate logo", line: "前后差距一目了然" },
        { idea: "使用小贴士", visual: "便签式卡片列两条使用技巧，配勾选图标", line: "记住这两个技巧" }
      ];
      const mid = stepsPool.slice(0, Math.max(1, n - 2));
      return { title: topic, shots: [cover, ...mid, ending].slice(0, n) };
    }
    const dh = account.subType !== "无数字人";
    const base = dh ? [
      { idea: "数字人开场钩子，痛点共鸣", visual: "数字人正面中近景、固定机位、暖色正面光，Dumate logo 右上轻浮现", line: `你是不是也总被${clean}困住，半天搞不定？` },
      { idea: "引出产品", visual: "缓推切到 Dumate 首页圆角输入框，浅蓝网格背景，输入框微微高亮", line: "其实打开百度搭子 Dumate，一句话就能交给它。" },
      { idea: "输入任务演示", visual: "特写输入框出现任务文字、点发送按钮蓝紫高亮，任务卡片滑入", line: "把要做的事直接发给它。" },
      { idea: "拆解步骤演示", visual: "任务卡片展开成三张步骤卡片依次滑入，蓝紫小圆点，鼠标依次划过", line: "它会自动拆成清晰的步骤，一步到位。" },
      { idea: "执行过程", visual: "文件/资料卡片滑入处理区，蓝紫扫描线+进度条从左推进", line: "交给它之后，等几秒就好。" },
      { idea: "结果展示", visual: "结构化结果卡片汇聚，三个分区、右上完成圆点，局部高亮", line: "结果清晰、能直接用。" },
      { idea: "数字人使用建议", visual: "切回数字人中近景，右侧悬浮结果卡片三条结果", line: "省下来的时间，喝杯咖啡不香吗？" },
      { idea: "数字人收束", visual: "数字人微笑看镜头，结果卡片缩小汇聚到 Dumate logo，定格完成卡片", line: "想更轻松，就用百度搭子 Dumate。" }
    ] : [
      { idea: "场景痛点引入", visual: "凌乱桌面/堆叠文件特写，缓推运镜，冷调光，画面压抑", line: "处理这些杂事，常常要花掉一上午。" },
      { idea: "引出产品界面", visual: "横移切到 Dumate 首页圆角输入框，浅蓝网格，界面干净明亮", line: "用百度搭子 Dumate，一句话就能交给它。" },
      { idea: "输入任务演示", visual: "输入框任务文字浮现、发送按钮蓝紫高亮，任务卡片滑入", line: "把需求直接发过去。" },
      { idea: "拆解步骤演示", visual: "三张步骤卡片自上而下滑入，蓝紫小圆点，轻微推拉", line: "它会自动拆解成清晰步骤。" },
      { idea: "执行过程", visual: "文件卡片滑入处理区，蓝紫扫描线、进度条推进、数字跳动", line: "整个过程自动完成。" },
      { idea: "结果展示", visual: "结构化结果卡片汇聚，三分区、完成圆点、局部高亮放大", line: "几秒就能拿到能直接用的结果。" },
      { idea: "对比收束", visual: "左乱右整对比画面横移，右侧定格整洁结果", line: "效率差距，一目了然。" },
      { idea: "品牌收束", visual: "所有卡片汇聚到 Dumate logo，白底浅蓝网格，定格完成卡片", line: "把杂事交给百度搭子 Dumate。" }
    ];
    const shots = base.map((b, i) => ({ time: `${i * 3}-${i === 7 ? 30 : i * 3 + 3}s`, idea: b.idea, visual: b.visual, line: b.line }));
    return { title: topic, shots };
  },

  async _mockPrompts({ groups, account }) {
    await delay(500);
    const NEG = "负面提示词：无字幕，不要在画面上叠加任何字幕/标题/花字/文字条，不要二维码或扫码引导，不要乱码，不要大段密集文字，不要夸张特效，不要复杂剧情，不要像硬广，不要人物表情僵硬，不要桌面杂乱，不要过多 UI 小字，不要使用任何 emoji。";
    const dh = account.subType !== "无数字人";
    const head = dh
      ? `@参考数字人图，@参考产品界面与logo图，@参考音频，这是一条 Dumate 产品教程短视频，9:16竖屏，时长15秒。数字人外貌/服装/发型完全参考上传图、不改写；口播语气节奏参考上传音频（自然、专业、可信）。`
      : `@参考产品界面与logo图，这是一条 Dumate 产品教程短视频，9:16竖屏，时长15秒，场景/产品界面混剪，专业画外音旁白（无固定出镜人物）。`;
    const voiceKey = dh ? "口播" : "画外音";
    const defVisual = dh ? "数字人中近景，固定机位，柔和正面光，背景简洁办公桌" : "产品界面特写，缓推运镜，卡片滑入动效，浅蓝网格背景";
    const seg = (arr) => {
      const slots = ["0-3秒", "3-7秒", "7-11秒", "11-15秒"];
      return (arr.length ? arr : [{}]).slice(0, 4).map((x, j) =>
        `镜头${j + 1}｜${slots[j] || ""}｜画面：${x.visual || defVisual}；${voiceKey}：${x.line || ""}`).join("\n");
    };
    const uiOf = (arr) => arr.some(x => /UI|界面|屏幕|文件|数据|表格|卡片|演示/.test(x.visual || ""));
    const prompts = groups.map((g, i) => {
      const A = g.front.length ? g.front : g.all;
      const B = g.back.length ? g.back : g.all;
      const themeLine = `本条主题：${(account.position || "").split("，")[0]}；场景：明亮办公桌前、暖色柔光(前后两段同一场景)；BGM：轻快办公背景乐(前后两段同一BGM)。`;
      return {
        name: `场景 ${String(i + 1).padStart(2, "0")}`,
        time: "0-15s",
        ui: uiOf(g.all),
        front: `${head}\n${themeLine}\n${seg(A)}\n${NEG}`,
        back: `${head}\n${themeLine}\n${seg(B)}\n${NEG}`
      };
    });
    return { prompts };
  },

  _mockCopy({ topic, shots, account }) {
    const t = (topic || "桌面整理").replace(/Dumate|百度搭子/g, "").trim() || "办公杂事";
    const emo = ["🔥", "✨", "📁", "💻", "⏰", "🙌", "💡"];
    const e1 = emo[Math.floor(Math.random() * emo.length)];
    const titles = [
      `${e1} 打工人亲测！${t}3秒搞定`,
      `后悔没早用${e1} ${t}神器来了`,
      `${t}还在手动？${e1}一句话全自动`,
      `${e1} 每天省2小时的${t}技巧`,
      `谁懂啊！${t}终于不用加班了${e1}`
    ];
    const points = (shots || []).filter(s => s.line).slice(1, 5).map((s, i) => `${["①", "②", "③", "④"][i]} ${s.line}`);
    const copy = `每次${t}都要折腾半天，真的会谢😮‍💨\n其实交给百度搭子 Dumate 一句话就搞定：\n${points.join("\n") || "① 打开 Dumate 说出需求\n② 它自动拆步骤执行\n③ 几秒拿到能直接用的结果"}\n亲测省下的时间够喝两杯咖啡☕\n你们平时${t}要花多久？评论区聊聊👇\n#办公效率 #AI工具 #打工人必备 #效率神器`;
    return { title: titles[Math.floor(Math.random() * titles.length)], copy };
  }
};

window.DumateAI = AI;
