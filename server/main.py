# =========================================================
# ACG 视频工具 · 最小可运行后端（FastAPI）
# 作用：
#   1. 托管前端静态页（index.html / app.js / styles.css）
#   2. /api/llm 转发 DeepSeek 等模型请求（解决 CORS + 隐藏 Key）
#   3. /api/accounts /api/assets 等数据接口（JSON 文件存储，可换数据库）
#   4. 自动生成 OpenAPI 文档（/docs），CLI 与 agent 直接对接
# 运行：
#   pip install fastapi uvicorn httpx
#   export LLM_API_KEY=sk-xxx      # 不要把 Key 写进前端代码
#   uvicorn main:app --host 0.0.0.0 --port 8787
# =========================================================
import json
import os
import time
import uuid
import hashlib
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT.parent          # index.html 所在目录
DATA_FILE = ROOT / "data.json"

LLM_ENDPOINT = os.getenv("LLM_ENDPOINT", "https://api.deepseek.com/chat/completions")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")
JUSTONEAPI_KEY = os.getenv("JUSTONEAPI_KEY", "")
JUSTONEAPI_BASE_URL = os.getenv("JUSTONEAPI_BASE_URL", "https://api.justoneapi.com").rstrip("/")

app = FastAPI(title="ACG 视频工具 API", version="0.1.0",
              description="账号化 AI 视频生产工作台后端。CLI / agent 可直接按本 OpenAPI 调用。")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- 简易 JSON 存储（团队规模够用，后续可换 SQLite/Postgres） ----------
def load_db() -> dict:
    if DATA_FILE.exists():
        return json.loads(DATA_FILE.read_text("utf-8"))
    return {"accounts": [], "assets": [], "tasks": []}


def save_db(db: dict):
    DATA_FILE.write_text(json.dumps(db, ensure_ascii=False, indent=2), "utf-8")


# ---------- 模型代理 ----------
class LLMReq(BaseModel):
    messages: list
    json_mode: bool = False
    temperature: float = 0.7


@app.post("/api/llm")
async def llm_proxy(req: LLMReq):
    """前端 / CLI 统一从这里调模型，Key 只存在服务器环境变量里。"""
    if not LLM_API_KEY:
        raise HTTPException(500, "服务器未配置 LLM_API_KEY")
    body = {"model": LLM_MODEL, "temperature": req.temperature, "messages": req.messages}
    if req.json_mode:
        body["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(LLM_ENDPOINT, json=body,
                              headers={"Authorization": f"Bearer {LLM_API_KEY}"})
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text[:300])
    return {"content": r.json()["choices"][0]["message"]["content"]}


# ---------- 账号 ----------
class Account(BaseModel):
    name: str
    platform: str = "小红书"
    mode: str = "视频"
    subType: str = ""
    position: str = ""


@app.get("/api/accounts")
def list_accounts():
    return load_db()["accounts"]


@app.post("/api/accounts")
def create_account(acc: Account):
    db = load_db()
    item = {"id": uuid.uuid4().hex[:8], "createdAt": int(time.time()),
            "monthlyDone": 0, "assets": [], **acc.model_dump()}
    db["accounts"].append(item)
    save_db(db)
    return item


@app.delete("/api/accounts/{acc_id}")
def delete_account(acc_id: str):
    db = load_db()
    before = len(db["accounts"])
    db["accounts"] = [a for a in db["accounts"] if a["id"] != acc_id]
    if len(db["accounts"]) == before:
        raise HTTPException(404, "账号不存在")
    save_db(db)
    return {"ok": True}


# ---------- 素材（供应商端下载的成片） ----------
class Asset(BaseModel):
    name: str
    accountId: str
    type: str = "视频"
    tags: list[str] = []
    url: Optional[str] = None      # 对象存储地址（BOS/OSS/S3）


@app.get("/api/assets")
def list_assets(platform: Optional[str] = None, tag: Optional[str] = None):
    items = load_db()["assets"]
    if platform:
        items = [x for x in items if x.get("platform") == platform]
    if tag:
        items = [x for x in items if tag in x.get("tags", [])]
    return items


@app.post("/api/assets")
def create_asset(asset: Asset):
    db = load_db()
    acc = next((a for a in db["accounts"] if a["id"] == asset.accountId), None)
    item = {"id": uuid.uuid4().hex[:8], "createdAt": int(time.time()),
            "status": "未下载", "platform": acc["platform"] if acc else "",
            **asset.model_dump()}
    db["assets"].append(item)
    if acc:
        acc["monthlyDone"] = acc.get("monthlyDone", 0) + 1   # 月度进度+1
    save_db(db)
    return item


@app.post("/api/assets/{asset_id}/download")
def mark_downloaded(asset_id: str):
    db = load_db()
    for x in db["assets"]:
        if x["id"] == asset_id:
            x["status"] = "已下载"
            save_db(db)
            return x
    raise HTTPException(404, "素材不存在")


@app.get("/api/health")
def health():
    return {"ok": True, "llm_configured": bool(LLM_API_KEY)}


# ---------- 数据分析：小红书链接解析 / 指标采集 ----------
class AnalyticsResolveReq(BaseModel):
    url: str


class AnalyticsFetchReq(BaseModel):
    url: str
    noteId: Optional[str] = None
    assetId: Optional[str] = None
    accountId: Optional[str] = None


def _hash_num(text: str) -> int:
    return int(hashlib.sha1(text.encode("utf-8")).hexdigest()[:10], 16)


def _note_id(url: str) -> str:
    for mark in ("/explore/", "/discovery/item/", "/item/"):
        if mark in url:
            return url.split(mark, 1)[1].split("?", 1)[0].split("/", 1)[0]
    return "note_" + hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]


def _deep_get(obj, *paths, default=None):
    for path in paths:
      cur = obj
      ok = True
      for key in path:
          if isinstance(cur, dict):
              cur = cur.get(key)
          elif isinstance(cur, list) and isinstance(key, int) and 0 <= key < len(cur):
              cur = cur[key]
          else:
              ok = False
              break
      if ok and cur not in (None, ""):
          return cur
    return default


def _num(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).replace(",", "").strip().lower()
    mul = 1
    if "万" in s or "w" in s:
        mul = 10000
    digits = "".join(ch for ch in s if ch.isdigit() or ch == ".")
    try:
        return int(float(digits or "0") * mul)
    except ValueError:
        return 0


async def _justone_get(path: str, params: dict) -> dict:
    if not JUSTONEAPI_KEY:
        raise RuntimeError("JUSTONEAPI_KEY not configured")
    q = {"token": JUSTONEAPI_KEY, **{k: v for k, v in params.items() if v not in (None, "")}}
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        r = await client.get(JUSTONEAPI_BASE_URL + path, params=q)
    if r.status_code != 200:
        raise RuntimeError(f"JustOneAPI HTTP {r.status_code}: {r.text[:240]}")
    payload = r.json()
    if isinstance(payload, dict) and payload.get("code") not in (0, "0", None):
        raise RuntimeError(f"JustOneAPI {payload.get('code')}: {payload.get('message') or payload}")
    return payload


def _normalize_note_detail(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else payload
    note = _deep_get(data, ("note",), ("noteDetail",), ("note_detail",), ("items", 0), ("list", 0), default=data)
    if not isinstance(note, dict):
        note = data if isinstance(data, dict) else {}
    inter = _deep_get(note, ("interactInfo",), ("interact_info",), ("interaction",), ("statistics",), ("stats",), default={}) or {}
    user = _deep_get(note, ("user",), ("userInfo",), ("user_info",), ("author",), default={}) or {}
    title = _deep_get(note, ("title",), ("displayTitle",), ("display_title",), ("noteCard", "displayTitle"), default="")
    desc = _deep_get(note, ("desc",), ("description",), ("content",), default="")
    author = _deep_get(user, ("nickname",), ("nickName",), ("name",), ("userName",), default="")
    likes = _num(_deep_get(inter, ("likedCount",), ("liked_count",), ("likeCount",), ("like_count",), ("likes",), default=0)
                 or _deep_get(note, ("likedCount",), ("liked_count",), ("likeCount",), ("likes",), default=0))
    collects = _num(_deep_get(inter, ("collectedCount",), ("collected_count",), ("collectCount",), ("collect_count",), ("favCount",), ("favoriteCount",), default=0)
                    or _deep_get(note, ("collectedCount",), ("collectCount",), ("collects",), default=0))
    comments = _num(_deep_get(inter, ("commentCount",), ("comment_count",), ("comments",), default=0)
                    or _deep_get(note, ("commentCount",), ("comment_count",), default=0))
    shares = _num(_deep_get(inter, ("shareCount",), ("share_count",), ("shares",), default=0)
                  or _deep_get(note, ("shareCount",), ("share_count",), default=0))
    views = _num(_deep_get(inter, ("viewCount",), ("view_count",), ("readCount",), ("read_count",), ("exposure",), default=0)
                 or _deep_get(note, ("viewCount",), ("readCount",), ("views",), default=0))
    return {
        "title": title,
        "desc": desc,
        "author": author,
        "publishTime": _deep_get(note, ("time",), ("publishTime",), ("publish_time",), ("createTime",), ("create_time",), default=None),
        "metrics": {
            "views": views,
            "likes": likes,
            "collects": collects,
            "comments": comments,
            "shares": shares,
        },
        "rawNote": note,
    }


def _comment_texts(payload: dict, limit: int = 12) -> list[str]:
    data = payload.get("data") if isinstance(payload, dict) else payload
    candidates = [
        _deep_get(data, ("comments",), default=None),
        _deep_get(data, ("commentList",), default=None),
        _deep_get(data, ("comment_list",), default=None),
        _deep_get(data, ("list",), default=None),
        _deep_get(data, ("items",), default=None),
    ]
    comments = next((x for x in candidates if isinstance(x, list)), [])
    out = []
    for c in comments[:limit]:
        if not isinstance(c, dict):
            continue
        text = _deep_get(c, ("content",), ("text",), ("comment",), ("desc",), default="")
        if text:
            out.append(str(text))
    return out


@app.post("/api/analytics/resolve")
async def analytics_resolve(req: AnalyticsResolveReq):
    """解析小红书分享链接。
    生产环境建议接授权/第三方 provider。未配置时返回稳定本地解析结果。
    """
    return {
        "ok": True,
        "provider": "justoneapi-note-id" if JUSTONEAPI_KEY else "server-mock",
        "noteId": _note_id(req.url),
        "canonicalUrl": req.url,
        "resolvedAt": int(time.time() * 1000),
    }


@app.post("/api/analytics/fetch")
async def analytics_fetch(req: AnalyticsFetchReq):
    """拉取笔记指标。
    配置 JUSTONEAPI_KEY 后优先调用小红书真实接口；未配置时返回稳定模拟数据。
    """
    note_id = req.noteId or _note_id(req.url)
    if JUSTONEAPI_KEY:
        try:
            detail_raw = await _justone_get("/api/xiaohongshu/get-note-detail/v5", {"noteId": note_id})
            detail = _normalize_note_detail(detail_raw)
            comment_raw = await _justone_get("/api/xiaohongshu/get-note-comment/v4", {"noteId": note_id})
            comments_sample = _comment_texts(comment_raw)
            metrics = detail["metrics"]
            total_base = metrics["views"] or (metrics["likes"] + metrics["collects"] + metrics["comments"] + metrics["shares"]) * 20
            engagement = (metrics["likes"] + metrics["collects"] + metrics["comments"] + metrics["shares"]) / total_base if total_base else 0
            score = max(35, min(96, int(engagement * 520 + len(str(total_base or 1)) * 10)))
            return {
                "provider": "justoneapi",
                "noteId": note_id,
                "title": detail["title"],
                "author": detail["author"],
                "publishTime": detail["publishTime"],
                "fetchedAt": int(time.time() * 1000),
                "metrics": {
                    **metrics,
                    "views": metrics["views"],
                    "engagementRate": engagement,
                    "qualityScore": score,
                },
                "commentsSample": comments_sample,
                "raw": {
                    "detail": detail_raw,
                    "comments": comment_raw,
                    "note": detail["rawNote"],
                },
            }
        except Exception as exc:
            raise HTTPException(502, f"JustOneAPI 调用失败：{str(exc)[:260]}")

    seed = _hash_num(req.url or req.noteId or "")
    age_h = max(1, int(seed % 96) + 1)
    base = 300 + seed % 1400
    views = int(base * (1 + min(9, age_h ** 0.45)) + age_h * (seed % 19))
    like_rate = 0.035 + ((seed >> 8) % 55) / 1000
    collect_rate = 0.014 + ((seed >> 13) % 38) / 1000
    comment_rate = 0.004 + ((seed >> 18) % 18) / 1000
    likes = int(views * like_rate)
    collects = int(views * collect_rate)
    comments = int(views * comment_rate)
    shares = int(views * (0.003 + ((seed >> 22) % 12) / 1000))
    engagement = (likes + collects + comments + shares) / views if views else 0
    score = max(35, min(96, int(engagement * 520 + len(str(views)) * 10)))
    return {
        "provider": "server-mock" if not JUSTONEAPI_KEY else "server-provider-pending",
        "noteId": req.noteId or _note_id(req.url),
        "fetchedAt": int(time.time() * 1000),
        "metrics": {
            "views": views,
            "likes": likes,
            "collects": collects,
            "comments": comments,
            "shares": shares,
            "engagementRate": engagement,
            "qualityScore": score,
        },
        "commentsSample": [
            "能不能出一个具体步骤版",
            "这个标题如果更直接会想点进去",
            "封面信息少一点可能更清楚",
        ],
        "raw": {"mock": not bool(JUSTONEAPI_KEY), "seed": seed},
    }


# 静态托管放最后（兜底路由）
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
