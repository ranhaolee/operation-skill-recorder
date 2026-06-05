# Operation Skill Recorder (OSR)

捕捉用户在浏览器中操作某系统时的 **UI 操作流 + 内部 API 调用**，并据此自动生成可复用的 **技能 (skill)** —— 同时产出 **AI/人可读的 Markdown 文档** 和 **可执行的 Playwright 脚本**。

> 这是第一版 (v1)，目标是把"捕捉 → 关联 → 生成技能"整条链路跑通看效果。
> 为了零安装摩擦，v1 后端用 Node 内置 `http` + JSON-lines 文件存储（无需 `npm install`），扩展用纯 JS（免构建）。后续阶段再换 Fastify + SQLite。

---

## 架构

```
浏览器扩展 (MV3)                         本地后端 (Node, 零依赖)
 ├─ injected.js  patch fetch/XHR   ──┐   ├─ /ingest        收事件 → events.jsonl
 ├─ content.js   抓 DOM 操作+定位符  ├─► ├─ 切分 + UI/API 关联
 └─ background.js 缓冲/批量上报       ┘   ├─ Skill IR (中间表示)
                                          └─ 渲染 → skills/<name>/
                                                ├─ SKILL.md        (文档)
 Dashboard (http://localhost:3737)            ├─ <name>.spec.ts   (可执行)
 回看会话 / 一键生成技能                        └─ skill.ir.json    (中间表示)
```

核心思想：先把操作流抽象成与输出格式无关的 **Skill IR**，再用两个 renderer 分别渲染成文档和脚本；合成策略可在 **规则引擎(默认/离线)** 与 **LLM 增强** 之间切换。

---

## 快速开始

### 1. 启动后端

```powershell
cd operation-skill-recorder/server
node src/server.js
```

看到 `Dashboard: http://localhost:3737/` 即成功。无需 `npm install`（v1 零依赖）。

### 2. 加载浏览器扩展（Chrome / Edge）

1. 打开 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择 `operation-skill-recorder/extension` 目录

### 3. 录制一段操作

1. 浏览器打开要操作的系统页面。演示页直接访问 **`http://localhost:3737/test-page/`**（通过 http 打开，扩展才会注入；`file://` 默认不运行内容脚本）
2. 点扩展图标 → **● 开始录制**（图标出现红色 `REC` 角标）
3. 正常操作系统：填表、点击、提交……扩展会自动捕捉 UI 操作和后台 API
4. 完成后点 **■ 停止录制**

### 4. 生成技能

1. 点扩展里的 **打开 Dashboard**（或浏览器访问 `http://localhost:3737/`）
2. 左侧选中刚才的会话，能看到完整操作流（UI / API 事件）
3. 选择合成引擎（规则引擎 / LLM 增强），点 **⚙️ 生成技能**
4. 生成结果写入 `skills/<技能名>/`：
   - `SKILL.md` —— 给人 / AI Agent 读的技能文档
   - `<技能名>.spec.ts` —— 可直接 `npx playwright test` 运行的脚本
   - `skill.ir.json` —— 中间表示

---

## 不用扩展也能验证（开发自测）

`server/seed.js` 会用与扩展完全相同的事件格式，向运行中的服务回放一段"创建工单"操作并生成技能：

```powershell
cd operation-skill-recorder/server
node src/server.js          # 终端 A
node seed.js                # 终端 B
```

然后查看 `skills/` 下生成的文件。

---

## LLM 增强（可选）

规则引擎离线可用。若想让 Claude 优化技能命名 / 描述 / 参数语义，设置环境变量后在 Dashboard 选 "LLM 增强"：

```powershell
$env:OSR_ANTHROPIC_API_KEY = "sk-ant-..."
node src/server.js
```

未配置 key 时会自动回退到规则引擎。

---

## 关键设计与已知限制

- **响应体捕捉**靠在页面上下文重写 `fetch`/`XHR`（`injected.js`）。少数站点的 CSP 可能拦截脚本注入，此时 UI 仍能捕捉、API 可能缺失。
- **元素定位**优先 `data-testid` / `id` / `name` / `aria-label`，回退到结构化 CSS 路径，以提升技能回放的健壮性。
- **脱敏**：`authorization`/`cookie` 等请求头、`password`/`token` 等字段、以及 password 输入框的值，在落库前即被替换为 `«redacted»`。
- **录制开关**：仅在显式"开始录制"后才捕捉，避免误采集。

---

## 目录结构

```
operation-skill-recorder/
├── extension/            MV3 扩展（免构建，纯 JS）
│   ├── manifest.json
│   ├── popup.html / popup.js
│   └── src/{content,injected,background}.js
├── server/               后端 + 技能引擎（零依赖）
│   ├── src/{server,store,correlate,ir,synthesizer,renderers,dashboard,config}.js
│   └── seed.js           自测回放脚本
├── test-page/            演示用的迷你"系统"页面
└── skills/               生成的技能产物（git 忽略内容）
```

---

## 路线图

- [x] **阶段 1**：捕捉 UI+API → 落库 → Dashboard 回看
- [x] **阶段 2**：会话切分 + UI/API 关联
- [x] **阶段 3**：规则引擎合成 skill（文档 + 脚本）+ LLM 增强接口
- [ ] **阶段 4**：用 Playwright 回放生成的脚本，闭环验证 skill 正确性
- [ ] 后端迁移到 Fastify + SQLite；Dashboard 升级为 React；技能编辑/合并
