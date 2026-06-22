/* 零依赖静态服务器：node tools/serve.mjs [port]（ES Modules 需要 http 环境，file:// 打不开） */
import http from "node:http";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const PORT = Number(process.env.PORT || process.argv[2] || 4173);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function hashNum(text) {
  return Number.parseInt(crypto.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 10), 16);
}

function noteId(url) {
  const s = String(url || "");
  for (const mark of ["/explore/", "/discovery/item/", "/item/"]) {
    if (s.includes(mark)) return s.split(mark)[1].split("?")[0].split("/")[0] || "note_unknown";
  }
  return "note_" + crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url?.startsWith("/api/analytics/")) {
      const body = await readBody(req);
      if (req.url.startsWith("/api/analytics/resolve")) {
        return sendJson(res, { ok: true, provider: "serve-mock", noteId: noteId(body.url), canonicalUrl: body.url, resolvedAt: Date.now() });
      }
      if (req.url.startsWith("/api/analytics/fetch")) {
        const seed = hashNum(body.url || body.noteId || "");
        const ageH = Math.max(1, (seed % 96) + 1);
        const base = 300 + seed % 1400;
        const views = Math.round(base * (1 + Math.min(9, Math.sqrt(ageH))) + ageH * (seed % 19));
        const likes = Math.round(views * (0.035 + ((seed >> 8) % 55) / 1000));
        const collects = Math.round(views * (0.014 + ((seed >> 13) % 38) / 1000));
        const comments = Math.round(views * (0.004 + ((seed >> 18) % 18) / 1000));
        const shares = Math.round(views * (0.003 + ((seed >> 22) % 12) / 1000));
        const engagementRate = views ? (likes + collects + comments + shares) / views : 0;
        const qualityScore = Math.max(35, Math.min(96, Math.round(engagementRate * 520 + String(views).length * 10)));
        return sendJson(res, {
          provider: "serve-mock",
          noteId: body.noteId || noteId(body.url),
          fetchedAt: Date.now(),
          metrics: { views, likes, collects, comments, shares, engagementRate, qualityScore },
          commentsSample: ["能不能出一个具体步骤版", "标题如果更直接会想点进去", "封面信息少一点可能更清楚"],
          raw: { mock: true, seed }
        });
      }
    }
    let path = decodeURIComponent((req.url || "/").split("?")[0]);
    if (path === "/") path = "/index.html";
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const s = await stat(file).catch(() => null);
    const target = s && s.isDirectory() ? join(file, "index.html") : file;
    const data = await readFile(target);
    res.writeHead(200, { "Content-Type": MIME[extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  }
}).listen(PORT, () => console.log(`Dumate Studio → http://localhost:${PORT}`));
