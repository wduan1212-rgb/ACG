/* 链路 · 分镜（视频）/ 成图（图文）页：统一参考图 + 逐张提示词 + 站外整段回传
   图片 API 未接入：站内生成走模拟引擎占位，真实出图依赖站外回传 */

import { $, $$, esc, gradFor, copyText, fileToDataUrl, wireDropZone } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById } from "../core/store.js";
import { AI } from "../api/ai.js";
import { buildSbExternalPrompt, buildImgExternalPrompt } from "../api/prompts.js";
import { setStage, shotsToText } from "../domain/productions.js";
import { accountAssets } from "../domain/accounts.js";
import { urlFor, thumbHtml, addAssetFromDataUrl, replaceAssetBlob } from "../domain/assets.js";
import { imageApiConfigured } from "../api/providers.js";
import { maybeAdvanceAfterInput } from "../agent/orchestrator.js";
import { toast, withLoading, openLightbox } from "../ui/components.js";
import { go } from "../core/router.js";
import { stepperHtml, wireStepper } from "./studio.js";

const modeBySlot = new Map(); // productionId -> "in" | "out"

export function renderSlotsPage(root, p, isImg) {
  const acc = accountById(p.accountId);
  const A = isImg ? p.artifacts.images : p.artifacts.boards;
  const page = isImg ? "images" : "boards";
  let genMode = modeBySlot.get(p.id) || "out";

  // 槽位缺失时按脚本初始化
  if (!(A.items || []).length && (p.artifacts.script.shots || []).length) {
    A.items = p.artifacts.script.shots.map((s, i) => ({ title: s.idea || `${isImg ? "图" : "分镜"}${i + 1}`, visual: s.visual || "", prompt: "", assetId: null, status: "idle" }));
    save("productions");
  }

  const draw = () => {
    const items = A.items || [];
    const got = items.filter(x => x.assetId).length;
    const sharedRef = A.sharedRefAssetId ? state.assets.find(x => x.id === A.sharedRefAssetId) : null;
    root.innerHTML = `
      ${stepperHtml(p, page)}
      <div class="chain-page solo">
        <div class="chain-main">
          <div class="page-head">
            <div><div class="eyebrow">${isImg ? "图文链路 · 成图" : "视频链路 · 分镜图"}</div>
            <h2>${isImg ? "小红书笔记风 · 逐张出图回传" : "按脚本逐镜头出分镜图"} <span class="head-count">${got}/${items.length}</span></h2></div>
            <div class="head-actions">
              ${isImg ? "" : `<button class="btn ghost" id="cbSkip">跳过此步 ${icon("arrowRight", 13)}</button>`}
              <button class="btn primary" id="cbNext">下一步：${isImg ? "文案" : "提示词"} ${icon("arrowRight", 14)}</button>
            </div>
          </div>

          <div class="refbar card" id="cbRefbar">
            <div class="refbar-left">
              <b>${icon("star", 13)} 统一参考图</b>
              <em>每张图生成 / 站外出图都带上它（logo / 角色版 / 界面截图）· 可拖图到此</em>
            </div>
            <div class="refbar-chip">${sharedRef
              ? `<span class="ref-chip">${thumbHtml(sharedRef)}<span>${esc(sharedRef.name)}</span><button class="ref-x" id="cbRefClear">${icon("x", 11)}</button></span>`
              : `<span class="muted">未设置（建议）</span>`}</div>
            <div class="refbar-actions">
              <button class="btn ghost sm" id="cbRefPick">从资产选择</button>
              <label class="btn ghost sm">上传<input type="file" accept="image/*" hidden id="cbRefUp" /></label>
            </div>
          </div>
          <div id="cbRefChooser" class="ref-chooser card" hidden></div>

          <div class="mode-tabs" data-active="${genMode}">
            <button class="mode-tab ${genMode === "out" ? "is-active" : ""}" data-mode="out">站外出图<span>整段提示词 · 第三方生成回传</span></button>
            <button class="mode-tab ${genMode === "in" ? "is-active" : ""}" data-mode="in">站内生成<span>${imageApiConfigured() ? "已接图片 API" : "图片 API 未接 · 模拟占位"}</span></button>
          </div>

          ${genMode === "out" ? `
          <div class="external-panel card">
            <div class="ep-head">
              <div><b>一整段可复制提示词</b><em class="muted">复制后配合参考图粘贴到第三方图片模型（即梦 / Midjourney 等）</em></div>
              <div class="head-actions">
                <button class="btn ghost sm" id="cbEpRefresh">${icon("refresh", 13)} 按脚本重组</button>
                <button class="btn primary sm" id="cbEpCopy">${icon("copy", 13)} 复制整段</button>
              </div>
            </div>
            <div class="ep-prompt" id="cbEpText" contenteditable="true">${esc(A.externalPrompt || "")}</div>
            <div class="ep-return" id="cbDrop">
              <div class="epd-core">${icon("upload", 20)}</div>
              <div class="epd-text"><b>等待回传<i class="dots"><i>.</i><i>.</i><i>.</i></i></b><em>把生成的图拖进来或点击选择（多选）· 按顺序对应${isImg ? "图" : "分镜"} 1、2、3…并自动入库</em></div>
              <input type="file" accept="image/*" multiple hidden id="cbDropInput" />
            </div>
          </div>` : `
          <div class="inhouse-controls">
            <button class="btn gen" id="cbGenPrompts">${icon("spark", 15)} 按脚本生成${isImg ? "图片" : "分镜图"}提示词</button>
            <span class="muted">${imageApiConfigured() ? "" : "图片 API 未接入：站内「生成」为模拟占位，建议用站外出图回传真实图片"}</span>
          </div>`}

          <div class="slot-cards" id="cbCards">${items.map((it, i) => slotCard(it, i, isImg)).join("") ||
            `<div class="empty-state slim">${icon("image", 22)}<b>先回脚本页生成脚本</b><p>每${isImg ? "张图" : "个镜头"}会在这里生成一个出图槽位</p></div>`}</div>
        </div>
      </div>`;
    wireStepper(root);
    wire();
  };

  function slotCard(it, i, img) {
    const u = it.assetId ? urlFor(it.assetId) : null;
    return `<div class="slot-card card" data-slot="${i}">
      <span class="sc-num">${i + 1}</span>
      <div class="sc-text">
        <div class="sc-line">${esc(it.title || "")}<em>${esc((it.visual || "").slice(0, 60))}</em></div>
        <div class="sc-prompt" contenteditable="true" data-prompt="${i}" data-ph="${genMode === "in" ? "点上方按钮生成提示词，或手写" : "（站外模式以整段提示词为准，可单独补充）"}">${esc(it.prompt || "")}</div>
      </div>
      <div class="sc-thumb" data-thumb="${i}">
        ${u ? `<img src="${u}"/>` : it.status === "loading"
          ? `<div class="sc-loading"><span class="spin-dot"></span></div>`
          : it.status === "done" ? `<div class="ph" style="background:${gradFor(it.prompt || i)}"><span>模拟 ${i + 1}</span></div>`
          : `<div class="sc-empty">待出图</div>`}
      </div>
      <div class="sc-side">
        ${genMode === "in" ? `<button class="btn ghost sm" data-gen="${i}">${u || it.status === "done" ? "重生成" : "生成此图"}</button>` : ""}
        <label class="btn ghost sm">上传<input type="file" accept="image/*" hidden data-up="${i}" /></label>
      </div>
    </div>`;
  }

  function wire() {
    // 模式切换
    $$(".mode-tab", root).forEach(t => t.addEventListener("click", () => {
      genMode = t.dataset.mode; modeBySlot.set(p.id, genMode);
      if (genMode === "out" && !A.externalPrompt) rebuildExternal();
      draw();
    }));

    // 统一参考
    const refbar = $("#cbRefbar", root);
    wireDropZone(refbar, async files => { await setRefFromFile(files[0]); });
    const clear = $("#cbRefClear", root);
    if (clear) clear.addEventListener("click", () => { A.sharedRefAssetId = null; save("productions"); draw(); });
    $("#cbRefUp", root).addEventListener("change", async e => { if (e.target.files[0]) await setRefFromFile(e.target.files[0]); });
    $("#cbRefPick", root).addEventListener("click", () => {
      const box = $("#cbRefChooser", root);
      if (!box.hidden) { box.hidden = true; return; }
      const assets = accountAssets(acc.id).filter(a => a.type === "图片");
      box.innerHTML = assets.length ? `<div class="ref-grid">${assets.map(a => `
        <button class="ref-item" data-ref="${a.id}">${thumbHtml(a)}<span>${esc(a.name)}</span></button>`).join("")}</div>`
        : `<div class="muted" style="padding:10px">该账号还没有图片资产，先上传一张</div>`;
      box.hidden = false;
      box.querySelectorAll("[data-ref]").forEach(b => b.addEventListener("click", () => {
        A.sharedRefAssetId = b.dataset.ref; save("productions"); draw();
      }));
    });

    async function setRefFromFile(f) {
      if (!f || !f.type.startsWith("image/")) return;
      const dataUrl = await fileToDataUrl(f);
      const a = await addAssetFromDataUrl(acc.id, { name: f.name.replace(/\.[^.]+$/, ""), tags: ["参考图"], dataUrl });
      A.sharedRefAssetId = a.id; save("productions");
      toast("已设为统一参考图：" + a.name);
      draw();
    }

    // 站外面板
    if (genMode === "out") {
      $("#cbEpRefresh", root).addEventListener("click", () => { rebuildExternal(); draw(); toast("已按当前脚本重新组装"); });
      $("#cbEpCopy", root).addEventListener("click", () => copyText($("#cbEpText", root).textContent, "已复制整段提示词，去第三方模型粘贴即可"));
      $("#cbEpText", root).addEventListener("blur", () => { A.externalPrompt = $("#cbEpText", root).textContent; save("productions"); });
      const dz = $("#cbDrop", root);
      wireDropZone(dz, files => handleReturn(files));
      dz.addEventListener("click", () => $("#cbDropInput", root).click());
      $("#cbDropInput", root).addEventListener("change", e => { handleReturn(e.target.files); e.target.value = ""; });
    } else {
      $("#cbGenPrompts", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
        const shots = p.artifacts.script.shots || [];
        if (!shots.length) { toast("先回脚本页生成脚本"); return; }
        const sharedRef = A.sharedRefAssetId ? state.assets.find(x => x.id === A.sharedRefAssetId) : null;
        if (isImg) {
          const res = await AI.generateImagePrompts({ script: shotsToText(shots, true), account: acc, style: p.artifacts.script.style });
          A.items = (res.shots || []).map((s, i) => ({
            title: s.title || `图${i + 1}`, visual: (shots[i] || {}).visual || "", prompt: s.prompt || "", ui: !!s.ui,
            assetId: (A.items[i] || {}).assetId || null, status: (A.items[i] || {}).assetId ? "done" : "idle"
          }));
        } else {
          const res = await AI.generateStoryboardPrompts({ shots, account: acc, style: p.artifacts.script.style, sharedRefName: sharedRef?.name });
          A.items = shots.map((s, i) => ({
            title: s.idea || `分镜${i + 1}`, visual: s.visual || "",
            prompt: (res.shots[i] || {}).prompt || AI.fallbackStoryboardPrompt(s, acc, p.artifacts.script.style, sharedRef?.name),
            assetId: (A.items[i] || {}).assetId || null, status: (A.items[i] || {}).assetId ? "done" : "idle"
          }));
        }
        save("productions");
        draw();
        toast(AI.sourceNote(`已生成 ${A.items.length} 条提示词`));
      }, "生成中…"));
    }

    // 槽位编辑/上传/站内生成
    $$("[data-prompt]", root).forEach(el => el.addEventListener("blur", () => {
      const it = A.items[+el.dataset.prompt];
      if (it) { it.prompt = el.textContent.trim(); save("productions"); }
    }));
    $$("[data-up]", root).forEach(inp => inp.addEventListener("change", async e => {
      const f = e.target.files[0]; if (!f) return;
      await fillSlot(+inp.dataset.up, f);
      draw();
    }));
    $$("[data-gen]", root).forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.gen;
      const it = A.items[i];
      it.status = "loading"; draw();
      await new Promise(r => setTimeout(r, 1200 + Math.random() * 900));
      it.status = "done"; // 图片 API 未接入：占位完成（不产生 assetId，不计入回传进度）
      save("productions"); draw();
      toast(imageApiConfigured() ? `第 ${i + 1} 张已生成` : `第 ${i + 1} 张为模拟占位（接入图片 API 后即为真图）`);
    }));
    $$(".sc-thumb img", root).forEach(im => im.addEventListener("click", () => openLightbox(im, im.src, "")));

    // 下一步
    $("#cbNext", root).addEventListener("click", () => {
      const items = A.items || [];
      const got = items.filter(x => x.assetId).length;
      if (isImg) {
        if (!got) { toast("还没有回传任何成图（至少回传 1 张）"); return; }
        if (p.stage === "images") setStage(p, "copy", "pending");
        go("studio", "copy");
      } else {
        if (p.stage === "boards" && got === items.length && items.length) maybeAdvanceAfterInput(p);
        else if (p.stage === "boards") setStage(p, "prompts", (p.artifacts.prompts || []).length ? "done" : "pending");
        go("studio", "prompts");
      }
    });
    const skip = $("#cbSkip", root);
    if (skip) skip.addEventListener("click", () => {
      if (p.stage === "boards") setStage(p, "prompts", "pending");
      go("studio", "prompts");
    });
  }

  async function fillSlot(i, file) {
    const it = A.items[i]; if (!it) return;
    const dataUrl = await fileToDataUrl(file);
    if (it.assetId) {
      await replaceAssetBlob(it.assetId, dataUrl);
    } else {
      const a = await addAssetFromDataUrl(acc.id, {
        name: `${isImg ? "笔记图" : "分镜图"}${String(i + 1).padStart(2, "0")}_${(p.title || p.topic || "").slice(0, 6)}`,
        tags: [isImg ? "笔记图" : "分镜图"], dataUrl
      });
      it.assetId = a.id;
    }
    it.status = "done";
    save("productions");
    const complete = (A.items || []).every(x => x.assetId);
    if (complete && p.stageStatus === "needs_input") maybeAdvanceAfterInput(p);
    toast(`已回传 ${i + 1}/${A.items.length}${complete ? " ✓ 全部就位" : ""}`);
  }

  async function handleReturn(files) {
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    for (const f of imgs) {
      const slot = (A.items || []).findIndex(x => !x.assetId);
      if (slot < 0) {
        const dataUrl = await fileToDataUrl(f);
        await addAssetFromDataUrl(acc.id, { name: `站外${isImg ? "笔记图" : "分镜"}_${f.name.replace(/\.[^.]+$/, "").slice(0, 10)}`, tags: [isImg ? "笔记图" : "分镜图", "站外生成"], dataUrl });
      } else {
        await fillSlot(slot, f);
      }
    }
    draw();
  }

  function rebuildExternal() {
    const shots = p.artifacts.script.shots || [];
    const sharedRef = A.sharedRefAssetId ? state.assets.find(x => x.id === A.sharedRefAssetId) : null;
    A.externalPrompt = isImg
      ? buildImgExternalPrompt({ topic: p.topic, position: acc.position, shots, items: (A.items || []).filter(x => x.prompt), style: p.artifacts.script.style, refNames: sharedRef ? [sharedRef.name] : [] })
      : buildSbExternalPrompt({ shots, boards: (A.items || []).filter(x => x.prompt), style: p.artifacts.script.style, sharedRefName: sharedRef?.name });
    save("productions");
  }

  if (!A.externalPrompt && (p.artifacts.script.shots || []).length) rebuildExternal();
  draw();
}
