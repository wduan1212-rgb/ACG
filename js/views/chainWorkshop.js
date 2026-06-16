/* 链路 · 分镜工坊（素材号专属一体节点）：
   按场景合并的「分镜单元」——一个单元 = 一条多镜头视频片段
   含产品界面/logo/中文(i2v)：图片提示词 → 出图/上传 → 视频提示词(呼应图片) → 图生视频
   纯场景(t2v)：直接文生视频，可选加参考图
   顶部统一参考图(所有单元共用 logo/产品界面)；每个单元可单独加定制参考 */

import { $, $$, esc, gradFor, copyText, fileToDataUrl, wireDropZone, fmtTC } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, on, accountById } from "../core/store.js";
import { AI } from "../api/ai.js";
import { buildSbExternalGroups } from "../api/prompts.js";
import { estimateAudio, setStage, setStatus, jobsOf, rebindUnitClip, autoAssemble, buildMaterialUnits, materialUnits, unitShots } from "../domain/productions.js";
import { urlFor, addAssetFromDataUrl, replaceAssetBlob, thumbHtml } from "../domain/assets.js";
import { createUnitVideoJobs } from "../agent/orchestrator.js";
import { imageApiConfigured } from "../api/providers.js";
import { toast, withLoading, openLightbox } from "../ui/components.js";
import { go, currentRoute } from "../core/router.js";
import { stepperHtml, wireStepper } from "./studio.js";
import { accountAssets as accAssets } from "../domain/accounts.js";

let liveRoot = null, liveProd = null, liveDraw = null, wired = false;

export function renderWorkshopPage(root, p) {
  liveRoot = root; liveProd = p;
  const acc = accountById(p.accountId);
  const A = p.artifacts.boards;
  const shots = p.artifacts.script.shots || [];

  // 估时兜底 + 单元构建
  if (!(p.artifacts.audio.perShot || []).length && shots.length) {
    Object.assign(p.artifacts.audio, estimateAudio(shots), { source: p.artifacts.audio.source || "estimate" });
    save("productions");
  }
  if (!(A.units || []).length && shots.length) { buildMaterialUnits(p); save("productions"); }

  const jobOfUnit = i => {
    const list = state.jobs.filter(j => j.productionId === p.id && j.segIndex === i).sort((a, b) => a.createdAt - b.createdAt);
    return list[list.length - 1] || null;
  };

  const draw = () => {
    liveDraw = draw;
    const units = materialUnits(p);
    const okCount = units.filter((u, i) => jobOfUnit(i)?.status === "succeeded").length;
    const running = units.some((u, i) => ["queued", "submitted", "running"].includes(jobOfUnit(i)?.status || ""));
    const i2v = units.filter(u => u.needsImage).length;
    const sharedRef = A.sharedRefAssetId ? state.assets.find(x => x.id === A.sharedRefAssetId) : null;
    root.innerHTML = `
      ${stepperHtml(p, "workshop")}
      <div class="chain-page solo">
        <div class="chain-main">
          <div class="page-head">
            <div><div class="eyebrow">素材链路 · 分镜工坊</div>
            <h2>${units.length} 个分镜单元 · 智能编排出片 <span class="head-count">${okCount}/${units.length} 就绪</span></h2></div>
            <div class="head-actions">
              <span class="tag">${icon("mic", 11)} 口播 ${fmtTC(p.artifacts.audio.duration || 0)}</span>
              <span class="tag">${icon("layers", 11)} 文生 ${units.length - i2v} · 图生 ${i2v}</span>
              <button class="btn primary" id="wsNext">下一步：智能混剪 ${icon("arrowRight", 14)}</button>
            </div>
          </div>

          <div class="refbar card" id="wsRefbar">
            <div class="refbar-left">
              <b>${icon("star", 13)} 统一参考图</b>
              <em>所有需出图的分镜都参考它（通常是 logo / 产品界面）· 可拖图到此</em>
            </div>
            <div class="refbar-chip">${sharedRef
              ? `<span class="ref-chip">${thumbHtml(sharedRef)}<span>${esc(sharedRef.name)}</span><button class="ref-x" id="wsRefClear">${icon("x", 11)}</button></span>`
              : `<span class="muted">未设置</span>`}</div>
            <div class="refbar-actions">
              <button class="btn ghost sm" id="wsRefPick">从资产选择</button>
              <label class="btn ghost sm">上传<input type="file" accept="image/*" hidden id="wsRefUp" /></label>
            </div>
          </div>
          <div id="wsRefChooser" class="ref-chooser card" hidden></div>

          <div class="inhouse-controls">
            <button class="btn gen" id="wsAuto">${icon("spark", 15)} ${running ? "生成中…" : okCount === units.length && units.length ? "全部片段已就绪" : "一键全自动编排出片"}</button>
            <button class="btn ghost" id="wsGenPrompts">${icon("list", 14)} 仅生成提示词</button>
            <span class="muted">含界面/logo/中文的单元走「图生视频」需先出图，其余纯场景直接「文生视频」</span>
          </div>

          <div class="ws-cards" id="wsCards">
            ${units.map((u, i) => unitCard(u, i, jobOfUnit(i))).join("") ||
              `<div class="empty-state slim">${icon("layers", 22)}<b>先回脚本页生成脚本</b><p>会按场景把连贯镜头合并成分镜单元</p></div>`}
          </div>
        </div>
      </div>`;
    wireStepper(root);
    wire();
  };

  function unitCard(u, i, job) {
    const us = unitShots(p, u);
    const isI2V = u.needsImage;
    const imgU = u.imageAssetId ? urlFor(u.imageAssetId) : null;
    const dur = Math.min(15, Math.ceil(u.dur || 4));
    const ok = job && job.status === "succeeded";
    const partLabel = u.sceneParts > 1 ? `·${u.part}` : "";
    let jobHtml = "";
    if (!job) jobHtml = `<button class="btn ghost sm" data-wsgen="${i}">${icon("film", 13)} 生成视频</button>`;
    else if (["queued", "submitted", "running"].includes(job.status))
      jobHtml = `<div class="wsj run"><span class="spin-dot"></span> ${job.status === "queued" ? "排队中" : `渲染 ${job.progress}%`}<i class="wsj-bar"><b style="width:${job.progress}%"></b></i></div>`;
    else if (ok)
      jobHtml = `<div class="wsj ok">${icon("checkCircle", 13)} 片段就绪 · ${dur}s</div>`;
    else
      jobHtml = `<div class="wsj fail">${icon("alert", 13)} ${esc((job.error || "失败").slice(0, 18))}<button class="link-btn" data-wsgen="${i}">${icon("refresh", 11)} 重试</button></div>`;

    return `<div class="ws-card card ${isI2V ? "i2v" : "t2v"}" data-ws="${i}">
      <div class="ws-head">
        <span class="sc-num">S${String(u.scene).padStart(2, "0")}${partLabel}</span>
        <b>${us.length > 1 ? `连贯 ${us.length} 镜` : esc(us[0]?.idea || "分镜")}</b>
        <span class="ws-mode ${isI2V ? "i2v" : "t2v"}">${isI2V ? icon("image", 11) + " 图生视频" : icon("film", 11) + " 文生视频"}</span>
        <span class="ws-dur ${u.dur >= 15 ? "cap" : ""}">${icon("clock", 11)} ${dur}s${u.sceneParts > 1 ? " · 已按15s拆分" : ""}</span>
      </div>
      <div class="ws-align">
        <div class="ws-al-head">${icon("mic", 11)} 口播 ↔ 画面对齐 <em class="muted">混剪时字幕按此逐句对齐</em></div>
        ${alignRows(u, us)}
      </div>
      <div class="ws-body ${isI2V ? "" : "single"} ${ok ? "has-prev" : ""}">
        ${isI2V ? `
        <div class="ws-col">
          <div class="ws-label">① 分镜图提示词 <em class="muted">先出图，视频呼应它</em></div>
          <div class="sc-prompt" contenteditable="true" data-wsimgp="${i}" data-ph="点上方「仅生成提示词」自动填入">${esc(u.imagePrompt || "")}</div>
          <div class="ws-thumbrow">
            <div class="ws-thumb">${imgU ? `<img src="${imgU}" data-wsimg/>` : u.status === "loading" ? `<span class="spin-dot"></span>` : `<span class="ws-thumb-ph">分镜图</span>`}</div>
            <button class="btn ghost sm" data-wsimg-gen="${i}">${imgU ? "重出图" : "出图"}${imageApiConfigured() ? "" : "·模拟"}</button>
            <label class="btn ghost sm">上传<input type="file" accept="image/*" hidden data-wsup="${i}" /></label>
          </div>
        </div>` : ""}
        <div class="ws-col">
          <div class="ws-label">${isI2V ? "②" : ""} 视频提示词 <em class="muted">${us.length > 1 ? "多镜头连贯 · " : ""}含运镜，自动带无口播/无BGM负面词</em></div>
          <div class="sc-prompt" contenteditable="true" data-wsv="${i}" data-ph="点上方「仅生成提示词」自动填入">${esc(u.videoPrompt || "")}</div>
          <div class="ws-jobrow">${jobHtml}</div>
        </div>
        ${ok ? `
        <div class="ws-col ws-prevcol">
          <div class="ws-label">成片预览 <em class="muted">示意首帧</em></div>
          <div class="ws-prev-frame" data-wsprev="${i}" style="background:${imgU ? "#0a0e1a" : gradFor(u.videoPrompt || ("S" + u.scene))}">
            ${imgU ? `<img src="${imgU}"/>` : ""}<span class="ws-prev-play">${icon("play", 18)}</span><span class="ws-prev-dur">${dur}s</span>
          </div>
          <div class="ws-prev-acts">
            <button class="btn ghost sm" data-wsgen="${i}">${icon("refresh", 11)} 重生成</button>
            ${isI2V ? `<label class="btn ghost sm">${icon("upload", 11)} 换图<input type="file" accept="image/*" hidden data-wsup="${i}" /></label>` : ""}
          </div>
        </div>` : ""}
      </div>
    </div>`;
  }

  /* 口播↔画面对齐：每镜的时间区间 + 口播原句 + 画面要点（单元内累计计时） */
  function alignRows(u, us) {
    const per = p.artifacts.audio.perShot || [];
    let t = 0;
    return (u.shotIndexes || []).map((si, k) => {
      const s = us[k] || {};
      const d = (per[si] && per[si].dur) || 3;
      const a = t, b = t + d; t = b;
      return `<div class="ws-al"><em>${a.toFixed(1)}-${b.toFixed(1)}s</em><b>${esc((s.line || "").trim() || "（无口播）")}</b><span>${esc((s.visual || s.idea || "").slice(0, 38))}</span></div>`;
    }).join("");
  }

  async function ensurePrompts(force = false) {
    const units = materialUnits(p);
    if (!force && units.every(u => u.videoPrompt && (!u.needsImage || u.imagePrompt))) return;
    const res = await AI.generateUnitPrompts({ units, shots, account: acc, style: p.artifacts.script.style });
    units.forEach((u, i) => {
      const r = res.units[i] || {};
      if (force || !u.videoPrompt) u.videoPrompt = r.videoPrompt || u.videoPrompt;
      if (u.needsImage && (force || !u.imagePrompt)) u.imagePrompt = r.imagePrompt || u.imagePrompt;
    });
    save("productions");
  }

  function wire() {
    // 统一参考图
    const refbar = $("#wsRefbar", root);
    wireDropZone(refbar, async files => { await setSharedRef(files[0]); });
    const clr = $("#wsRefClear", root);
    if (clr) clr.addEventListener("click", () => { A.sharedRefAssetId = null; save("productions"); draw(); });
    $("#wsRefUp", root).addEventListener("change", async e => { if (e.target.files[0]) await setSharedRef(e.target.files[0]); });
    $("#wsRefPick", root).addEventListener("click", () => {
      const box = $("#wsRefChooser", root);
      if (!box.hidden) { box.hidden = true; return; }
      const assets = accAssets(acc.id).filter(a => a.type === "图片");
      box.innerHTML = assets.length ? `<div class="ref-grid">${assets.map(a => `<button class="ref-item" data-ref="${a.id}">${thumbHtml(a)}<span>${esc(a.name)}</span></button>`).join("")}</div>`
        : `<div class="muted" style="padding:10px">该账号还没有图片资产</div>`;
      box.hidden = false;
      box.querySelectorAll("[data-ref]").forEach(b => b.addEventListener("click", () => { A.sharedRefAssetId = b.dataset.ref; save("productions"); draw(); }));
    });
    async function setSharedRef(f) {
      if (!f || !f.type.startsWith("image/")) return;
      const dataUrl = await fileToDataUrl(f);
      const a = await addAssetFromDataUrl(acc.id, { name: f.name.replace(/\.[^.]+$/, ""), tags: ["参考图"], dataUrl });
      A.sharedRefAssetId = a.id; save("productions"); toast("已设为统一参考图"); draw();
    }

    $("#wsAuto", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
      if (!shots.length) { toast("先回脚本页生成脚本"); return; }
      await ensurePrompts();
      const n = createUnitVideoJobs(p);
      if (p.stage === "workshop") setStatus(p, "running");
      toast(n ? `已派发 ${n} 个分镜单元（并发 2，其余排队）` : "所有单元都已就绪");
      draw();
    }, "起草中…"));

    $("#wsGenPrompts", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
      if (!shots.length) { toast("先回脚本页生成脚本"); return; }
      await ensurePrompts(true);
      draw();
      toast(AI.sourceNote("图片 + 视频提示词已生成"));
    }, "生成中…"));

    $$("[data-wsimgp]", root).forEach(el => el.addEventListener("blur", () => {
      const u = materialUnits(p)[+el.dataset.wsimgp]; if (u) { u.imagePrompt = el.textContent.trim(); save("productions"); }
    }));
    $$("[data-wsv]", root).forEach(el => el.addEventListener("blur", () => {
      const u = materialUnits(p)[+el.dataset.wsv]; if (u) { u.videoPrompt = el.textContent.trim(); save("productions"); }
    }));
    $$("[data-wsgen]", root).forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.wsgen;
      const u = materialUnits(p)[i];
      if (!u.videoPrompt) await ensurePrompts();
      if (!u.videoPrompt) { toast("先填写该单元的视频提示词"); return; }
      createUnitVideoJobs(p, i);
      if (p.stage === "workshop") setStatus(p, "running");
      draw();
    }));
    $$("[data-wsimg-gen]", root).forEach(b => b.addEventListener("click", async () => {
      const i = +b.dataset.wsimgGen;
      const u = materialUnits(p)[i];
      u.status = "loading"; draw();
      await new Promise(r => setTimeout(r, 1100 + Math.random() * 900));
      u.status = "done";
      save("productions"); draw();
      toast(imageApiConfigured() ? `场景 ${u.scene} 分镜图已生成` : `场景 ${u.scene} 为模拟占位（接图片 API 后即真图）`);
    }));
    $$("[data-wsup]", root).forEach(inp => inp.addEventListener("change", async e => {
      const i = +inp.dataset.wsup;
      const f = e.target.files[0]; if (!f) return;
      await fillUnitImage(i, f);
      draw();
    }));
    $$("[data-wsimg]", root).forEach(im => im.addEventListener("click", () => openLightbox(im, im.src, "")));
    // 成片预览：有首帧图就放大看示意首帧，否则提示接 API 后可播放
    $$("[data-wsprev]", root).forEach(el => el.addEventListener("click", () => {
      const u = materialUnits(p)[+el.dataset.wsprev];
      const img = el.querySelector("img");
      if (u && u.imageAssetId && img) openLightbox(img, urlFor(u.imageAssetId), `场景S${String(u.scene).padStart(2, "0")} · 成片首帧（示意）`);
      else toast("成片预览为示意首帧；接入视频 API 后可在此播放成片");
    }));
    // 单元卡拖图上传分镜图
    $$(".ws-card.i2v", root).forEach(card => wireDropZone(card, async files => {
      const f = Array.from(files).find(x => x.type.startsWith("image/"));
      if (f) { await fillUnitImage(+card.dataset.ws, f); draw(); }
    }));

    $("#wsNext", root).addEventListener("click", () => {
      const okCount = materialUnits(p).filter((u, i) => jobOfUnit(i)?.status === "succeeded").length;
      if (!okCount) { toast("还没有就绪片段：点「一键全自动」先生成"); return; }
      autoAssemble(p);
      if (p.stage === "workshop") setStage(p, "cut", "pending");
      go("studio", "cut");
    });
  }

  async function fillUnitImage(i, file) {
    const u = materialUnits(p)[i]; if (!u) return;
    const dataUrl = await fileToDataUrl(file);
    if (u.imageAssetId) await replaceAssetBlob(u.imageAssetId, dataUrl);
    else {
      const a = await addAssetFromDataUrl(p.accountId, { name: `分镜S${String(u.scene).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`, tags: ["分镜图"], dataUrl });
      u.imageAssetId = a.id;
    }
    u.status = "done";
    save("productions");
    toast(`场景 ${u.scene} 分镜图已就绪`);
  }

  if (!wired) {
    wired = true;
    on("job:update", j => {
      // 任务匹配才处理；成片回绑要照常发生（即使已离开工坊页，剪辑页才拿得到正确片段）
      if (!liveProd || j.productionId !== liveProd.id) return;
      if (j.status === "succeeded") rebindUnitClip(liveProd, j.segIndex, j);
      // 仅当「仍停在该任务的工坊页」才重渲染：否则会把已切换到的其它阶段页打回工坊（批量任务在跑时尤甚）
      if (document.body.dataset.zone !== "studio") return;
      if (currentRoute().page !== "workshop") return;
      if (liveProd.id !== state.ui.activeProductionId) return;
      (liveDraw || draw)();
    });
  }

  draw();
}
