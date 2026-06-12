/* 设置：能力-Provider 档案（语言/图片/视频/TTS）+ 数据管理（导出/导入/清空） */

import { $, $$, esc, gradFor, downloadBlob } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { state, save, persistNow } from "../core/store.js";
import { db } from "../core/db.js";
import { LLM_CONFIG, applyKeyOverrides, llm } from "../api/llm.js";
import { videoApiConfigured, imageApiConfigured } from "../api/providers.js";
import { toast, confirmModal, withLoading } from "../ui/components.js";
import { uid } from "../core/util.js";

const TYPE_LABEL = { language: "脚本 / 文案（语言模型）", image: "图片生成", video: "视频生成", tts: "TTS / 数字人" };

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
              <div class="card-head"><b>接入服务</b><em>按能力配置 Provider，保存后立即生效</em></div>
              <div class="set-status">
                <span class="cap ${LLM_CONFIG.apiKey ? "ok" : "warn"}">${icon("type", 13)} 语言模型 · ${LLM_CONFIG.apiKey ? "已就绪（" + esc(LLM_CONFIG.model) + "）" : "未配置"}</span>
                <span class="cap ${imageApiConfigured() ? "ok" : "warn"}">${icon("image", 13)} 图片生成 · ${imageApiConfigured() ? "已配置" : "未接入 · 站外回传"}</span>
                <span class="cap ${videoApiConfigured() ? "ok" : "warn"}">${icon("film", 13)} 视频生成 · ${videoApiConfigured() ? "已配置" : "未接入 · 模拟引擎"}</span>
              </div>
              <div class="set-grid">
                <label class="field">Key 名称<input class="input" id="setName" placeholder="例如：即梦视频主 Key" /></label>
                <label class="field">服务类型
                  <select class="input" id="setType">
                    <option value="language">脚本 / 文案（语言模型）</option>
                    <option value="image">图片生成 API</option>
                    <option value="video">视频生成 API</option>
                    <option value="tts">TTS / 数字人 API</option>
                  </select>
                </label>
                <label class="field">Provider / Endpoint<input class="input" id="setProvider" placeholder="名称或 http(s) 地址（语言类填地址可覆盖 endpoint）" /></label>
                <label class="field">API Key<input class="input" id="setSecret" type="password" autocomplete="off" placeholder="保存后不明文展示" /></label>
              </div>
              <div class="head-actions">
                <button class="btn ghost" id="setTest">${icon("pulse", 14)} 测试语言模型连接</button>
                <button class="btn primary" id="setSave">${icon("check", 14)} 保存 Key</button>
              </div>
              <p class="muted" style="margin-top:10px">说明：当前为内部原型，语言模型内置默认 Key 浏览器直连；视频 / 图片 Key 保存后即标记为"已配置"，真实调用待 Provider 适配器接入（接口已预留，见 js/api/providers.js）。遇 CORS 可运行 proxy.py 并把 Provider 填 http://localhost:8787/chat。</p>
            </section>

            <section class="card set-list">
              <div class="card-head"><b>已保存的 Key</b><em>${state.apiKeys.length} 个</em></div>
              ${state.apiKeys.length ? state.apiKeys.map(k => `
                <div class="key-row">
                  <span class="key-ico" style="background:${gradFor(k.name)}">${(TYPE_LABEL[k.type] || "?")[0]}</span>
                  <span class="ovt-main"><b>${esc(k.name)}</b><em>${TYPE_LABEL[k.type] || k.type} · ${esc(k.provider || "—")} · ••••${esc(k.tail || "")}</em></span>
                  <button class="icon-btn danger" data-kdel="${k.id}">${icon("trash", 14)}</button>
                </div>`).join("") : `<div class="muted" style="padding:8px 2px">尚未保存任何 Key。语言模型当前使用内置默认配置。</div>`}
            </section>
          </div>

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
        if (!name || !secret) { toast("请填写 Key 名称与 API Key"); return; }
        const type = $("#setType", root).value;
        const provider = $("#setProvider", root).value.trim();
        state.apiKeys.push({ id: uid(), name, type, provider, secret, tail: secret.slice(-4) });
        if (type === "language") applyKeyOverrides(state.apiKeys);
        save("meta");
        toast(type === "language" ? "语言模型配置已更新并生效" : "API Key 已保存");
        draw();
      });
      $("#setTest", root).addEventListener("click", e => withLoading(e.currentTarget, async () => {
        try {
          const r = await llm([{ role: "user", content: "回复两个字：在线" }], { temperature: 0 });
          toast("✓ 连接正常：" + String(r).slice(0, 20));
        } catch (err) {
          toast("✗ 连接失败：" + (err.message || "网络/CORS").slice(0, 60));
        }
      }, "测试中…"));
      $$("[data-kdel]", root).forEach(b => b.addEventListener("click", async () => {
        const ok = await confirmModal({ title: "删除这个 Key？", danger: true, okText: "删除" });
        if (!ok) return;
        state.apiKeys = state.apiKeys.filter(k => k.id !== b.dataset.kdel);
        applyKeyOverrides(state.apiKeys);
        save("meta");
        draw();
      }));
      $("#setExport", root).addEventListener("click", async () => {
        await persistNow();
        const snap = {
          v: 5, exportedAt: new Date().toISOString(),
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
          ["accounts", "productions", "assets", "sessions", "batches", "jobs", "apiKeys"].forEach(k => { if (snap[k]) state[k] = snap[k]; });
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
