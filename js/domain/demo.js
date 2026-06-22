/* 视频演示版：三账号 / 三类素材 / 预设创作链路 / 模拟数据监测 */

import { state, save } from "../core/store.js";
import { createJob } from "../api/jobs.js";
import { setStage, estimateAudio, buildMaterialUnits } from "./productions.js";

export const DEMO_VERSION = "video-demo-2026-06-17";

export const DEMO_ACCOUNTS = [
  {
    id: "demo-acc-ding",
    demoKey: "image",
    name: "叮叮Ding办公",
    platform: "小红书",
    mode: "图文",
    subType: "",
    position: "小红书图文号，面向学生、老师和职场新人，用清爽步骤图讲 Dumate 文件整理、资料归类、文书初稿等高频办公场景。",
    styleProfile: "白底极简、蓝紫品牌色、Dumate 3D 小搭子、对比式教程卡片、强标题钩子",
    tone: "轻快教程感",
    qtags: ["职场效率", "产品功能", "学生教培"],
    monthlyDone: 12,
    exportSeq: 1,
    charBoardAssetId: null,
    lockedStyle: "白底极简、蓝紫渐变、Dumate 3D 小搭子、教程信息图",
    customStyleChips: [],
    createdAt: Date.now() - 9 * 864e5
  },
  {
    id: "demo-acc-ashi",
    demoKey: "material",
    name: "阿石聊AI",
    platform: "视频号",
    mode: "视频",
    subType: "无数字人",
    position: "素材混剪号，面向企业管理者和技术关注者，用展会实拍、产品界面、案例画面讲 AI 与智能云能力，节奏沉稳、有信息密度。",
    styleProfile: "深蓝科技展会实拍、产品界面穿插、蓝紫光束转场、企业案例口吻",
    tone: "专业测评感",
    qtags: ["产品功能", "测评中立"],
    monthlyDone: 8,
    exportSeq: 1,
    charBoardAssetId: null,
    lockedStyle: null,
    customStyleChips: [],
    createdAt: Date.now() - 8 * 864e5
  },
  {
    id: "demo-acc-nannan",
    demoKey: "human",
    name: "职场效率一姐李南南",
    platform: "视频号",
    mode: "视频",
    subType: "数字人",
    position: "真人口播号，面向职场白领和项目负责人，真人出镜讲待办、会议纪要、项目资料同步等办公效率痛点。",
    styleProfile: "明亮办公室、真人半身口播、右侧待办清单浮层、自然亲和",
    tone: "亲切但干练",
    qtags: ["职场效率", "创作者"],
    monthlyDone: 10,
    exportSeq: 1,
    charBoardAssetId: "demo-human-cover-2",
    lockedStyle: null,
    customStyleChips: [],
    createdAt: Date.now() - 7 * 864e5
  }
];

const p = path => `./${path}`;

const DEMO_ASSETS = [
  ...[1, 2, 3, 4, 5, 6].map(n => ({
    id: `demo-img-${n}`,
    accountId: "demo-acc-ding",
    seq: n,
    name: `留学资料图文_${String(n).padStart(2, "0")}`,
    type: "图片",
    tags: ["笔记图", "图文演示", "站外生成"],
    staticUrl: p(`视频与图片素材/图文演示/${n}.png`),
    createdAt: Date.now() - (700 - n) * 1000,
    hasBlob: false
  })),
  {
    id: "demo-human-clip-1",
    accountId: "demo-acc-nannan",
    seq: 7,
    name: "真人号片段1_输入需求",
    type: "视频",
    tags: ["真人号演示", "生成片段", "带字幕"],
    staticUrl: p("视频与图片素材/真人号演示/真人号片段1.mp4"),
    createdAt: Date.now() - 680000,
    hasBlob: false
  },
  {
    id: "demo-human-clip-2",
    accountId: "demo-acc-nannan",
    seq: 8,
    name: "真人号片段2_待办清单",
    type: "视频",
    tags: ["真人号演示", "生成片段", "带字幕"],
    staticUrl: p("视频与图片素材/真人号演示/真人号片段2.mp4"),
    createdAt: Date.now() - 670000,
    hasBlob: false
  },
  {
    id: "demo-human-cover-1",
    accountId: "demo-acc-nannan",
    seq: 9,
    name: "真人号分镜封面_输入需求",
    type: "图片",
    tags: ["分镜图", "真人号演示"],
    staticUrl: p(".demo-preview/真人号片段1.mp4.png"),
    createdAt: Date.now() - 660000,
    hasBlob: false
  },
  {
    id: "demo-human-cover-2",
    accountId: "demo-acc-nannan",
    seq: 10,
    name: "真人号角色身份版_李南南",
    type: "图片",
    tags: ["角色身份版", "分镜图", "真人号演示"],
    staticUrl: p(".demo-preview/真人号片段2.mp4.png"),
    createdAt: Date.now() - 650000,
    hasBlob: false
  },
  {
    id: "demo-material-video",
    accountId: "demo-acc-ashi",
    seq: 11,
    name: "素材号演示视频_ACGTV",
    type: "视频",
    tags: ["素材号演示", "成片", "带字幕"],
    staticUrl: p("视频与图片素材/素材号演示/演示视频.mp4"),
    createdAt: Date.now() - 640000,
    hasBlob: false
  },
  {
    id: "demo-material-cover",
    accountId: "demo-acc-ashi",
    seq: 12,
    name: "素材号首帧_ACGTV展台",
    type: "图片",
    tags: ["分镜图", "素材号演示"],
    staticUrl: p(".demo-preview/演示视频.mp4.png"),
    createdAt: Date.now() - 630000,
    hasBlob: false
  }
];

export function demoAccountByKey(key) {
  return state.accounts.find(a => a.demoKey === key);
}

export function seedDemoIfEmpty() {
  if (state.accounts.length) return false;
  const admin = state.members.find(m => m.role === "admin") || state.members[0] || null;
  state.accounts = DEMO_ACCOUNTS.map(a => ({ ...a }));
  state.assets = DEMO_ASSETS.map(a => ({ ...a, ownerId: admin?.id || null }));
  state.ui.assetSeq = Math.max(state.ui.assetSeq || 0, 12);
  state.ui.activeAccountId = "demo-acc-ding";
  seedDeliveredAndAnalytics(admin?.id || null);
  save(
    "accounts", "assets", "analyticsLinks", "metricSnapshots",
    "insightReports", "creativeMemory", "meta"
  );
  return true;
}

function seedDeliveredAndAnalytics(ownerId) {
  const now = Date.now();
  const delivered = [
    {
      id: "demo-delivered-image",
      accountId: "demo-acc-ding",
      name: "XHS-叮叮Ding办公-图文-001-demo",
      type: "图集",
      tags: ["成片", "图文", "小红书", "6张组图", "职场效率"],
      createdAt: now - 26 * 3600e3,
      delivered: true,
      status: "已发布",
      title: "留学申请资料堆成山？3步收拾干净",
      copy: "留学申请资料最怕版本乱、命名乱、关键信息找不到。用 Dumate 先上传，再自动分类，最后让搭子生成文书初稿，整理和写作都能快一大截。",
      productionId: null,
      packAssetIds: ["demo-img-1", "demo-img-2", "demo-img-3", "demo-img-4", "demo-img-5", "demo-img-6"],
      clips: 0,
      subCount: 0,
      pubSeq: 1,
      deliveredAt: now - 26 * 3600e3,
      byAccount: "叮叮Ding办公",
      byMemberId: ownerId,
      byMemberName: "羽轩",
      planDate: "2026-06-18",
      publishedUrl: "https://www.xiaohongshu.com/explore/dumate-demo-ding",
      publishedTitle: "留学申请资料堆成山？3步收拾干净",
      publishedAt: now - 23 * 3600e3,
      adminReviewed: true
    },
    {
      id: "demo-delivered-human",
      accountId: "demo-acc-nannan",
      name: "SPH-职场效率一姐李南南-数字人-001-demo",
      type: "视频",
      tags: ["成片", "视频", "视频号", "带字幕", "真人视频"],
      createdAt: now - 20 * 3600e3,
      delivered: true,
      status: "已发布",
      title: "会议待办别再手抄，搭子帮你列清单",
      copy: "开会后最怕待办散在聊天、文档和脑子里。李南南这条演示：一句话给 Dumate，它会把会议重点、明日提醒、项目资料同步成可执行清单。",
      productionId: null,
      packAssetIds: [],
      clips: 2,
      subCount: 9,
      pubSeq: 2,
      deliveredAt: now - 20 * 3600e3,
      byAccount: "职场效率一姐李南南",
      byMemberId: ownerId,
      byMemberName: "羽轩",
      planDate: "2026-06-18",
      publishedUrl: "https://channels.weixin.qq.com/demo/dumate-nannan",
      publishedTitle: "会议待办别再手抄，搭子帮你列清单",
      publishedAt: now - 18 * 3600e3,
      adminReviewed: true
    },
    {
      id: "demo-delivered-material",
      accountId: "demo-acc-ashi",
      name: "SPH-阿石聊AI-无数字人-001-demo",
      type: "视频",
      tags: ["成片", "视频", "视频号", "带字幕", "素材视频"],
      createdAt: now - 14 * 3600e3,
      delivered: true,
      status: "已发布",
      title: "AI 云展台一分钟看懂：从模型到业务现场",
      copy: "素材号用展台实拍和产品画面解释 ACG TV/百度智能云能力：不是只讲概念，而是把模型、工具、业务落地串成一条 60 秒说明片。",
      productionId: null,
      packAssetIds: [],
      clips: 1,
      subCount: 14,
      pubSeq: 3,
      deliveredAt: now - 14 * 3600e3,
      byAccount: "阿石聊AI",
      byMemberId: ownerId,
      byMemberName: "羽轩",
      planDate: "2026-06-18",
      publishedUrl: "https://channels.weixin.qq.com/demo/dumate-ashi",
      publishedTitle: "AI 云展台一分钟看懂：从模型到业务现场",
      publishedAt: now - 12 * 3600e3,
      adminReviewed: true
    }
  ];
  state.assets.push(...delivered);
  state.ui.deliverSeq = 3;

  const rows = [
    ["demo-link-image", "demo-delivered-image", "demo-acc-ding", "小红书", "https://www.xiaohongshu.com/explore/dumate-demo-ding", "留学申请资料堆成山？3步收拾干净", { views: 12860, likes: 936, collects: 622, comments: 81, shares: 74, qualityScore: 89 }],
    ["demo-link-human", "demo-delivered-human", "demo-acc-nannan", "视频号", "https://channels.weixin.qq.com/demo/dumate-nannan", "会议待办别再手抄，搭子帮你列清单", { views: 8760, likes: 542, collects: 221, comments: 64, shares: 49, qualityScore: 82 }],
    ["demo-link-material", "demo-delivered-material", "demo-acc-ashi", "视频号", "https://channels.weixin.qq.com/demo/dumate-ashi", "AI 云展台一分钟看懂：从模型到业务现场", { views: 15320, likes: 1048, collects: 438, comments: 93, shares: 118, qualityScore: 91 }]
  ];
  state.analyticsLinks = rows.map(([id, assetId, accountId, platform, url, title]) => ({
    id, createdAt: now - 10 * 3600e3, updatedAt: now - 2 * 3600e3,
    url, platform, accountId, productionId: null, assetId, title,
    tags: state.assets.find(a => a.id === assetId)?.tags || [],
    publishedAt: now - 8 * 3600e3,
    noteId: `${id}-note`,
    status: "synced",
    error: "",
    source: "demo-return",
    provider: "数据回传",
    lastSnapshotId: `${id}-snap`,
    lastSyncedAt: now - 2 * 3600e3
  }));
  state.metricSnapshots = rows.map(([id, assetId, accountId, platform, url, title, m]) => ({
    id: `${id}-snap`,
    linkId: id,
    assetId,
    accountId,
    productionId: null,
    provider: "数据回传",
    noteId: `${id}-note`,
    fetchedAt: now - 2 * 3600e3,
    metrics: {
      ...m,
      engagementRate: (m.likes + m.collects + m.comments + m.shares) / m.views
    },
    commentsSample: ["封面很清楚", "这个流程可以直接照着做", "字幕节奏舒服"],
    raw: { demo: true }
  }));
  state.insightReports = [{
    id: "demo-insight-1",
    createdAt: now - 90 * 60e3,
    range: "demo",
    title: "演示数据复盘",
    summary: "3 条演示内容已检测，平均质量分 87。图文号收藏率高，素材号完播和转发更强，真人号评论更集中在待办清单场景。",
    nextTopics: ["叮叮Ding办公继续做资料整理系列", "李南南做会议纪要到行动清单", "阿石聊AI做企业 AI 落地一分钟解释"],
    scriptAdvice: ["前三秒直接抛结果", "中段必须出现具体操作画面", "结尾用效率收益收束"],
    rules: [
      { type: "topic", rule: "优先做资料整理、会议待办、AI 落地三类强办公痛点。", evidence: "演示样本平均质量分 87", confidence: 0.82 },
      { type: "visual", rule: "首屏保留一个大标题和一个前后对比，减少小字堆叠。", evidence: "图文收藏率最高", confidence: 0.78 }
    ],
    source: "demo-robot",
    linkedSnapshotIds: rows.map(([id]) => `${id}-snap`)
  }];
  state.creativeMemory = state.insightReports[0].rules.map((r, i) => ({
    id: `demo-memory-${i + 1}`,
    scope: "platform",
    platform: "",
    type: r.type,
    rule: r.rule,
    evidence: r.evidence,
    confidence: r.confidence,
    sourceReportId: "demo-insight-1",
    status: "active",
    createdAt: now - 80 * 60e3,
    updatedAt: now - 80 * 60e3
  }));
}

export function applyDemoProduction(p, { batch = false } = {}) {
  const acc = state.accounts.find(a => a.id === p.accountId);
  if (!acc?.demoKey) return false;
  if (acc.demoKey === "image") fillImageProduction(p, batch);
  if (acc.demoKey === "human") fillHumanProduction(p, batch);
  if (acc.demoKey === "material") fillMaterialProduction(p, batch);
  save("productions", "jobs");
  return true;
}

function fillImageProduction(prod, batch) {
  const shots = [
    ["封面钩子", "前后对比：左侧桌面堆满留学申请文件，右侧 Dumate 已整理成推荐信、成绩单、PS、CV 等文件夹。", "留学申请资料堆成山？3步让搭子帮你收拾干净！"],
    ["上传需求", "Dumate 输入框里写着“帮我整理留学申请文件夹，按类型归类”，右侧扫描文件进度 62%。", "Step1：告诉搭子你的需求，它就开干"],
    ["自动分类", "界面展示 5 类文件夹和关键资料卡片：推荐信、成绩单、个人陈述、本科成绩单。", "Step2：自动分类 + 提取关键信息，一目了然"],
    ["文书初稿", "Dumate 生成 Personal Statement 初稿，左侧 checklist 已整理完成。", "Step3：生成文书初稿，省去手动整理"],
    ["效率对比", "左侧人工流程预计 4 小时，右侧 Dumate 完成耗时 1 分钟，并列 VS 卡片。", "以前 4 小时，现在 1 分钟！"],
    ["收束试用", "书桌上出现留学申请指南与 Dumate 文件夹卡片，标题“留学党必备神器，快去试试吧”。", "百度搭子，你的办公智能体"]
  ].map(([idea, visual, line]) => ({ idea, visual, line }));
  prod.topic = "留学申请资料堆成山？3步让搭子收拾干净";
  prod.title = prod.topic;
  prod.artifacts.script = {
    title: prod.topic,
    shots,
    source: "demo",
    style: "白底极简、蓝紫品牌色、Dumate 3D 小搭子、教程信息图",
    imageCount: 6,
    direction: ""
  };
  prod.artifacts.images.items = shots.map((s, i) => ({
    title: s.idea,
    visual: s.visual,
    prompt: demoImagePrompt(i, s),
    assetId: `demo-img-${i + 1}`,
    status: "done"
  }));
  prod.artifacts.images.externalPrompt = shots.map((s, i) => `图${i + 1}：${demoImagePrompt(i, s)}`).join("\n\n");
  prod.artifacts.copy = {
    title: "留学申请资料堆成山？3步收拾干净",
    body: "申请季资料越攒越乱？推荐信、成绩单、PS、CV 每次都要找半天。\n\n1. 把资料上传到 Dumate 工作区\n2. 让搭子自动按类型归类并提取关键信息\n3. 直接生成文书初稿，后续再精修\n\n以前整理半天，现在先把结构搭好再打磨。#留学申请 #资料整理 #办公效率 #Dumate"
  };
  if (batch) setStage(prod, "review", "pending");
  else {
    prod.stage = "script";
    prod.stageStatus = "done";
  }
}

function fillHumanProduction(prod, batch) {
  const shots = [
    ["0-4s", "开场钩子", "李南南坐在明亮办公桌前，对镜头微笑开场，右侧浮出待办清单半透明卡片。", "你有没有发现，开完会最累的不是开会，是把重点和待办重新整理一遍。"],
    ["4-8s", "输入需求", "Dumate 输入框出现“帮我整理会议重点”，鼠标点击发送，界面保持白底极简。", "现在我只要把需求告诉搭子，它会先理解我要交付什么。"],
    ["8-15s", "生成清单", "待办清单卡片逐项点亮：整理会议重点、标记明日提醒、同步项目资料。", "重点、提醒、项目资料，它会拆成能执行的清单。"],
    ["15-22s", "结果展示", "李南南侧身看向屏幕，右侧展示完成态 checklist 与 Dumate 小搭子。", "这一步最省心，因为结果不是一段空话，而是可以直接推进的动作。"],
    ["22-30s", "收束", "镜头回到真人半身，桌面干净，背景浅景深，人物看镜头总结。", "把会议内容交给搭子，明天该做什么就清楚了。"]
  ].map(([time, idea, visual, line]) => ({ time, idea, visual, line }));
  prod.topic = "会议待办别再手抄，搭子帮你列清单";
  prod.title = prod.topic;
  prod.artifacts.script = { title: prod.topic, shots, source: "demo", style: "明亮办公室真人口播", imageCount: 6, direction: "" };
  prod.artifacts.boards.items = [
    { title: "输入需求", visual: shots[1].visual, prompt: demoHumanBoardPrompt(1), assetId: "demo-human-cover-1", status: "done" },
    { title: "待办清单", visual: shots[2].visual, prompt: demoHumanBoardPrompt(2), assetId: "demo-human-cover-2", status: "done" }
  ];
  prod.artifacts.boards.sharedRefAssetId = "demo-human-cover-2";
  prod.artifacts.prompts = [{
    name: "真人口播 + 产品界面",
    time: "0-30s",
    front: "9:16 竖屏，0-15s，明亮办公室真人口播。李南南坐在桌前，正面看镜头，说出会议待办痛点；镜头切到 Dumate 输入框，鼠标输入“帮我整理会议重点”，界面白底蓝紫按钮，右侧进度轻微动效。人物表情亲和、语速自然，产品界面文字清晰但不堆叠。",
    back: "9:16 竖屏，15-30s，延续同一办公室和人物。右侧待办清单浮层依次点亮：整理会议重点、标记明日提醒、同步项目资料；人物侧身看屏幕后回到镜头总结。自动加底部中文字幕，字幕不遮挡人物脸和清单。"
  }];
  prod.artifacts.copy = {
    title: "会议待办别再手抄，搭子帮你列清单",
    body: "开完会后，最怕重点散在聊天、文档和脑子里。\n\n这条演示用 Dumate 把会议内容变成三类可执行待办：\n- 整理会议重点\n- 标记明日提醒\n- 同步项目资料\n\n不用从零手抄，先让搭子把结构搭起来。#职场效率 #会议纪要 #待办清单 #Dumate"
  };
  if (batch) {
    prod.stage = "render";
    prod.stageStatus = "running";
    createJob({ kind: "video", productionId: prod.id, segIndex: 0, segName: "真人号片段1", prompt: prod.artifacts.prompts[0].front, refAssetIds: ["demo-human-cover-1"], duration: 15 });
    createJob({ kind: "video", productionId: prod.id, segIndex: 1, segName: "真人号片段2", prompt: prod.artifacts.prompts[0].back, refAssetIds: ["demo-human-cover-2"], duration: 15 });
  } else {
    prod.stage = "script";
    prod.stageStatus = "done";
  }
}

function fillMaterialProduction(prod, batch) {
  const shots = [
    ["展台开场", "百度智能云与 ACG TV 标识出现在深蓝展台背景，车机和人群实拍作为业务现场。", "很多人聊 AI 还停在概念，但真正有价值的是它怎么进到业务现场。", true, 1],
    ["业务场景", "展车、参观者、蓝色光束和展台屏幕交替出现，画面有真实会场流动。", "从模型能力到内容生产，再到企业展台讲解，链路要能跑起来。", false, 1],
    ["内容自动化", "Dumate 产品界面浮层展示脚本、分镜、提示词、剪辑四个节点逐个点亮。", "这套工作台的核心，是把脚本、分镜、生成、字幕和复盘串成一个流程。", true, 2],
    ["素材生成", "素材视频片段在时间线上铺开，底部出现自动字幕轨和 BGM 轨。", "素材号不需要固定人物，可以用实拍、界面和产品镜头完成一条说明片。", true, 2],
    ["数据回流", "发布后的数据卡片回流到分析看板，阅读、收藏、互动率数字增长。", "发布不是终点，数据回传后，下一轮选题和脚本会变得更准。", true, 3],
    ["价值收束", "蓝紫科技线条收束到 ACG TV 标识，展台灯光变亮。", "AI 自动化真正要做的，是把反复的内容生产流程变成可复用的生产线。", false, 3]
  ].map(([idea, visual, line, ui, scene]) => ({ idea, visual, line, ui, scene }));
  prod.topic = "AI 云展台一分钟看懂：从模型到业务现场";
  prod.title = prod.topic;
  prod.artifacts.script = { title: prod.topic, shots, source: "demo", style: "深蓝科技展会实拍混剪", imageCount: 6, direction: "" };
  Object.assign(prod.artifacts.audio, estimateAudio(shots), { source: "demo-voiceover" });
  prod.artifacts.boards.sharedRefAssetId = "demo-material-cover";
  buildMaterialUnits(prod).forEach((u, i) => {
    u.imageAssetId = i === 0 ? "demo-material-cover" : null;
    u.imagePrompt = demoMaterialImagePrompt(i);
    u.videoPrompt = demoMaterialVideoPrompt(i, u.dur);
  });
  prod.artifacts.copy = {
    title: "AI 云展台一分钟看懂：从模型到业务现场",
    body: "这条素材号用展台实拍、产品界面和时间线画面讲清楚一件事：AI 自动化不是只生成一个片段，而是把脚本、分镜、生成、字幕、数据复盘串成稳定生产线。\n\n#AI办公 #智能云 #内容自动化 #Dumate"
  };
  if (batch) {
    prod.stage = "workshop";
    prod.stageStatus = "running";
    const units = buildMaterialUnits(prod);
    units.forEach((u, i) => createJob({
      kind: "video",
      productionId: prod.id,
      segIndex: i,
      segName: `素材号场景${String(u.scene).padStart(2, "0")}`,
      prompt: u.videoPrompt || demoMaterialVideoPrompt(i, u.dur),
      refAssetIds: i === 0 ? ["demo-material-cover"] : [],
      duration: Math.min(15, Math.max(4, Math.ceil(u.dur || 8)))
    }));
  } else {
    prod.stage = "script";
    prod.stageStatus = "done";
  }
}

function demoImagePrompt(i, s) {
  return `小红书笔记风格配图，竖版3:4，白底极简，蓝紫渐变品牌色，Dumate logo 位于顶部，Dumate 3D 小搭子作为辅助角色。第${i + 1}张主题：${s.idea}。画面内容：${s.visual}。图上大字文案：${s.line}。文字要清晰、层级分明，留白充足，不要乱码、不要二维码、不要密集小字。`;
}

function demoHumanBoardPrompt(n) {
  return `9:16 竖屏真人口播分镜图，明亮办公室，年轻女性职场博主李南南坐在白色办公桌前，灰色针织上衣，表情亲和自然。画面右侧出现 Dumate 蓝紫品牌色界面浮层，第${n}段重点清晰可读，桌面有笔记本电脑、马克杯和绿植，正面柔光，背景浅景深，无花字无二维码。`;
}

function demoMaterialImagePrompt(i) {
  return `9:16 竖屏，深蓝科技展台首帧，百度智能云与 ACG TV 标识清晰，展车和参观者作为真实业务现场，蓝紫光束从背景延伸到前景，画面干净、企业级、真实拍摄质感。第${i + 1}个素材单元首帧用于图生视频，禁止额外字幕、二维码、水印。`;
}

function demoMaterialVideoPrompt(i, dur = 8) {
  return `9:16 竖屏，时长${Math.ceil(dur)}秒，纯画面无人声。0-3s｜深蓝展台与百度智能云 / ACG TV 标识建立场景，镜头稳定缓推。3-6s｜展车、人群、产品界面浮层交替出现，蓝紫光束转场，表现 AI 能力进入业务现场。6-${Math.ceil(dur)}s｜画面切到内容生产时间线，脚本、分镜、生成、字幕节点依次点亮，最终收束到 ACG TV 标识。不要字幕、不要水印、不要额外 logo、不要二维码。`;
}
