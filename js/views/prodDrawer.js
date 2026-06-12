/* 任务详情抽屉：Agent 看板 / 创作空间 / 交付中心 共用的任务控制面板 */

import { esc, gradFor, copyText, fileToDataUrl, wireDropZone, $, $$ } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById, productionById } from "../core/store.js";
import { openDrawer, toast, confirmModal, promptModal, openLightbox } from "../ui/components.js";
import { STAGES, flowOf, setStage, setStatus, jobsOf } from "../domain/productions.js";
import { platChip } from "../domain/accounts.js";
import { urlFor } from "../domain/assets.js";
import { addAssetFromDataUrl } from "../domain/assets.js";
import { deliver } from "../domain/delivery.js";
import { maybeAdvanceAfterInput } from "../agent/orchestrator.js";
import { go } from "../core/router.js";

export async function rejectFlow(p) {
  const notes = await promptModal({ title: "驳回原因（会退回重做）", placeholder: "例如：第3张图文字乱码，重新出图" });
  if (notes == null) return false;
  const isImg = p.mode === "图文";
  p.review.state = "rejected";
  p.review.notes = notes;
  p.review.returnTo = isImg ? "images" : "boards";
  setStage(p, p.review.returnTo, "needs_input");
  toast("已驳回，任务退回「" + STAGES[p.review.returnTo].label + "」");
  return true;
}

export function approveProduction(p) {
  p.review.state = "approved";
  p.review.at = Date.now();
  save("productions");
}

export function openProductionDrawer(pid, tab) {
  const p = productionById(pid);
  if (!p) { toast("任务不存在"); return; }
  const isImg = p.mode === "图文";
  let curTab = tab || defaultTab(p);

  const { close } = openDrawer(`<div id="pdRoot"></div>`, {
    width: 640,
    onMount(panel) {
      const root = panel.querySelector("#pdRoot");
      const render = () => {
        const acc = accountById(p.accountId);
        const tabs = [
          ["script", "脚本"],
          [isImg ? "images" : "boards", isImg ? "成图" : "分镜"],
          ...(isImg ? [] : [["prompts", "提示词"], ["render", "成片"]]),
          ["copy", "文案"],
          ["review", "审核"]
        ];
        root.innerHTML = `
          <div class="pd-head">
            <div class="pd-title">
              <span class="dot lg" style="background:${gradFor(acc?.name || "")}"></span>
              <div><b>${esc(p.artifacts.copy.title || p.title || p.topic || "未命名任务")}</b>
              <em>${esc(acc?.name || "")} ${platChip(acc?.platform || "", true)} · ${p.mode}${p.origin === "agent" ? " · Agent 批次" : ""}</em></div>
            </div>
            <button class="icon-btn" data-close>${icon("x", 16)}</button>
          </div>
          <div class="pd-tabs">${tabs.map(([k, l]) => `<button class="pd-tab ${curTab === k ? "is-active" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>
          <div class="pd-body">${TAB[curTab] ? TAB[curTab](p) : ""}</div>
          <div class="pd-foot">
            <span class="muted">${p.error ? `⚠ ${esc(p.error)}` : ""}</span>
            <button class="btn ghost sm" data-pd="workbench">${icon("external", 14)} 进入完整工作台</button>
          </div>`;
        wire(root);
      };

      const wire = (rootEl) => {
        rootEl.querySelectorAll(".pd-tab").forEach(b => b.addEventListener("click", () => { curTab = b.dataset.tab; render(); }));
        // 进工作台
        const wb = rootEl.querySelector('[data-pd="workbench"]');
        if (wb) wb.addEventListener("click", () => {
          state.ui.activeAccountId = p.accountId;
          state.ui.activeProductionId = p.id;
          save("meta");
          close();
          go("studio", stagePage(p));
        });
        // 脚本编辑
        rootEl.querySelectorAll("[data-shot-field]").forEach(td => td.addEventListener("blur", () => {
          const i = +td.dataset.idx;
          const f = td.dataset.shotField;
          if (p.artifacts.script.shots[i]) { p.artifacts.script.shots[i][f] = td.textContent.trim(); save("productions"); }
        }));
        // 复制站外提示词
        const cp = rootEl.querySelector("[data-pd-copy]");
        if (cp) cp.addEventListener("click", () => {
          const txt = isImg ? p.artifacts.images.externalPrompt : p.artifacts.boards.externalPrompt;
          copyText(txt || "", "已复制整段提示词，去第三方模型粘贴即可");
        });
        // 槽位上传
        rootEl.querySelectorAll("[data-slot-up]").forEach(inp => inp.addEventListener("change", async e => {
          const i = +inp.dataset.slotUp;
          const f = e.target.files[0]; if (!f) return;
          await fillSlot(p, i, f);
          render();
        }));
        // 整体拖拽回传
        const dz = rootEl.querySelector("[data-pd-drop]");
        if (dz) {
          wireDropZone(dz, async files => {
            for (const f of Array.from(files).filter(x => x.type.startsWith("image/"))) await fillSlot(p, -1, f);
            render();
          });
          dz.addEventListener("click", e => {
            if (e.target.closest("img") || e.target.closest(".pd-slot")) return;
            const inp = dz.querySelector("[data-pd-drop-input]");
            if (inp) inp.click();
          });
          const inp = dz.querySelector("[data-pd-drop-input]");
          if (inp) inp.addEventListener("change", async e => {
            for (const f of Array.from(e.target.files)) await fillSlot(p, -1, f);
            render();
          });
        }
        // 槽位图放大
        rootEl.querySelectorAll(".pd-slot img").forEach(im => im.addEventListener("click", () => openLightbox(im, im.src, "")));
        // 文案编辑
        const t = rootEl.querySelector("#pdCopyTitle"), c = rootEl.querySelector("#pdCopyBody");
        if (t) t.addEventListener("input", () => { p.artifacts.copy.title = t.value; save("productions"); });
        if (c) c.addEventListener("input", () => { p.artifacts.copy.body = c.value; save("productions"); });
        // 审核操作
        const ap = rootEl.querySelector("[data-pd-approve]");
        if (ap) ap.addEventListener("click", () => { approveProduction(p); toast("已通过审核"); render(); });
        const rj = rootEl.querySelector("[data-pd-reject]");
        if (rj) rj.addEventListener("click", async () => { if (await rejectFlow(p)) render(); });
        const dl = rootEl.querySelector("[data-pd-deliver]");
        if (dl) dl.addEventListener("click", async () => {
          const ok = await confirmModal({ title: `确认交付「${p.artifacts.copy.title || p.title}」？`, body: "定稿入交付中心，供应商端可见可下载。", okText: "交付入库" });
          if (ok) { deliver(p); toast("已交付入库"); render(); }
        });
      };
      render();
    }
  });
}

function defaultTab(p) {
  if (p.stage === "review" || p.stage === "delivered") return "review";
  if (p.stage === "copy") return "copy";
  if (p.stage === "render" || p.stage === "cut") return "render";
  if (p.stage === "boards") return "boards";
  if (p.stage === "images") return "images";
  return "script";
}

export function stagePage(p) {
  const m = { script: "script", boards: "boards", images: "images", prompts: "prompts", render: "render", cut: "cut", copy: "copy", review: "review", delivered: "review" };
  return m[p.stage] || "script";
}

async function fillSlot(p, idx, file) {
  const isImg = p.mode === "图文";
  const items = isImg ? p.artifacts.images.items : p.artifacts.boards.items;
  let i = idx;
  if (i < 0) i = items.findIndex(x => !x.assetId);
  if (i < 0) i = items.length ? items.length - 1 : -1;
  if (i < 0) return;
  const dataUrl = await fileToDataUrl(file);
  const a = await addAssetFromDataUrl(p.accountId, {
    name: `${isImg ? "笔记图" : "分镜图"}${String(i + 1).padStart(2, "0")}_${(p.title || "").slice(0, 6)}`,
    tags: [isImg ? "笔记图" : "分镜图"], dataUrl
  });
  items[i].assetId = a.id;
  items[i].status = "done";
  save("productions");
  const complete = items.every(x => x.assetId);
  if (complete && p.stageStatus === "needs_input") maybeAdvanceAfterInput(p);
  toast(`已回传 ${isImg ? "图" : "分镜"} ${i + 1}/${items.length}${complete ? " ✓ 全部就位" : ""}`);
}

/* ---------- 各 Tab 内容 ---------- */
const TAB = {
  script(p) {
    const shots = p.artifacts.script.shots || [];
    const isImg = p.mode === "图文";
    if (!shots.length) return `<div class="pd-empty">${icon("fileText", 22)}<p>脚本还未生成${p.stageStatus === "running" ? "（起草中…）" : ""}</p></div>`;
    const cols = isImg ? [["idea", "核心思想"], ["visual", "画面"], ["line", "图上文案"]] : [["time", "时间"], ["idea", "核心思想"], ["visual", "画面"], ["line", "口播"]];
    return `<div class="pd-note">主题「${esc(p.topic)}」 · ${shots.length} ${isImg ? "张图卡" : "个镜头"} · 单元格可直接编辑${p.artifacts.script.source === "mock" ? ` · <i class="src-mock">本地模板</i>` : ""}</div>
    <table class="mini-table"><thead><tr><th>#</th>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead>
    <tbody>${shots.map((s, i) => `<tr><td class="c-idx">${i + 1}</td>${cols.map(c => `<td contenteditable="true" data-shot-field="${c[0]}" data-idx="${i}">${esc(s[c[0]] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  },

  boards(p) { return slotsTab(p, false); },
  images(p) { return slotsTab(p, true); },

  prompts(p) {
    const prompts = p.artifacts.prompts || [];
    if (!prompts.length) return `<div class="pd-empty">${icon("list", 22)}<p>提示词未生成</p></div>`;
    return prompts.map((sc, i) => `
      <div class="pd-prompt">
        <div class="pdp-head"><b>${esc(sc.name)}</b>${sc.ui ? `<span class="tag warn">含 UI 镜头</span>` : ""}</div>
        <div class="pdp-seg"><span class="t-tag front">第一段 0-15s</span><pre>${esc(sc.front || "")}</pre></div>
        ${sc.back ? `<div class="pdp-seg"><span class="t-tag back">第二段 0-15s</span><pre>${esc(sc.back)}</pre></div>` : ""}
      </div>`).join("");
  },

  render(p) {
    const jobs = jobsOf(p);
    const tl = p.artifacts.timeline || [];
    if (!jobs.length && !tl.length) return `<div class="pd-empty">${icon("film", 22)}<p>还没有渲染任务。分镜齐了之后由 Agent 派发，或进完整工作台手动生成。</p></div>`;
    return `
      ${jobs.length ? `<div class="pd-note">渲染任务 ${jobs.filter(j => j.status === "succeeded").length}/${jobs.length} 完成</div>
      <div class="pd-jobs">${jobs.map(j => `
        <div class="pdj ${j.status}">
          <b>${esc(j.segName || "Segment " + (j.segIndex + 1))}</b>
          <span class="pdj-bar"><i style="width:${j.progress}%"></i></span>
          <em>${{ queued: "排队中", submitted: "已提交", running: j.progress + "%", succeeded: "完成", failed: "失败", canceled: "已取消" }[j.status]}</em>
        </div>`).join("")}</div>` : ""}
      ${tl.length ? `<div class="pd-note" style="margin-top:10px">时间轴 ${tl.length} 段 · ${(p.artifacts.subs || []).filter(s => (s.text || "").trim()).length} 条字幕（已智能拼接，可进工作台精修）</div>` : ""}`;
  },

  copy(p) {
    return `
      <label class="field">标题<input id="pdCopyTitle" class="input" value="${esc(p.artifacts.copy.title || "")}" /></label>
      <label class="field">发布文案<textarea id="pdCopyBody" class="input" rows="10">${esc(p.artifacts.copy.body || "")}</textarea></label>
      <div class="pd-note">改动实时保存，交付时随包带出。</div>`;
  },

  review(p) {
    const r = p.review;
    if (p.stage === "delivered") {
      return `<div class="pd-review ok">${icon("checkCircle", 20)}<b>已交付</b><p>${esc(p.delivery?.name || "")} · 交付中心与供应商端可见</p></div>`;
    }
    return `
      <div class="pd-review">
        <div class="pdr-state ${r.state}">${r.state === "approved" ? icon("checkCircle", 16) + " 审核已通过，可交付" : r.state === "rejected" ? icon("alert", 16) + " 曾被驳回" : icon("eye", 16) + " 等待人工审核"}</div>
        ${r.notes ? `<div class="pdr-notes">驳回备注：${esc(r.notes)}</div>` : ""}
        <div class="pdr-sum">「${esc(p.artifacts.copy.title || p.title)}」 · ${p.mode === "图文" ? `${(p.artifacts.images.items || []).filter(x => x.assetId).length} 张组图打包 zip + 文案.txt` : `${(p.artifacts.timeline || []).length} 段成片拼接${(p.artifacts.subs || []).some(s => s.text) ? " + 字幕" : ""}`}</div>
        <div class="pdr-actions">
          ${p.stage === "review" && r.state !== "approved" ? `
            <button class="btn ghost" data-pd-reject>${icon("undo", 14)} 驳回重做</button>
            <button class="btn primary" data-pd-approve>${icon("check", 14)} 通过审核</button>` : ""}
          ${r.state === "approved" ? `<button class="btn primary" data-pd-deliver>${icon("package", 14)} 交付入库</button>` : ""}
          ${p.stage !== "review" && r.state !== "approved" ? `<span class="muted">当前在「${STAGES[p.stage].label}」阶段，完成后进入审核</span>` : ""}
        </div>
      </div>`;
  }
};

function slotsTab(p, isImg) {
  const A = isImg ? p.artifacts.images : p.artifacts.boards;
  const items = A.items || [];
  if (!items.length) return `<div class="pd-empty">${icon("image", 22)}<p>脚本起草后这里会列出${isImg ? "每张图" : "每个分镜"}的回传槽位</p></div>`;
  const got = items.filter(x => x.assetId).length;
  return `
    <div class="pd-note">站外出图回传 <b>${got}/${items.length}</b> · <button class="link-btn" data-pd-copy>${icon("copy", 13)} 复制整段提示词</button></div>
    <div class="pd-drop" data-pd-drop>
      ${icon("upload", 16)} 把图拖到这里按顺序分发（可多选）
      <input type="file" accept="image/*" multiple hidden data-pd-drop-input />
    </div>
    <div class="pd-slots">${items.map((it, i) => {
      const u = it.assetId ? urlFor(it.assetId) : null;
      return `<div class="pd-slot ${u ? "filled" : ""}">
        ${u ? `<img src="${u}"/>` : `<span class="pds-ph">${i + 1}</span>`}
        <div class="pds-cap"><b>${i + 1}. ${esc(it.title || (isImg ? "图" : "分镜") + (i + 1))}</b><em>${esc((it.visual || "").slice(0, 30))}</em></div>
        <label class="pds-up">${u ? "替换" : "上传"}<input type="file" accept="image/*" hidden data-slot-up="${i}" /></label>
      </div>`;
    }).join("")}</div>`;
}
