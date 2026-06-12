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


# 静态托管放最后（兜底路由）
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
