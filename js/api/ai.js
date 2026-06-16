/* AI 生成服务（脚本 / 提示词 / 文案 / 解析）：LLM 优先，失败回退本地模板
   每次调用记录 lastSource: "llm" | "mock"，UI 据此明确标注产物来源 */

import { llm } from "./llm.js";
import { DUMATE_BRIEF, PROMPT_FRAMEWORK, NO_DH_FRAMEWORK, DIR_POOL, TOPIC_POOL, STYLE_POOL } from "./prompts.js";
import { cleanText, sanitizeProduct, stripCTA, parseJSONLoose, delay } from "../core/util.js";
import { TAG_POOL } from "../domain/accounts.js";

export const AI = {
  lastSource: "mock",
  lastError: "",

  _ok(d) { this.lastSource = "llm"; this.lastError = ""; return d; },
  _fb(e) { this.lastSource = "mock"; this.lastError = (e && e.message) || String(e || "网络/CORS"); },

  sourceNote(okMsg) {
    return this.lastSource === "llm" ? okMsg : `API 未通（${this.lastError || "网络/CORS"}），已用本地模板`;
  },

  /* ---------- 素材号长视频脚本（60s+，有深度/有梗、利他，画外音后期配；每镜头标 ui/scene） ---------- */
  async generateMaterialScript({ topic, account, style = "" }) {
    const sys = `你是百度 ACG 市场部资深长视频编剧，为 Dumate 写【素材号】视频脚本：没有固定出镜人物，画面全部由场景/产品界面/实拍素材混剪而成。line 是后期配音的画外音口播稿（画面本身无人声）。

【时长与篇幅】成片 60-120 秒，拆成 12-18 个镜头，每镜头口播 2-4 句、画面描述充实。整体口播文字量要足够撑满 60 秒以上，不要写得稀薄敷衍。

【口播是灵魂，必须有内容、利他】
- 按账号定位决定风格：偏知识/测评就讲出真东西——给具体数字、横向对比、反常识结论、可复用的方法；偏轻松就有梗有节奏（口语、自嘲、神转折），让人忍不住看完。
- 强利他：站在观众角度，告诉他"能省什么、怎么用、避什么坑"，让人觉得"看完有收获"。开头 3 秒就抛出钩子或痛点。
- 严禁任何"关注我/点赞收藏/求三连/记得关注/下期见/评论区告诉我"之类的引导式结尾。结尾用一句利他的总结或金句收束（例如把方法点题、留一个让人回味的观点）。

【画面 visual】非常具体：空间环境、产品界面里出现的具体文字与数据、界面动效、配色、光线。不要写运镜（运镜留给视频提示词阶段）。画面中不要安排任何叠加文字/字幕。${style ? `整体画面风格：${style}。` : ""}

【每镜头两个关键标记】
- ui：布尔。该镜头画面是否包含"产品界面 / Dumate logo / 需要清晰呈现的真实中文文字"。含这些→ui=true（后续需要分镜图参考再图生视频）；纯场景/空镜/氛围/手部特写等不含界面文字的→ui=false（后续直接文生视频，省去出图）。
- scene：整数场景编号。连续几个镜头若发生在同一场景、动作连贯，给同一个 scene 编号（后续会合成一条多镜头视频）；切换场景就换新编号。

只输出 JSON：{"title":"标题","shots":[{"idea":"核心思想","visual":"非常具体的画面","line":"画外音口播稿(可直接念，2-4句)","ui":true,"scene":1}]}，12-18 个镜头。`;
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + sys },
        { role: "user", content: `账号定位：${account.position}\n语气：${account.tone || "教程感"}\n平台：${account.platform}\n主题：${topic}\n围绕百度搭子 Dumate 的真实功能展开，口播要有信息量、利他、能让人看完，结尾不要任何引导关注的话。` }
      ], { json: true, temperature: 0.85 });
      const d = parseJSONLoose(content);
      if (!d.shots || d.shots.length < 8) throw new Error("模型未返回足够镜头");
      return this._ok({ title: cleanText(d.title) || topic, shots: d.shots.map((x, i) => ({
        idea: cleanText(x.idea), visual: cleanText(x.visual), line: stripCTA(cleanText(x.line)),
        ui: x.ui !== false && /界面|logo|文字|屏幕|表格|数据|文档|报告|卡片|按钮|输入框|窗口/.test((x.visual || "") + (x.ui === true ? "界面" : "")),
        scene: Number.isFinite(x.scene) ? x.scene : i + 1
      })) });
    } catch (e) {
      this._fb(e);
      return this._mockMaterialScript({ topic, account });
    }
  },

  /* ---------- 素材号：按「分镜单元」生成 图片提示词(先) + 视频提示词(后，呼应图片、多镜头) ----------
     units: [{ scene, needsImage, dur, shotIndexes }]；shots: 全量镜头 */
  async generateUnitPrompts({ units, shots, account, style = "" }) {
    const { MATERIAL_VIDEO_NEG } = await import("./prompts.js");
    const unitText = units.map((u, i) => {
      const us = (u.shotIndexes || []).map(k => shots[k]).filter(Boolean);
      return `单元${i + 1}（场景${u.scene}，${Math.ceil(u.dur)}秒，${u.needsImage ? "含产品界面/logo/中文→需先出分镜图" : "纯场景→可直接文生视频"}，${us.length}个连贯镜头）：\n${us.map((s, j) => `  画面${j + 1}：${s.visual || s.idea || ""}`).join("\n")}`;
    }).join("\n");
    const sys = `你为 Dumate 素材混剪视频，按「分镜单元」生成提示词。每个单元最终是一条独立的视频素材片段（同场景多个连贯镜头合成一条）。对每个单元产出两段：

【imagePrompt】静态分镜图提示词，只有 needsImage=true 的单元才需要（其余留空字符串）。要求：描述这一单元的关键画面定帧，非常具体——构图版式、产品界面里出现的具体中文文字与数据、Dumate logo 位置、配色、光线、画面里的实物。**不要写任何运镜/镜头移动**（那是视频阶段的事）。${style ? `风格：${style}。` : ""}

【videoPrompt】视频提示词，每个单元都要。要求：开头写明"9:16竖屏，时长${"{N}"}秒，纯画面无人声"；若该单元含多个连贯镜头，就写成一条多镜头运动视频（按顺序描述镜头1→镜头2…的画面与衔接）；needsImage=true 的单元要让画面与 imagePrompt 的定帧呼应一致（同一界面/同一文字/同一配色延续运动）。这里才写运镜（缓推/横移/跟随/固定）与界面动效。结尾加上："${MATERIAL_VIDEO_NEG}"

只输出 JSON：{"units":[{"imagePrompt":"...或空字符串","videoPrompt":"..."}]}，顺序与单元一致。`;
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + "\n\n" + sys },
        { role: "user", content: `账号定位：${account.position}\n共 ${units.length} 个单元：\n${unitText}` }
      ], { json: true, temperature: 0.7 });
      const d = parseJSONLoose(content);
      if (!d.units || !d.units.length) throw new Error("模型未返回 units");
      return this._ok({ units: units.map((u, i) => {
        const r = d.units[i] || {};
        return {
          imagePrompt: u.needsImage ? (cleanText((r.imagePrompt || "").trim()) || this._fbUnitImage(u, shots, style)) : "",
          videoPrompt: cleanText((r.videoPrompt || "").trim()) || this._fbUnitVideo(u, shots, style, MATERIAL_VIDEO_NEG)
        };
      }) });
    } catch (e) {
      this._fb(e);
      await delay(300);
      return { units: units.map(u => ({
        imagePrompt: u.needsImage ? this._fbUnitImage(u, shots, style) : "",
        videoPrompt: this._fbUnitVideo(u, shots, style, MATERIAL_VIDEO_NEG)
      })) };
    }
  },
  _fbUnitImage(u, shots, style) {
    const us = (u.shotIndexes || []).map(k => shots[k]).filter(Boolean);
    const v = us.map(s => s.visual || s.idea || "").filter(Boolean)[0] || "Dumate 产品界面";
    return cleanText(`9:16 竖图分镜定帧，${style || "白底极简、蓝紫品牌渐变(#3f6bff→#9a45ff)、圆角卡片 UI、大留白、干净办公感"}。画面：${v}。Dumate 产品界面与 logo（logo 居右上角），界面文字精简、大字号、清晰可读；干净构图、明亮柔光、浅景深。`);
  },
  _fbUnitVideo(u, shots, style, NEG) {
    const us = (u.shotIndexes || []).map(k => shots[k]).filter(Boolean);
    const body = us.length > 1
      ? us.map((s, j) => `镜头${j + 1}：${s.visual || s.idea || ""}`).join("；")
      : (us[0]?.visual || us[0]?.idea || "产品界面演示");
    return cleanText(`9:16竖屏，时长${Math.ceil(u.dur)}秒，纯画面无人声${us.length > 1 ? "，同场景多镜头连贯运动" : ""}。${body}。${u.needsImage ? "画面与分镜图定帧呼应、界面与文字一致；" : ""}运镜：${u.scene % 2 ? "缓推" : "横移"}、衔接顺滑、明亮柔光、干净构图${style ? `；风格：${style}` : ""}。${NEG}`);
  },

  /* ---------- 素材号：逐镜头视频提示词（旧版，保留兼容） ---------- */
  async generateShotVideoPrompts({ shots, perShot = [], account, style = "" }) {
    const { MATERIAL_VIDEO_NEG } = await import("./prompts.js");
    const fallback = (s, i) => cleanText(`这是一条 Dumate 产品视频的单镜头素材，9:16 竖屏，时长${Math.ceil(perShot[i]?.dur || 4)}秒，场景/产品界面混剪，纯画面无人声。画面内容：${s.visual || s.idea || "产品界面演示"}。镜头语言：${i % 2 ? "缓推" : "横移"}运镜、干净构图、明亮柔光${style ? `；整体风格：${style}` : ""}。${MATERIAL_VIDEO_NEG}`);
    try {
      const content = await llm([
        { role: "system", content: DUMATE_BRIEF + `\n\n你为素材混剪视频逐镜头生成视频提示词：每个镜头一条独立提示词，对应生成一段独立的视频素材片段。每条开头写明"9:16竖屏，时长N秒，场景/产品界面混剪，纯画面无人声"。画面具体到景别/机位运镜/界面文字/动效/光线，禁止抽象词。每条结尾都必须带上这段负面提示词："${MATERIAL_VIDEO_NEG}"。只输出 JSON：{"shots":[{"prompt":"..."}]}，数量与镜头数一致。` },
        { role: "user", content: `账号定位：${account.position}\n${style ? `画面风格：${style}\n` : ""}共 ${shots.length} 个镜头（含各自时长）：\n${shots.map((s, i) => `${i + 1}. [${Math.ceil(perShot[i]?.dur || 4)}秒] ${s.visual || ""}`).join("\n")}` }
      ], { json: true, temperature: 0.6 });
      const d = parseJSONLoose(content);
      if (!d.shots || !d.shots.length) throw new Error("模型未返回 shots");
      return this._ok({ shots: shots.map((s, i) => ({ prompt: cleanText((d.shots[i]?.prompt || "").trim()) || fallback(s, i) })) });
    } catch (e) {
      this._fb(e);
      await delay(300);
      return { shots: shots.map((s, i) => ({ prompt: fallback(s, i) })) };
    }
  },

  /* ---------- 灵感建议：按账号矩阵随机生成量产指令（LLM 优先，离线真随机兜底） ---------- */
  async suggestGoals({ accounts = [] }) {
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const offline = () => {
      const tags = [...new Set(accounts.flatMap(a => a.qtags || []))];
      const t1 = pick(TOPIC_POOL), t2 = pick(TOPIC_POOL.filter(x => x !== t1)), t3 = pick(TOPIC_POOL);
      return [
        `给${tags.length ? "所有" + pick(tags) + "标签的" : "全部"}账号做一期「${t1}」`,
        `给图文组来一批「${t2}」，${pick(STYLE_POOL)}`,
        `给素材号全自动出一批「${t3}」`
      ];
    };
    try {
      const content = await llm([
        { role: "system", content: `根据账号矩阵给内容量产 Agent 生成 3 条一句话指令建议。要求：主题贴合 Dumate 真实功能（文件整理/格式转换/信息提取/数据分析/办公自动化）且每次新颖不重复；指明范围（全部 / 某标签 / 图文组 / 真人 / 素材号）；每条不超过 32 字；只输出 JSON：{"suggestions":["...","...","..."]}` },
        { role: "user", content: `账号矩阵：${JSON.stringify(accounts.map(a => ({ 名称: a.name, 分组: a.mode === "图文" ? "图文组" : a.subType === "数字人" ? "真人" : "素材", 定位: (a.position || "").slice(0, 30), 标签: a.qtags || [] })))}\n随机种子：${Math.random().toString(36).slice(2, 8)}` }
      ], { json: true, temperature: 1.2 });
      const d = parseJSONLoose(content);
      if (Array.isArray(d.suggestions) && d.suggestions.length >= 3) return this._ok(d.suggestions.slice(0, 3).map(s => String(s).slice(0, 40)));
      throw new Error("空");
    } catch (e) {
      this._fb(e);
      return offline();
    }
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
      const cleanShots = d.shots.map(x => ({ ...x, idea: cleanText(x.idea), visual: cleanText(x.visual), line: image ? cleanText(x.line) : stripCTA(cleanText(x.line)) }));
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
    return cleanText(`9:16 竖图，${styleTxt}。画面内容：${v}。镜头：中近景、固定机位、人物三分位构图；光线：正面偏侧暖色柔光；界面元素：Dumate 产品界面与 logo（logo 居右上角），界面文字精简、大字号、清晰可读；主体动作与表情：自然放松、看向镜头或界面；背景：简洁办公桌面、浅景深虚化。${refTxt}无字幕、不叠加标题花字，不要二维码、不要乱码、不要密集小字、不要 emoji。`);
  },

  async generateStoryboardPrompts({ shots, account, style, sharedRefName }) {
    const refLine = sharedRefName ? `所有分镜图统一参考「${sharedRefName}」，保持品牌/角色一致。` : "";
    const sys = `你是 Dumate 视频分镜图设计师。脚本每个镜头对应生成一张静态分镜图(9:16竖图)的画面提示词，数量必须与脚本镜头数完全一致、不能少、不能留空。${style ? "统一风格：" + style + "。" : "默认白底极简、蓝紫渐变品牌色、圆角卡片 UI、大留白。"}${refLine}写每条前，先把脚本那句画面在脑内具象化成一个完整真实场景（空间环境里有什么物件、光线从哪来、人物正在做哪个具体动作、屏幕里显示什么文字数据），脚本一句话至少扩成 3-5 个可落地的具体视觉细节。每条都要非常具体：景别(中近景/特写/全景)、机位与构图、人物动作与表情、界面里出现的具体文字、配色、光线方向与冷暖、背景元素、Dumate logo 位置。整体偏教程、专业、可信，不是信息流硬广，画面干净克制。画面里不要叠加字幕/标题/花字(产品界面本身自带的少量UI文字可以)。禁止使用『电影感/高级感/种草感/氛围感/科技感』等抽象词，要把这种感觉翻译成具体构图/光线/景深来写。不要 emoji、不要二维码、不要乱码。只输出 JSON：{"shots":[{"prompt":"..."}]}，shots 数量=脚本镜头数。`;
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
        { role: "system", content: DUMATE_BRIEF + "\n\n" + `你是小红书笔记配图的图片提示词设计师，为 Dumate 图文笔记出图。把脚本逐行拆成静态图片(封面/步骤/结果卡片)的画面提示词，一行脚本对应一张图，数量与脚本行数一致。每条 prompt 开头固定写「小红书笔记风格配图，竖版3:4」，再按账号定位细化风格语气。${style ? "所有图统一这个总风格：" + style + "。" : "默认白底极简、蓝紫渐变品牌色、圆角卡片排版、大留白、清爽种草感。"}写每条前，先把这张图在脑内具象化成一张真实的小红书配图（版式怎么排、主视觉是什么、界面截图放哪、文字落在哪个区域、用什么底色装饰），脚本一行至少扩成 3-5 个具体视觉细节。每条 prompt 都要非常具体：构图版式/主视觉元素/界面里出现的具体文字内容/图上文案的具体内容与摆放位置/配色/光线/Dumate logo 位置，文字精简清晰。禁止使用电影感/高级感/种草感/氛围感等抽象词，要把这种感觉翻译成具体画面元素去写。结尾带负面提示(不要乱码/不要密集小字/不要二维码/不要 emoji)。只输出 JSON：{"shots":[{"title":"图片标题","prompt":"非常具体的完整画面提示词","ui":true}]}` },
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
语气按账号定位细化，像真人发视频，不要硬广腔。只输出 JSON：{"title":"...","copy":"..."}`
      : `你是小红书爆款笔记文案写手。根据图卡脚本写一篇配套笔记：
- title：20字以内的爆款标题，口语化痛点钩子+数字/干货感，带1-2个贴合的emoji（如🔥✨📁💻⏰）。
- copy：150-300字正文，结构：第一句钩子共鸣痛点 → 按脚本分点干货（每点一行，可用 ①②③ 或 ✅ 开头）→ 结尾一句互动引导（提问/求收藏）→ 最后一行3-5个话题标签（#开头，贴合账号定位）。
语气按账号定位细化，像真人发笔记，不要硬广腔。只输出 JSON：{"title":"...","copy":"..."}`;
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

  /* 素材号长脚本本地兜底（12 镜头、利他口播、带 ui/scene 标记） */
  async _mockMaterialScript({ topic, account }) {
    await delay(600);
    const t = (topic || "").replace(/Dumate|百度搭子/g, "").trim() || "重复的办公杂活";
    const rows = [
      { idea: "痛点钩子", visual: "凌乱桌面、堆叠文件与杂乱文件夹的特写，冷调光，画面略压抑", line: `先说个扎心的：很多人每天有近一个小时，是耗在${t}这种重复杂活上的。不是你不够快，是这些活本就不该手动干。`, ui: false, scene: 1 },
      { idea: "提出方案", visual: "Dumate 桌面端首页圆角输入框，浅蓝网格背景，界面干净明亮，输入框光标闪烁", line: `这两年我把这些事都丢给了一个桌面智能体——百度搭子 Dumate。它不是聊天框，是真能看着你的屏幕、直接动手把活干完的那种。`, ui: true, scene: 2 },
      { idea: "演示输入", visual: "特写输入框里逐字浮现一句任务指令，发送按钮蓝紫高亮，任务卡片从下方滑入", line: `用法简单到离谱：把要做的事，像跟同事说话一样打一句话发给它。`, ui: true, scene: 2 },
      { idea: "拆解步骤", visual: "任务卡片展开成三张步骤卡片自上而下排开，每张带蓝紫小圆点和一行中文说明", line: `它会先把这件事拆成清清楚楚的几步，让你知道它打算怎么干，而不是黑箱乱来。`, ui: true, scene: 2 },
      { idea: "执行过程", visual: "文件卡片成批滑入处理区，蓝紫扫描线自左向右扫过，进度条推进、数字跳动", line: `确认之后它就自己开始执行，批量处理、跨软件来回切换，全程你不用守着。`, ui: true, scene: 3 },
      { idea: "结果展示", visual: "结构化结果卡片汇聚成三个分区，右上角逐个亮起完成圆点，关键数据被局部高亮放大", line: `几十秒后，结果直接是能用的版本：归好类的文件、提好的关键信息、甚至一份排好版的汇报。`, ui: true, scene: 3 },
      { idea: "能力一：文件整理", visual: "左乱右整的文件夹对比画面横移，中间一条箭头指向整洁的分类结构", line: `具体能帮你做什么？第一类是文件：一键分类归档、Word Excel PPT 和 PDF 互转、从合同会议纪要里把关键信息抠出来。`, ui: false, scene: 4 },
      { idea: "能力二：数据分析", visual: "原始数据表格流入处理区，自动生成柱状图与一页汇报 PPT 的画面", line: `第二类是数据：从一堆原始表格，到一份能直接拿去汇报的分析 PPT，中间那些拉表格、做图的功夫，它全包了。`, ui: true, scene: 5 },
      { idea: "能力三：办公自动化", visual: "网页表单被自动填写、资料批量下载、多个软件窗口依次被操作的画面", line: `第三类更狠，是替你动手：自动网页填表、批量查信息下资料、把好几个软件串成一条流程跑下来。`, ui: true, scene: 6 },
      { idea: "安全说明", visual: "本地沙箱的示意画面，数据在本机闭环流转、不外传的图示，冷静蓝调", line: `可能你担心数据安全——它跑在本地沙箱里，资料不外流，这点对处理公司文件的人挺关键。`, ui: false, scene: 7 },
      { idea: "适用人群", visual: "办公桌前空镜，桌上摆着键盘、咖啡和便签，暖色晨光", line: `所以它真正帮到的，是每天被这些重复活拖住、本该把时间花在更值钱的事情上的人。`, ui: false, scene: 8 },
      { idea: "金句收束", visual: "所有结果卡片缓缓汇聚成一个 Dumate logo，白底浅蓝网格，定格成一张干净的完成卡片", line: `一句话总结：能交给工具的，就别再用人肉硬扛。把重复留给它，把脑子留给真正重要的事。`, ui: true, scene: 9 }
    ];
    return { title: topic, shots: rows.map(r => ({ ...r, line: stripCTA(r.line) })) };
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
