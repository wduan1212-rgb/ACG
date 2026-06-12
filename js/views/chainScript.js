/* 链路 · 脚本页：主题/风格/张数 → AI 按定位生成结构化分镜表 → 行内编辑 → 优化 */

import { $, $$, esc } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById } from "../core/store.js";
import { AI } from "../api/ai.js";
import { STYLE_CHIP_BASE } from "../api/prompts.js";
import { normalizeVideoTimes, setStage } from "../domain/productions.js";
import { toast, withLoading, promptModal } from "../ui/components.js";
import { go } from "../core/router.js";
import { stepperHtml, wireStepper } from "./studio.js";

export function renderScriptPage(root, p) {
  const acc = accountById(p.accountId);
  const isImg = p.mode === "图文";
  const A = p.artifacts.script;

  root.innerHTML = `
    ${stepperHtml(p, "script")}
    <div class="chain-page">
      <div class="chain-main">
        <div class="page-head">
          <div><div class="eyebrow">${STAGES_LABEL(isImg)}</div>
          <h2>${isImg ? "AI 依账号定位生成小红书笔记图卡" : "AI 依账号定位生成分镜脚本（含口播）"}</h2></div>
          <button class="btn primary" id="csNext">下一步：${isImg ? "成图" : "分镜"} ${icon("arrowRight", 14)}</button>
        </div>

        <div class="brief card">
          <div class="brief-row">
            <label class="field grow">创作主题
              <div class="input-dice">
                <input class="input" id="csTopic" value="${esc(p.topic || "")}" placeholder="例如：Dumate 一键整理混乱文件夹" />
                <button class="dice" id="csTopicDice" title="AI 随机主题">${icon("dice", 15)}</button>
              </div>
            </label>
            ${isImg ? `
            <div class="field count-field">
              <span>生成几张图 <em id="csCountVal">${A.imageCount || 6} 张</em></span>
              <div class="count-slider"><span>3</span><input type="range" id="csCount" min="3" max="9" step="1" value="${A.imageCount || 6}" /><span>9</span></div>
            </div>` : ""}
          </div>
          ${isImg ? `
          <div class="brief-row">
            <label class="field grow">图文总风格
              <div class="input-dice">
                <input class="input" id="csStyle" value="${esc(A.style || acc.lockedStyle || "")}" ${acc.lockedStyle ? "readonly" : ""} placeholder="整体视觉风格，点标签快速填入" />
                <button class="dice" id="csStyleDice" title="AI 随机风格">${icon("dice", 15)}</button>
                <button class="dice ${acc.lockedStyle ? "locked" : ""}" id="csStyleLock" title="${acc.lockedStyle ? "已固定，点击解锁" : "固定当前风格：该账号之后默认用它"}">${icon(acc.lockedStyle ? "lock" : "unlock", 15)}</button>
              </div>
              <div class="style-chips" id="csChips"></div>
            </label>
          </div>` : ""}
          <div class="brief-row">
            <button class="btn gen" id="csGen">${icon("spark", 15)} 按定位生成脚本</button>
            ${A.source ? `<span class="src-note">${A.source === "llm" ? "✓ DeepSeek 真实生成" : "⚠ 本地模板（API 未通）"}</span>` : ""}
          </div>
        </div>

        <div class="table-head">
          <div><b>${isImg ? "笔记图卡内容（无口播）" : "分镜脚本"}</b><em class="muted">单元格可直接编辑</em></div>
          ${isImg ? "" : `<button class="btn ghost sm" id="csAddShot">${icon("plus", 13)} 添加镜头</button>`}
        </div>
        <div id="csTable"></div>

        <div class="optimize-bar card">
          <input class="input" id="csOptDir" placeholder="优化方向，例如：开头更有钩子 / 减少广告腔 / 突出批量重命名功能" />
          <button class="btn ghost" id="csOpt">${icon("wand", 14)} 优化脚本</button>
        </div>
      </div>

      <aside class="chain-side">
        <div class="side-card card">
          <h3>账号定位</h3>
          <div class="pos-card">
            <div class="pc-row"><span>账号</span><b>${esc(acc.name)}</b></div>
            <div class="pc-row"><span>平台</span><b>${esc(acc.platform)}</b></div>
            <div class="pc-row"><span>模式</span><b>${esc(p.mode)}${p.subType ? " · " + esc(p.subType) : ""}</b></div>
            <div class="pc-row"><span>定位</span><b>${esc(acc.position)}</b></div>
          </div>
        </div>
        ${isImg ? "" : `<div class="side-card card hint">
          <h3>结构规则</h3>
          <p>视频固定 30 秒，拆成两段<b>各自独立生成</b>的 15s 视频，靠共享参考（角色版 / 产品界面 / 声线）保持一致后拼接。提示词按这张分镜表逐镜头生成。</p>
        </div>`}
        <div class="side-card card" id="csStruct"></div>
      </aside>
    </div>`;

  wireStepper(root);
  renderTable();
  renderStruct();
  if (isImg) renderChips();

  /* ---------- 表格 ---------- */
  function cols() {
    return isImg
      ? [["idea", "核心思想"], ["visual", "画面描述"], ["line", "图上文案"]]
      : [["time", "时间"], ["idea", "核心思想"], ["visual", "画面 / 分镜"], ["line", "口播"]];
  }
  function renderTable() {
    const wrap = $("#csTable", root);
    const shots = A.shots || [];
    if (!shots.length) {
      wrap.innerHTML = `<div class="empty-state slim">${icon(isImg ? "image" : "film", 22)}<b>点击「按定位生成脚本」</b><p>AI 会按账号定位输出${isImg ? "笔记图卡内容（核心思想 / 画面 / 图上文案）" : "结构化分镜表（时间 / 思想 / 画面 / 口播）"}</p></div>`;
      return;
    }
    const C = cols();
    wrap.innerHTML = `<table class="script-table"><thead><tr><th class="c-idx">#</th>${C.map(c => `<th>${c[1]}</th>`).join("")}<th class="c-act"></th></tr></thead>
      <tbody>${shots.map((s, i) => `<tr>
        <td class="c-idx">${i + 1}</td>
        ${C.map(c => `<td class="c-edit" contenteditable="true" data-f="${c[0]}" data-i="${i}">${esc(s[c[0]] || "")}</td>`).join("")}
        <td class="c-act"><button class="row-del" data-del="${i}" title="删除">${icon("x", 12)}</button></td>
      </tr>`).join("")}</tbody></table>`;
    wrap.querySelectorAll(".c-edit").forEach(td => td.addEventListener("blur", () => {
      const s = A.shots[+td.dataset.i];
      if (s) { s[td.dataset.f] = td.textContent.trim(); save("productions"); }
    }));
    wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
      A.shots.splice(+b.dataset.del, 1); save("productions"); renderTable(); renderStruct();
    }));
  }
  function renderStruct() {
    const el = $("#csStruct", root);
    const n = (A.shots || []).length;
    el.innerHTML = `<h3>${isImg ? "图卡结构" : "脚本结构"}</h3>` + (n
      ? (isImg
        ? `<div class="seg-mini">共 ${n} 张图卡：封面 → 步骤 → 收束。下一步逐张出图。</div>`
        : `<div class="seg-mini"><div class="sm-top"><b>场景 01</b><span>0-30s</span></div><div>前 15s + 后 15s 两段独立成片</div></div><div class="muted" style="margin-top:6px">共 ${n} 个镜头</div>`)
      : `<div class="muted">生成脚本后显示结构概览</div>`);
  }
  function renderChips() {
    const box = $("#csChips", root); if (!box) return;
    const custom = acc.customStyleChips || [];
    const cur = ($("#csStyle", root).value || "").split(/[、,，]/).map(s => s.trim());
    box.innerHTML = STYLE_CHIP_BASE.map(s => `<button class="chip ${cur.includes(s) ? "on" : ""}" data-style="${esc(s)}">${esc(s)}</button>`).join("")
      + custom.map(s => `<button class="chip custom ${cur.includes(s) ? "on" : ""}" data-style="${esc(s)}">${esc(s)}<i data-x="${esc(s)}">×</i></button>`).join("")
      + `<button class="chip add" data-add-chip>+ 自定义</button>`;
  }

  /* ---------- 事件 ---------- */
  $("#csTopic", root).addEventListener("input", e => { p.topic = e.target.value; p.title = p.title || e.target.value; save("productions"); });
  $("#csTopicDice", root).addEventListener("click", async e => {
    await withLoading(e.currentTarget, async () => {
      const t = await AI.randomPick({ kind: "topic", account: acc });
      $("#csTopic", root).value = t; p.topic = t; save("productions");
      toast("已随机主题：" + t);
    }, "…");
  });

  if (isImg) {
    $("#csCount", root).addEventListener("input", e => {
      A.imageCount = +e.target.value;
      $("#csCountVal", root).textContent = `${A.imageCount} 张${A.imageCount >= 9 ? "（小红书上限）" : ""}`;
      save("productions");
    });
    $("#csStyle", root).addEventListener("input", e => { A.style = e.target.value; save("productions"); renderChips(); });
    $("#csStyleDice", root).addEventListener("click", async e => {
      if (acc.lockedStyle) { toast("已锁定风格，先解锁"); return; }
      await withLoading(e.currentTarget, async () => {
        const v = await AI.randomPick({ kind: "style", account: acc });
        $("#csStyle", root).value = v; A.style = v; save("productions"); renderChips();
        toast((AI.lastSource === "llm" ? "AI 已随机风格：" : "已随机风格：") + v);
      }, "…");
    });
    $("#csStyleLock", root).addEventListener("click", () => {
      if (acc.lockedStyle) { acc.lockedStyle = null; toast("已解锁风格"); }
      else {
        const v = $("#csStyle", root).value.trim();
        if (!v) { toast("先填写或随机一个风格"); return; }
        acc.lockedStyle = v; A.style = v; toast(`已固定风格「${v}」`);
      }
      save("accounts", "productions");
      renderScriptPage(root, p);
    });
    $("#csChips", root).addEventListener("click", async e => {
      const x = e.target.closest("[data-x]");
      if (x) { acc.customStyleChips = (acc.customStyleChips || []).filter(s => s !== x.dataset.x); save("accounts"); renderChips(); return; }
      const add = e.target.closest("[data-add-chip]");
      if (add) {
        const v = await promptModal({ title: "自定义风格标签", placeholder: "例如：胶片质感风 / 奶油暖色风" });
        if (!v) return;
        acc.customStyleChips = acc.customStyleChips || [];
        if (!acc.customStyleChips.includes(v) && !STYLE_CHIP_BASE.includes(v)) acc.customStyleChips.push(v);
        save("accounts"); renderChips();
        return;
      }
      const c = e.target.closest("[data-style]");
      if (!c) return;
      if (acc.lockedStyle) { toast("已锁定风格，先解锁"); return; }
      const tag = c.dataset.style;
      const cur = $("#csStyle", root).value.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
      const i = cur.indexOf(tag);
      i >= 0 ? cur.splice(i, 1) : cur.push(tag);
      $("#csStyle", root).value = cur.join("、");
      A.style = cur.join("、"); save("productions");
      renderChips();
    });
  } else {
    $("#csAddShot", root).addEventListener("click", () => {
      A.shots = A.shots || [];
      const n = A.shots.length;
      A.shots.push({ time: `${n * 3}-${n * 3 + 3}s`, idea: "", visual: "", line: "" });
      save("productions"); renderTable(); renderStruct();
    });
  }

  $("#csGen", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
    const topic = $("#csTopic", root).value.trim() || "Dumate 功能演示";
    p.topic = topic;
    const res = await AI.generateScript({
      topic, duration: isImg ? 0 : 30, account: acc, image: isImg,
      style: isImg ? ($("#csStyle", root)?.value.trim() || "") : "",
      imageCount: A.imageCount || 6
    });
    A.shots = res.shots || [];
    A.title = res.title || topic;
    A.source = AI.lastSource;
    p.title = res.title || topic;
    if (!isImg) normalizeVideoTimes(A.shots);
    if (p.stage === "script") p.stageStatus = "done";
    save("productions");
    renderScriptPage(root, p);
    toast(AI.sourceNote(isImg ? "已生成笔记图卡脚本" : "DeepSeek 已生成分镜脚本"));
  }, "生成中…"));

  $("#csOpt", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
    if (!(A.shots || []).length) { toast("先生成脚本"); return; }
    const direction = $("#csOptDir", root).value.trim();
    if (!direction) { toast("请填写优化方向"); return; }
    const res = await AI.optimizeScript({ shots: A.shots, direction, account: acc, image: isImg });
    A.shots = res.shots || A.shots;
    if (res.title) { A.title = res.title; p.title = res.title; }
    save("productions");
    renderTable(); renderStruct();
    $("#csOptDir", root).value = "";
    toast(AI.sourceNote("脚本已按方向优化"));
  }, "优化中…"));

  $("#csNext", root).addEventListener("click", () => {
    if (!(A.shots || []).length) { toast("先生成脚本再进入下一步"); return; }
    const next = isImg ? "images" : "boards";
    if (p.stage === "script") {
      // 初始化槽位
      const key = isImg ? "images" : "boards";
      if (!(p.artifacts[key].items || []).length) {
        p.artifacts[key].items = A.shots.map((s, i) => ({ title: s.idea || `${isImg ? "图" : "分镜"}${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle" }));
      }
      setStage(p, next, "needs_input");
    }
    go("studio", next);
  });
}

const STAGES_LABEL = isImg => isImg ? "图文链路 · 脚本" : "视频链路 · 脚本";
