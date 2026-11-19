# dsh-whale-pet

DeepSeek Harness（DSH）的鲸鱼娘桌面宠物插件。她在 Web 界面上漂浮、用气泡闲聊、被摸头会开心，还能拖到任意位置。

A whale-girl desktop pet plugin for DeepSeek Harness. She floats over the Web UI, chats in bubbles, reacts happily to head pats, and can be dragged anywhere.

![whale-girl](whale-girl-small.png)

## 功能 / Features

- 待机漂浮动画，每 18 秒随机冒出闲聊气泡 / Idle float animation with random chat bubbles every 18 s
- 点击摸头：开心跳起、摇摆 + 星星闪烁 / Click to pat: happy wiggle with sparkles
- 按住拖拽，放到屏幕任意位置 / Drag to any position
- 气泡文案中英双语，跟随界面语言 / Bilingual copy (zh/en) following the UI locale
- 图片以 data URI 内嵌，无外部资源依赖 / The artwork is inlined as a data URI; no external asset fetches

## 两种形态 / Two forms

| 形态 | 位置 | 说明 |
|---|---|---|
| Web 插件 | `client.js` 等 | 浮在 DSH Web 界面里的桌宠，经插件管理器安装 |
| 桌面应用 | `app/` | 独立的 Electron 桌宠：透明置顶无边框窗口，浮在整个操作系统桌面上 |

### 运行桌面应用 / Run the desktop app

```sh
cd app
npm install        # 若 npm 拦截了 electron 的 postinstall，执行 npm install-scripts approve electron && npm rebuild electron
npm start
```

- 她会出现在桌面右下角附近，永远置顶、不占任务栏
- 按住拖拽换位置；点一下摸头；双击暂时隐藏，托盘图标里可“显示”或“退出”
- 需要图形环境；Wayland 下若透明失效，尝试 `npm start -- --ozone-platform=x11`

L1 生命感：显式状态机（idle/sleep/happy/angry/curious/shy/talk，见 `app/pet-states.js`），深夜 23:00–07:00 自动入睡（画面变灰 + 纯 CSS Zzz，点击会被吵醒小生气后继续睡），早晨首次交互有晨间问候；摸头/摸脸/戳肚子按点击位置三区判定，各有独立台词池；台词按时段（morning/afternoon/evening/night）、long-idle、weekday/weekend 条件过滤；托盘子菜单支持静音与话痨程度（话痨/正常/安静），设置经 localStorage 持久化并双向同步。

L1 liveliness: an explicit state machine (idle/sleep/happy/angry/curious/shy/talk, see `app/pet-states.js`); she sleeps 23:00–07:00 (desaturated figure + pure-CSS Zzz; clicking wakes her briefly, then she dozes off again) and greets you on the first morning interaction. Touch zones split by click position — head pats (happy), face (shy), belly pokes (angry) — each with its own bilingual line pools, and idle lines are filtered by context tags (time slot, long-idle, weekday/weekend). Tray submenus toggle chatter mute and talkativeness (talkative/normal/quiet), persisted in localStorage and synced both ways over IPC.

L3 真对话（`app/chat-main.js`、`app/memory.js`）：接入 DeepSeek API，她真的能陪聊了。

- **入口**：托盘菜单“和她说话 / Chat”、或快捷键 Ctrl+Shift+K，在气泡下方弹出输入行（Enter 发送、Esc 关闭）；单击摸头等交互不变。
- **人设**：主进程注入鲸鱼娘 system prompt（温柔、元气、小傲娇，回复 ≤2 句，禁 markdown、禁自称 AI 助手），model `deepseek-chat`，max_tokens 100（硬上限 150），temperature 0.8。
- **API key 安全**：key 只存在于主进程——优先读 Electron `userData/config.json`（托盘“设置 → 配置 API Key…”小窗写入），其次 `DEEPSEEK_API_KEY` 环境变量；base URL 默认 `https://api.deepseek.com`（可用 `DEEPSEEK_BASE_URL` 覆盖）。key 永不进入 renderer 或 localStorage，错误信息不含 key。
- **记忆**（`userData/memory.json`）：最近 40 轮对话滚动保存，请求时注入 system prompt + 最近 8 轮；用户名、在做项目、作息、喜好等事实由轻量正则抽取（不调 LLM），以“你知道的关于主人的事”拼进 prompt；写盘 debounce 1.5 s。
- **体验**：发送后进入 talk 状态、气泡三点跳动“思考”，回复打字机式逐字显示，气泡保留 10 s，对话期间暂停闲聊 timer；API 失败或无 key 时回退本地卖萌台词（中英），托盘菜单提供“配置 API Key…”入口。托盘“对话 / Chat”开关（默认开）关闭后输入框不可用、回退 L1 台词。

L3 real conversation (`app/chat-main.js`, `app/memory.js`): she is wired to the DeepSeek API and can actually chat.

- **Entry points**: tray menu "和她说话 / Chat" or the Ctrl+Shift+K hotkey opens a one-line input under the bubble (Enter sends, Esc closes); single-click head pats and the other touch interactions are unchanged.
- **Persona**: the main process injects a whale-girl system prompt (gentle, energetic, slightly tsundere; replies ≤2 sentences; no markdown; never claims to be an AI assistant), model `deepseek-chat`, max_tokens 100 (hard cap 150), temperature 0.8.
- **API key safety**: the key lives only in the main process — read first from Electron `userData/config.json` (written by the tiny "Configure API Key…" dialog in the tray Settings menu), then from the `DEEPSEEK_API_KEY` environment variable; base URL defaults to `https://api.deepseek.com` (override with `DEEPSEEK_BASE_URL`). It never reaches the renderer or localStorage, and error messages never contain it.
- **Memory** (`userData/memory.json`): a rolling window of the last 40 turns; each request injects the system prompt plus the 8 most recent turns. Facts (your name, current project, sleep schedule, likes) are extracted by lightweight regex rules — no LLM extraction — and appended to the prompt as "things you know about your master"; writes are debounced by 1.5 s.
- **Experience**: sending enters the talk state with a bouncing three-dot "thinking" bubble, the reply types itself out and lingers 10 s, and idle chatter pauses during a conversation. On API failure or a missing key she falls back to local lines (zh/en) and the tray offers "Configure API Key…". The tray "对话 / Chat" checkbox (default on) disables the input and falls back to L1 lines when off.



需要已登录 DSH Web 且本机装有 `gh`/`git`。克隆本仓库后，在 DSH 会话里让 Agent 执行：

```sh
git clone https://github.com/sendwealth/dsh-whale-pet.git
```

然后通过插件管理器以本地目录安装（Agent 工具调用）：

```
plugin_manager install_bundle target=<克隆目录绝对路径>
```

也可以把克隆目录里的 `cordis.patch.yml` 行手工合入你自己的 bundle。

## 文件结构 / Layout

| 文件 | 说明 |
|---|---|
| `package.json` | bundle 清单 + `dsh.client` 注入声明（`shell.overlay` 由 `dsh-client-ui-layout` 声明） |
| `cordis.patch.yml` | 插入 `whale-pet` 插件行 |
| `index.js` | Host 侧入口（渲染全部在 Client） |
| `client.js` | Client 模块：宠物渲染、交互、闲聊文案；含内嵌 base64 图片 |
| `locale/*.json` | 插件管理器展示的标题与描述 |
| `whale-girl-small.png` | 图标用的原图（300×400，透明背景） |

## 开发说明 / Development notes

- 修改 `client.js` 里的文案或行为后，重新安装 bundle 即可生效（Module Loader 每次安装生成新模块）。
- `client.js` 中的 base64 图片由 `whale-girl-small.png` 生成；换图后用
  `node -e "…readFileSync('whale-girl-small.png').toString('base64')…"` 重新替换 `WHALE_GIRL_DATA_URI` 的 `data:image/png;base64,…` 前缀字符串。
- 客户端模块运行在 Module Loader 通道里：只有 `require('react')`、`ctx.*` 与声明注入的服务可用；不要使用 `styles.insert`（那是 `cordis-client-runner` 闭包的 API）。
- 主题颜色一律走 `--dsw-alias-*` token 并带字面量回退。

## 版权说明 / Artwork credit

`whale-girl-small.png` 来自 DeepSeek 官方鲸鱼娘形象，版权归 DeepSeek 所有，此处仅作为个人桌宠用途引用。插件代码部分按 MIT 发布（见 `LICENSE`）。

The whale-girl artwork is DeepSeek's official mascot image; all rights remain with DeepSeek. The plugin code itself is released under the MIT license (see `LICENSE`).
