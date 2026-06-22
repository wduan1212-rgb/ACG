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
      <div class="ws-body ${isI2V ? "i2v" : "single"} ${ok ? "has-prev" : ""}">
        ${isI2V ? `
        <div class="ws-col">
          <div class="ws-label">① 分镜图提示词 <em class="muted">先出图，视频呼应它</em></div>
          <div class="sc-prompt" contenteditable="true" data-wsimgp="${i}" data-ph="点上方「仅生成提示词」自动填入">${esc(u.imagePrompt || "")}</div>
          <div class="ws-label" style="margin-top:9px">分镜参考图 <em class="muted">最多4张 · 拖到卡片任意处默认进这里</em></div>
          <div class="ws-refs">
            ${(u.refAssetIds || []).map((rid, k) => { const ru = urlFor(rid); return ru ? `<div class="ws-ref"><img src="${ru}" data-wsrefimg="${rid}"/><button class="ws-ref-x" data-wsrefdel="${i}:${k}" title="移除">${icon("x", 9)}</button></div>` : ""; }).join("")}
            ${(u.refAssetIds || []).length < 4 ? `<label class="ws-ref add" title="添加参考图（最多4张）">${icon("plus", 14)}<input type="file" accept="image/*" multiple hidden data-wsrefup="${i}" /></label>` : ""}
          </div>
        </div>
        <div class="ws-col ws-boardcol">
          <div class="ws-label">分镜图 <em class="muted">首帧定帧</em></div>
          <div class="ws-board-frame ${imgU ? "" : "empty"}" data-wsboard="${i}" style="${imgU ? "background:#0a0e1a" : ""}">
            ${imgU ? `<img src="${imgU}" data-wsimg/>` : u.status === "loading" ? `<span class="spin-dot"></span>` : `<span class="ws-board-ph">${icon("image", 18)}<em>拖图到此或点出图</em></span>`}
          </div>
          <div class="ws-board-acts">
            <button class="btn ghost sm" data-wsimg-gen="${i}">${imgU ? "重出图" : "出图"}</button>
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
      if (!u.imagePrompt) await ensurePrompts();
      u.status = "loading"; draw();
      await new Promise(r => setTimeout(r, 1100 + Math.random() * 900));
      const dataUrl = storyboardPlaceholderDataUrl(u, i);
      if (u.imageAssetId) await replaceAssetBlob(u.imageAssetId, dataUrl);
      else {
        const a = await addAssetFromDataUrl(p.accountId, {
          name: `分镜S${String(u.scene).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`,
          tags: ["分镜图", "出图槽位"],
          dataUrl
        });
        u.imageAssetId = a.id;
      }
      u.status = "done";
      save("productions"); draw();
      toast(`场景 ${u.scene} 分镜图已写入参考槽位`);
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
      else toast("成片预览已生成");
    }));
    // 拖到卡片任意处 → 默认收进「分镜参考图」（最多4张）
    $$(".ws-card.i2v", root).forEach(card => wireDropZone(card, async files => {
      await addUnitRefs(+card.dataset.ws, files); draw();
    }));
    // 只有拖到「分镜图」框才设为分镜图（stopPropagation 不会再冒泡到卡片收参考图）
    $$("[data-wsboard]", root).forEach(z => wireDropZone(z, async files => {
      const f = Array.from(files).find(x => x.type.startsWith("image/"));
      if (f) { await fillUnitImage(+z.dataset.wsboard, f); draw(); }
    }));
    // 分镜参考图：添加 / 删除 / 放大
    $$("[data-wsrefup]", root).forEach(inp => inp.addEventListener("change", async e => { await addUnitRefs(+inp.dataset.wsrefup, e.target.files); draw(); }));
    $$("[data-wsrefdel]", root).forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const [i2, k] = b.dataset.wsrefdel.split(":").map(Number);
      const u2 = materialUnits(p)[i2];
      if (u2 && u2.refAssetIds) { u2.refAssetIds.splice(k, 1); save("productions"); draw(); }
    }));
    $$("[data-wsrefimg]", root).forEach(im => im.addEventListener("click", () => openLightbox(im, im.src, "")));

    $("#wsNext", root).addEventListener("click", () => {
      const okCount = materialUnits(p).filter((u, i) => jobOfUnit(i)?.status === "succeeded").length;
      if (!okCount) { toast("还没有就绪片段：点「一键全自动」先生成"); return; }
      autoAssemble(p);
      if (p.stage === "workshop") setStage(p, "cut", "pending");
      go("studio", "cut");
    });
  }

  /* 分镜参考图：拖/选图入库，挂到 unit.refAssetIds（最多4张） */
  async function addUnitRefs(i, files) {
    const u = materialUnits(p)[i]; if (!u) return;
    u.refAssetIds = u.refAssetIds || [];
    const imgs = Array.from(files).filter(f => f.type.startsWith("image/"));
    let added = 0;
    for (const f of imgs) {
      if (u.refAssetIds.length >= 4) break;
      const dataUrl = await fileToDataUrl(f);
      const a = await addAssetFromDataUrl(p.accountId, { name: `参考S${String(u.scene).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`, tags: ["分镜参考图"], dataUrl });
      u.refAssetIds.push(a.id); added++;
    }
    if (added) { save("productions"); toast(`已添加 ${added} 张分镜参考图${u.refAssetIds.length >= 4 ? "（已满4张）" : ""}`); }
    else if (imgs.length) toast("分镜参考图最多 4 张");
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

  function storyboardPlaceholderDataUrl(u, i) {
    const us = unitShots(p, u);
    const title = `S${String(u.scene).padStart(2, "0")}${u.sceneParts > 1 ? " · P" + u.part : ""}`;
    const idea = (us[0]?.idea || p.title || "Dumate 分镜").slice(0, 18);
    const shotLines = us.map((s, k) => `${k + 1}. ${(s.visual || s.idea || "").slice(0, 26)}`).slice(0, 4);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f7fbff"/>
          <stop offset=".52" stop-color="#eef3ff"/>
          <stop offset="1" stop-color="#f8f7ff"/>
        </linearGradient>
        <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#3d5bff"/>
          <stop offset="1" stop-color="#8b5cf6"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#23345d" flood-opacity=".14"/>
        </filter>
      </defs>
      <rect width="720" height="1280" fill="url(#bg)"/>
      <circle cx="612" cy="148" r="88" fill="#dbeafe" opacity=".72"/>
      <circle cx="92" cy="1096" r="118" fill="#ede9fe" opacity=".72"/>
      <rect x="70" y="118" width="580" height="362" rx="32" fill="#ffffff" filter="url(#shadow)"/>
      <rect x="108" y="160" width="504" height="36" rx="18" fill="#edf2ff"/>
      <circle cx="132" cy="178" r="7" fill="#ff6b6b"/>
      <circle cx="154" cy="178" r="7" fill="#ffd43b"/>
      <circle cx="176" cy="178" r="7" fill="#51cf66"/>
      <rect x="112" y="230" width="188" height="168" rx="24" fill="url(#brand)" opacity=".94"/>
      <path d="M154 318h98M154 350h70M154 286h122" stroke="#fff" stroke-width="16" stroke-linecap="round" opacity=".92"/>
      <rect x="330" y="232" width="236" height="34" rx="17" fill="#dbe7ff"/>
      <rect x="330" y="292" width="190" height="28" rx="14" fill="#eef2ff"/>
      <rect x="330" y="342" width="218" height="28" rx="14" fill="#eef2ff"/>
      <rect x="330" y="392" width="148" height="28" rx="14" fill="#eef2ff"/>
      <rect x="70" y="532" width="580" height="520" rx="32" fill="#ffffff" filter="url(#shadow)"/>
      <text x="108" y="602" fill="#1f2a44" font-size="34" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Arial">${esc(title)} · ${esc(idea)}</text>
      <rect x="108" y="662" width="504" height="80" rx="24" fill="#f6f8ff"/>
      <rect x="136" y="692" width="260" height="20" rx="10" fill="#c7d2fe"/>
      <rect x="428" y="684" width="128" height="36" rx="18" fill="url(#brand)"/>
      <rect x="108" y="784" width="504" height="72" rx="24" fill="#f8fafc"/>
      <rect x="136" y="810" width="180" height="20" rx="10" fill="#dbe7ff"/>
      <rect x="108" y="884" width="504" height="72" rx="24" fill="#f8fafc"/>
      <rect x="136" y="910" width="230" height="20" rx="10" fill="#dbe7ff"/>
      <rect x="444" y="904" width="72" height="32" rx="16" fill="#dcfce7"/>
      <rect x="70" y="1104" width="580" height="96" rx="30" fill="#eef4ff"/>
      <text x="108" y="1152" fill="#3d5bff" font-size="24" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Arial">镜头依据</text>
      ${shotLines.slice(0, 2).map((line, idx) => `<text x="218" y="${1152 + idx * 34}" fill="#52617a" font-size="21" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Arial">${esc(line)}</text>`).join("")}
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
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
