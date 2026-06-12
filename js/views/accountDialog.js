/* 创建 / 编辑账号对话框：平台/形式/类型/定位/标签 + md 批量导入 + 数字人身份板（AI 提示词流） */

import { $, $$, esc, copyText, fileToDataUrl, todayStamp } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, accountById } from "../core/store.js";
import { TAG_POOL, platformCode, createAccount, updateAccount } from "../domain/accounts.js";
import { addAssetFromDataUrl } from "../domain/assets.js";
import { AI } from "../api/ai.js";
import { CHAR_DIR_POOL, buildCharBoardPrompt } from "../api/prompts.js";
import { openModal, toast } from "../ui/components.js";
import { go, render as routerRender } from "../core/router.js";

export function openAccountDialog(accountId = null) {
  const editing = accountId ? accountById(accountId) : null;
  const draft = {
    name: editing?.name || "",
    platform: editing?.platform || "小红书",
    mode: editing?.mode || "视频",
    subType: editing?.subType || "数字人",
    position: editing && editing.position !== "（待补充定位）" ? editing.position : "",
    qtags: new Set(editing?.qtags || []),
    charDataUrl: null,
    assets: [] // [{name, dataUrl}]
  };

  openModal(`<div id="adRoot"></div>`, {
    wide: true,
    onMount(panel, close) {
      const root = panel.querySelector("#adRoot");

      const draw = () => {
        const isVideo = draft.mode === "视频";
        const isDH = isVideo && draft.subType === "数字人";
        root.innerHTML = `
          <div class="mp-head">
            <div><div class="eyebrow">${editing ? "编辑账号" : "创建账号"}</div><b style="font-size:16px">${editing ? esc(editing.name) : "新建内容账号"}</b></div>
            <button class="icon-btn" data-close>${icon("x", 16)}</button>
          </div>
          <div class="ad-body">
            <div class="ad-grid">
              <label class="field">账号名称<input class="input" id="adName" value="${esc(draft.name)}" placeholder="例如：Dumate 图文教程 02" /></label>
              <label class="field">平台
                <div class="seg-group" id="adPlat">
                  ${["视频号", "小红书"].map(v => `<button type="button" class="${draft.platform === v ? "is-active" : ""}" data-v="${v}"><i class="seg-dot ${platformCode(v).toLowerCase()}"></i>${v}</button>`).join("")}
                </div>
              </label>
              <label class="field">内容形式
                <div class="seg-group" id="adMode">
                  ${[["视频", "film"], ["图文", "image"]].map(([v, ic]) => `<button type="button" class="${draft.mode === v ? "is-active" : ""}" data-v="${v}">${icon(ic, 14)}${v}</button>`).join("")}
                </div>
              </label>
              ${isVideo ? `<label class="field">视频类型
                <div class="seg-group" id="adSub">
                  <button type="button" class="${draft.subType === "数字人" ? "is-active" : ""}" data-v="数字人">${icon("user", 14)}数字人<span class="seg-sub">固定出镜口播</span></button>
                  <button type="button" class="${draft.subType === "无数字人" ? "is-active" : ""}" data-v="无数字人">${icon("layers", 14)}无数字人<span class="seg-sub">场景/界面混剪</span></button>
                </div>
              </label>` : ""}
              <label class="field full">账号定位<input class="input" id="adPos" value="${esc(draft.position)}" placeholder="例如：办公效率教程 / 产品功能讲解（人群方向也写在这里）" /></label>
              <div class="field full"><span>账号标签 <em class="muted">Agent 量产按标签选号，可多选</em></span>
                <div class="fb-row" id="adTags">${TAG_POOL.map(t => `<button class="chip ${draft.qtags.has(t) ? "on" : ""}" data-t="${t}">${t}</button>`).join("")}</div>
              </div>
            </div>

            ${isDH ? `
            <div class="ad-block">
              <div class="adb-head"><b>数字人参考</b><em class="muted">角色身份版用于生成时锁定人物形象</em></div>
              <div class="ad-char-row">
                <label class="btn ghost sm">${draft.charDataUrl || (editing && editing.charBoardAssetId) ? "✓ 已有角色版 · 点击更换" : "+ 上传角色参考版"}<input type="file" accept="image/*" hidden id="adCharUp" /></label>
                ${draft.charDataUrl ? `<img class="ad-char-prev" src="${draft.charDataUrl}"/>` : ""}
              </div>
              <div class="ad-ai-board">
                <div class="adb-head"><b>${icon("wand", 13)} 没有角色版？AI 生成一张身份板</b><em class="muted">随机方向 → 生成提示词 → 第三方出图 → 回传</em></div>
                <div class="ad-dir-row">
                  <button class="dice" id="adDirDice" title="随机角色风格方向">${icon("dice", 14)}</button>
                  <input class="input" id="adDirInput" placeholder="点骰子随机一个角色风格方向，可手改" />
                  <button class="btn ghost sm" id="adDirGo">生成提示词</button>
                </div>
                <pre class="ad-char-prompt" id="adCharPrompt" hidden></pre>
                <div class="head-actions" id="adCharActs" hidden>
                  <button class="btn ghost sm" id="adCharCopy">${icon("copy", 13)} 复制整段提示词</button>
                  <label class="btn primary sm">${icon("upload", 13)} 回传身份版<input type="file" accept="image/*" hidden id="adCharReturn" /></label>
                </div>
              </div>
            </div>` : ""}

            <div class="ad-block">
              <div class="adb-head"><b>账号图片资产</b><em class="muted">创建即绑定，生成时可 @ 调用</em>
                <label class="btn ghost sm">+ 添加图片<input type="file" accept="image/*" multiple hidden id="adAssets" /></label>
              </div>
              <div class="ad-asset-grid" id="adAssetGrid">${draft.assets.map((a, i) => `<div class="ad-thumb"><img src="${a.dataUrl}"/><button class="ref-x" data-ax="${i}">${icon("x", 10)}</button></div>`).join("")}</div>
            </div>

            <div class="ad-naming">素材命名规则：<b>${platformCode(draft.platform)}-${esc((draft.name || "账号名").replace(/\s+/g, ""))}-${draft.mode === "视频" ? esc(draft.subType) : "图文"}-001-${todayStamp()}</b></div>

            <div class="ad-import">
              <label class="link-btn">${icon("fileText", 13)} 上传 md 文档批量创建账号<input type="file" accept=".md,.txt,.markdown" hidden id="adImportMd" /></label>
              <em class="muted">每个账号一段：名称 / 平台 / 形式 / 类型 / 定位 / 标签，AI 自动识别</em>
            </div>
          </div>
          <div class="mp-foot">
            <button class="btn ghost" data-close>取消</button>
            <button class="btn primary" id="adConfirm">${editing ? "保存修改" : "创建并进入创作空间"}</button>
          </div>`;
        wire();
      };

      const wire = () => {
        $("#adName", root).addEventListener("input", e => { draft.name = e.target.value; refreshNaming(); });
        $("#adPos", root).addEventListener("input", e => { draft.position = e.target.value; });
        const segWire = (sel, key, redraw = false) => {
          const box = $(sel, root); if (!box) return;
          box.addEventListener("click", e => {
            const b = e.target.closest("button[data-v]"); if (!b) return;
            draft[key] = b.dataset.v;
            redraw ? draw() : ($$(sel + " button", root).forEach(x => x.classList.toggle("is-active", x.dataset.v === draft[key])), refreshNaming());
          });
        };
        segWire("#adPlat", "platform");
        segWire("#adMode", "mode", true);
        segWire("#adSub", "subType", true);
        $("#adTags", root).addEventListener("click", e => {
          const c = e.target.closest("[data-t]"); if (!c) return;
          const t = c.dataset.t;
          draft.qtags.has(t) ? draft.qtags.delete(t) : draft.qtags.add(t);
          c.classList.toggle("on");
        });
        function refreshNaming() {
          const el = root.querySelector(".ad-naming");
          if (el) el.innerHTML = `素材命名规则：<b>${platformCode(draft.platform)}-${esc((draft.name || "账号名").replace(/\s+/g, ""))}-${draft.mode === "视频" ? esc(draft.subType) : "图文"}-001-${todayStamp()}</b>`;
        }

        const charUp = $("#adCharUp", root);
        if (charUp) charUp.addEventListener("change", async e => {
          if (e.target.files[0]) { draft.charDataUrl = await fileToDataUrl(e.target.files[0]); draw(); toast("已选择角色参考版"); }
        });
        const dirDice = $("#adDirDice", root);
        if (dirDice) {
          dirDice.addEventListener("click", () => {
            const cur = $("#adDirInput", root).value;
            let pick = cur;
            while (pick === cur) pick = CHAR_DIR_POOL[Math.floor(Math.random() * CHAR_DIR_POOL.length)];
            $("#adDirInput", root).value = pick;
          });
          $("#adDirGo", root).addEventListener("click", () => {
            let dir = $("#adDirInput", root).value.trim();
            if (!dir) { dir = CHAR_DIR_POOL[Math.floor(Math.random() * CHAR_DIR_POOL.length)]; $("#adDirInput", root).value = dir; }
            $("#adCharPrompt", root).textContent = buildCharBoardPrompt(dir);
            $("#adCharPrompt", root).hidden = false;
            $("#adCharActs", root).hidden = false;
            toast("提示词已生成：复制去第三方出图，回来点「回传身份版」");
          });
          $("#adCharCopy", root).addEventListener("click", () => copyText($("#adCharPrompt", root).textContent, "已复制身份板提示词"));
          $("#adCharReturn", root).addEventListener("change", async e => {
            if (e.target.files[0]) { draft.charDataUrl = await fileToDataUrl(e.target.files[0]); draw(); toast("身份版已回传，将作为角色参考版"); }
          });
        }

        $("#adAssets", root).addEventListener("change", async e => {
          for (const f of Array.from(e.target.files)) draft.assets.push({ name: f.name.replace(/\.[^.]+$/, ""), dataUrl: await fileToDataUrl(f) });
          draw();
        });
        $$("[data-ax]", root).forEach(b => b.addEventListener("click", () => { draft.assets.splice(+b.dataset.ax, 1); draw(); }));

        $("#adImportMd", root).addEventListener("change", async e => {
          const f = e.target.files[0]; if (!f) return;
          toast("AI 解析 md 中…");
          const accs = await AI.parseAccountsMd(await f.text());
          if (!accs.length) { toast("没有识别到账号信息，检查 md 格式"); return; }
          let created = 0;
          accs.forEach(x => {
            if (!x.name || state.accounts.some(a => a.name === x.name)) return;
            createAccount(x); created++;
          });
          close();
          toast(`已批量创建 ${created} 个账号${accs.length - created ? `（${accs.length - created} 个重名跳过）` : ""}`);
          routerRender();
        });

        $("#adConfirm", root).addEventListener("click", async () => {
          const name = draft.name.trim();
          if (!name) { toast("请填写账号名称"); return; }
          const isDH = draft.mode === "视频" && draft.subType === "数字人";
          if (isDH && !editing && !draft.charDataUrl) { toast("数字人账号请先上传或回传角色参考版"); return; }

          let acc;
          if (editing) {
            acc = updateAccount(editing.id, {
              name, platform: draft.platform, mode: draft.mode,
              subType: draft.mode === "图文" ? "" : draft.subType,
              position: draft.position.trim() || "（待补充定位）",
              qtags: [...draft.qtags]
            });
          } else {
            acc = createAccount({
              name, platform: draft.platform, mode: draft.mode, subType: draft.subType,
              position: draft.position.trim(), qtags: [...draft.qtags]
            });
          }
          if (draft.charDataUrl) {
            const ca = await addAssetFromDataUrl(acc.id, { name: name + " 角色身份版", tags: ["角色版"], dataUrl: draft.charDataUrl });
            acc.charBoardAssetId = ca.id;
          }
          for (const a of draft.assets) await addAssetFromDataUrl(acc.id, { name: a.name, tags: [], dataUrl: a.dataUrl });
          save("accounts");
          state.ui.activeAccountId = acc.id;
          save("meta");
          close();
          toast(`账号「${name}」${editing ? "已更新" : "已创建"}`);
          go("studio");
          routerRender();
        });
      };

      draw();
    }
  });
}

/* 全局开口：任何视图 dispatch open-account-dialog 即可唤起 */
document.addEventListener("open-account-dialog", e => openAccountDialog(e.detail?.accountId || null));
