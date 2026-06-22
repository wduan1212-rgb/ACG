/* 设置：能力配置 + 数据管理（导出/导入/清空） */

import { $, $$, esc, gradFor, downloadBlob } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, saveMembers, persistNow, ROLE_LABEL } from "../core/store.js";
import { db } from "../core/db.js";
import { LLM_CONFIG, applyKeyOverrides, llm } from "../api/llm.js";
import { videoApiConfigured, imageApiConfigured } from "../api/providers.js";
import { toast, confirmModal, promptModal, openModal, withLoading } from "../ui/components.js";
import { uid } from "../core/util.js";

const TYPE_LABEL = { language: "脚本 / 文案", image: "图片生成", video: "视频生成", tts: "数字人 / 配音" };
const ROLE_DESC = { admin: "全功能 · 管账号/成员/设置 + 创作与发布；可在发布清单标注「已审阅」+ 监管全量", editor: "创作成员：走创作流程，且可直接定稿发布入供应商端", supplier: "仅发布清单：下载素材 + 上传发布链接" };
const ROLE_OPTS = ["admin", "editor", "supplier"];

export const settingsView = {
  render(root) {
    const draw = () => {
      root.innerHTML = `
        <div class="settings-page">
          <div class="page-head">
            <div><div class="eyebrow">设置</div><h2>服务接入与数据管理</h2></div>
          </div>

          <div class="set-cols">
            <section class="card set-form">
              <div class="card-head"><b>能力配置</b><em>按能力配置服务，保存后立即生效</em></div>
              <div class="set-status">
                <span class="cap ${LLM_CONFIG.apiKey ? "ok" : "warn"}">${icon("type", 13)} 脚本 / 文案 · ${LLM_CONFIG.apiKey ? "已就绪" : "待配置"}</span>
                <span class="cap ${imageApiConfigured() ? "ok" : "warn"}">${icon("image", 13)} 图片生成 · ${imageApiConfigured() ? "已就绪" : "支持站外回传"}</span>
                <span class="cap ${videoApiConfigured() ? "ok" : "warn"}">${icon("film", 13)} 视频生成 · 已就绪</span>
              </div>
              <div class="set-grid">
                <label class="field">配置名称<input class="input" id="setName" placeholder="例如：视频生成主配置" /></label>
                <label class="field">服务类型
                  <select class="input" id="setType">
                    <option value="language">脚本 / 文案</option>
                    <option value="image">图片生成</option>
                    <option value="video">视频生成</option>
                    <option value="tts">数字人 / 配音</option>
                  </select>
                </label>
                <label class="field">服务名称<input class="input" id="setProvider" placeholder="服务名称或地址" /></label>
                <label class="field">密钥<input class="input" id="setSecret" type="password" autocomplete="off" placeholder="保存后不明文展示" /></label>
                <label class="field">声线 ID（可选）<input class="input" id="setVoiceId" placeholder="配音服务可填写 voice_id" /></label>
              </div>
              <div class="head-actions">
                <button class="btn ghost" id="setTest">${icon("pulse", 14)} 连接检查</button>
                <button class="btn primary" id="setSave">${icon("check", 14)} 保存配置</button>
              </div>
              <p class="muted" style="margin-top:10px">说明：配置保存后按能力进入对应生成链路；未填写时仍可完成演示流程。</p>
            </section>

            <section class="card set-list">
              <div class="card-head"><b>已保存的配置</b><em>${state.apiKeys.length} 个</em></div>
              ${state.apiKeys.length ? state.apiKeys.map(k => `
                <div class="key-row">
                  <span class="key-ico" style="background:${gradFor(k.name)}">${(TYPE_LABEL[k.type] || "?")[0]}</span>
                  <span class="ovt-main"><b>${esc(k.name)}</b><em>${TYPE_LABEL[k.type] || k.type} · ${esc(k.provider || "—")} · ••••${esc(k.tail || "")}${k.voiceId ? ` · 声线 ${esc(k.voiceId)}` : ""}</em></span>
                  <button class="icon-btn danger" data-kdel="${k.id}">${icon("trash", 14)}</button>
                </div>`).join("") : `<div class="muted" style="padding:8px 2px">尚未保存任何配置。</div>`}
            </section>
          </div>

          <section class="card set-data">
            <div class="card-head"><b>成员账号</b><em>每人一个账号与权限，创作互不干扰；资产库与发布清单全员共享</em>
              <button class="btn primary sm" id="memAdd">${icon("plus", 13)} 添加成员</button></div>
            <div class="mem-list" id="memList">
              ${state.members.map(m => `
                <div class="mem-row" data-mem="${m.id}">
                  <span class="mem-ava" style="background:${gradFor(m.name)}">${esc((m.name || "?")[0])}</span>
                  <span class="ovt-main"><b>${esc(m.name)} ${m.id === state.ui.currentMemberId ? `<i class="mem-me">当前</i>` : ""}</b><em>@${esc(m.username)} · ${ROLE_LABEL[m.role] || m.role} · ${ROLE_DESC[m.role] || ""}</em></span>
                  <span class="mem-role tag ${m.role}">${ROLE_LABEL[m.role] || m.role}</span>
                  <button class="icon-btn sm" data-medit="${m.id}" title="编辑">${icon("edit", 13)}</button>
                  <button class="icon-btn sm danger" data-mdel="${m.id}" title="删除" ${m.id === state.ui.currentMemberId ? "disabled" : ""}>${icon("trash", 13)}</button>
                </div>`).join("")}
            </div>
          </section>

          <section class="card set-data">
            <div class="card-head"><b>数据管理</b><em>数据保存在本机浏览器（IndexedDB 分仓）</em></div>
            <div class="head-actions">
              <button class="btn ghost" id="setExport">${icon("download", 14)} 导出全部数据</button>
              <label class="btn ghost">${icon("upload", 14)} 导入数据<input type="file" accept=".json" hidden id="setImport" /></label>
              <button class="btn danger ghost" id="setWipe">${icon("trash", 14)} 清空本机数据</button>
            </div>
            <p class="muted" style="margin-top:10px">导出 = 账号 / 任务 / 会话 / 批次 / 任务队列 / Key 的 JSON 快照（不含图片二进制，图片随浏览器库保留）。v4 旧库迁移后原样保留，可随时回退旧版（_backup_v4/）。</p>
          </section>
        </div>`;
      wire();
    };

    function wire() {
      $("#setSave", root).addEventListener("click", () => {
        const name = $("#setName", root).value.trim();
        const secret = $("#setSecret", root).value.trim();
        if (!name || !secret) { toast("请填写配置名称与密钥"); return; }
        const type = $("#setType", root).value;
        const provider = $("#setProvider", root).value.trim();
        const voiceId = $("#setVoiceId", root).value.trim();
        state.apiKeys.push({ id: uid(), name, type, provider, secret, tail: secret.slice(-4), ...(voiceId ? { voiceId } : {}) });
        if (type === "language") applyKeyOverrides(state.apiKeys);
        save("meta");
        toast(type === "language" ? "脚本 / 文案配置已更新并生效" : "配置已保存");
        draw();
      });
      $("#setTest", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
        try {
          const r = await llm([{ role: "user", content: "回复两个字：在线" }], { temperature: 0 });
          toast("✓ 连接正常：" + String(r).slice(0, 20));
        } catch (err) {
          toast("连接未完成，请稍后重试");
        }
      }, "检查中…"));
      $$("[data-kdel]", root).forEach(b => b.addEventListener("click", async () => {
        const ok = await confirmModal({ title: "删除这个配置？", danger: true, okText: "删除" });
        if (!ok) return;
        state.apiKeys = state.apiKeys.filter(k => k.id !== b.dataset.kdel);
        applyKeyOverrides(state.apiKeys);
        save("meta");
        draw();
      }));
      const memberDialog = (m) => {
        const editing = !!m;
        m = m || { name: "", username: "", pin: "", role: "editor" };
        openModal(`
          <div class="mp-head"><b>${editing ? "编辑成员" : "添加成员"}</b><button class="icon-btn" data-close>${icon("x", 16)}</button></div>
          <div class="mp-body">
            <label class="field">姓名<input class="input" id="mdName" value="${esc(m.name)}" placeholder="例如：小红" /></label>
            <label class="field">用户名（登录用）<input class="input" id="mdUser" value="${esc(m.username)}" placeholder="字母/数字，唯一" /></label>
            <label class="field">口令<input class="input" id="mdPin" value="${esc(m.pin)}" placeholder="登录口令" /></label>
            <label class="field">角色
              <select class="input" id="mdRole">
                ${ROLE_OPTS.map(r => `<option value="${r}" ${m.role === r ? "selected" : ""}>${ROLE_LABEL[r]} · ${ROLE_DESC[r]}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="mp-foot"><button class="btn ghost" data-close>取消</button><button class="btn primary" id="mdSave">${editing ? "保存" : "添加"}</button></div>
        `, { onMount(panel, close) {
          $("#mdSave", panel).addEventListener("click", () => {
            const name = $("#mdName", panel).value.trim();
            const username = $("#mdUser", panel).value.trim();
            const pin = $("#mdPin", panel).value.trim();
            const role = $("#mdRole", panel).value;
            if (!name || !username || !pin) { toast("姓名 / 用户名 / 口令都要填"); return; }
            if (state.members.some(x => x.username === username && x.id !== m.id)) { toast("用户名已存在"); return; }
            if (editing) { const t = state.members.find(x => x.id === m.id); Object.assign(t, { name, username, pin, role }); }
            else state.members.push({ id: uid(), name, username, pin, role, createdAt: Date.now() });
            saveMembers();
            close(); draw();
            toast(editing ? "成员已更新" : "成员已添加");
          });
        }});
      };
      const mAdd = $("#memAdd", root);
      if (mAdd) mAdd.addEventListener("click", () => memberDialog(null));
      $$("[data-medit]", root).forEach(b => b.addEventListener("click", () => memberDialog(state.members.find(m => m.id === b.dataset.medit))));
      $$("[data-mdel]", root).forEach(b => b.addEventListener("click", async () => {
        const m = state.members.find(x => x.id === b.dataset.mdel);
        if (!m) return;
        const ok = await confirmModal({ title: `删除成员「${m.name}」？`, body: "其创作记录会保留但归属置空。", danger: true, okText: "删除" });
        if (!ok) return;
        state.members = state.members.filter(x => x.id !== m.id);
        saveMembers(); draw();
        toast("成员已删除");
      }));

      $("#setExport", root).addEventListener("click", async () => {
        await persistNow();
        const snap = {
          v: 5, exportedAt: new Date().toISOString(),
          members: state.members,
          accounts: state.accounts, productions: state.productions,
          assets: state.assets.map(a => ({ ...a })),
          sessions: state.sessions, batches: state.batches, jobs: state.jobs,
          apiKeys: state.apiKeys, ui: state.ui
        };
        downloadBlob(`dumate-studio-backup-${Date.now()}.json`, new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" }));
        toast("已导出数据快照");
      });
      $("#setImport", root).addEventListener("change", async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const snap = JSON.parse(await f.text());
          if (!snap.accounts) throw new Error("不是有效的备份文件");
          const ok = await confirmModal({ title: "导入将覆盖当前数据，继续？", body: "建议先导出一份当前数据。", danger: true, okText: "覆盖导入" });
          if (!ok) return;
          ["members", "accounts", "productions", "assets", "sessions", "batches", "jobs", "apiKeys"].forEach(k => { if (snap[k]) state[k] = snap[k]; });
          if (snap.ui) Object.assign(state.ui, snap.ui);
          await persistNow();
          location.reload();
        } catch (err) { toast("导入失败：" + err.message); }
      });
      $("#setWipe", root).addEventListener("click", async () => {
        const ok = await confirmModal({ title: "清空本机全部数据？", body: "账号、任务、资产、会话都会被删除，且不可恢复（v4 旧库不受影响）。", danger: true, okText: "清空" });
        if (!ok) return;
        await db.wipe();
        location.reload();
      });
    }

    draw();
  }
};
