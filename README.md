# dsh-whale-pet

独立运行的 Electron 鲸鱼娘桌面宠物：透明置顶无边框窗口浮在整个操作系统桌面上，能用精灵帧动画做出 13 种动作、用气泡闲聊、被摸头会开心，还能拖到任意位置、替你值守 DeepSeek agent 任务。

A standalone Electron whale-girl desktop pet: a transparent always-on-top frameless window floating over your OS desktop, with 13 sprite-frame animations, chat bubbles, head-pat reactions, free dragging, and optional DeepSeek agent duty.

![whale-girl](app/whale-girl-small.png)

## 运行 / Run

```sh
cd app
npm install        # 若 npm 拦截了 electron 的 postinstall，执行 npm install-scripts approve electron && npm rebuild electron
npm start
```

- 她会出现在桌面右下角附近，永远置顶、不占任务栏
- 按住拖拽换位置；点一下摸头；双击暂时隐藏，托盘图标里可“显示”或“退出”
- 需要图形环境；Wayland 下若透明失效，尝试 `npm start -- --ozone-platform=x11`

## 功能总览 / Features

### L1 生命感（`app/pet-states.js`、`app/sensors.js`、`app/sprite-animator.js`）

显式状态机（idle/talk/curious/shy/happy/sleep/angry，带 minDur 持续窗与优先级仲裁）驱动 13 组精灵帧动画：待机呼吸、随机眨眼（6–14s）、开心、生气、惊讶、害羞（interact）、入睡、被拖拽定格、agent 思考、CPU 忙碌工作，以及“吃饭”彩蛋（连续运行 ≥4 小时后随机触发，每天 ≤2 次）。深夜 23:00–07:00 自动入睡，早晨首次交互有晨间问候；摸头/摸脸/戳肚子按点击位置三区判定，各有独立台词池；台词按时段、long-idle、weekday/weekend 条件过滤。传感器事件（鼠标靠近、久坐空闲、CPU 忙碌）经事件中枢接入状态机。托盘子菜单支持静音与话痨程度，设置经 localStorage 持久化并双向同步。

An explicit state machine (with hold windows and priority arbitration) drives 13 sprite clips: idle breathing, random blinks, happy, angry, surprised, shy, sleep, drag freeze, agent thinking, CPU-busy working, and a once-a-while "eat" easter egg (after 4 h of uptime, at most twice a day). She sleeps 23:00–07:00, greets you in the morning, and head/face/belly touch zones each have their own bilingual line pools filtered by time slot, long-idle, and weekday/weekend context. Sensor events (mouse approach, idle, CPU) feed the same hub. Tray submenus toggle mute and talkativeness, persisted in localStorage and synced over IPC.

### L3 真对话（`app/chat-main.js`、`app/memory.js`）

接入 DeepSeek API 的真实陪聊。

- **入口**：托盘菜单“和她说话 / Chat”、或快捷键 Ctrl+Shift+K，在气泡下方弹出输入行（Enter 发送、Esc 关闭）；单击摸头等交互不变。
- **人设**：主进程注入鲸鱼娘 system prompt（温柔、元气、小傲娇，回复 ≤2 句，禁 markdown、禁自称 AI 助手），model `deepseek-chat`，max_tokens 100（硬上限 150），temperature 0.8。
- **API key 安全**：key 只存在于主进程——优先读 Electron `userData/config.json`（托盘“设置 → 配置 API Key…”小窗写入），其次 `DEEPSEEK_API_KEY` 环境变量；base URL 默认 `https://api.deepseek.com`（可用 `DEEPSEEK_BASE_URL` 覆盖）。key 永不进入 renderer 或 localStorage，错误信息不含 key。
- **记忆**（`userData/memory.json`）：最近 40 轮滚动保存，请求注入 system prompt + 最近 8 轮；用户名、在做项目、作息、喜好等事实由轻量正则抽取（不调 LLM）；写盘 debounce 1.5 s。
- **体验**：发送后 talk 状态、三点跳动“思考”、打字机回复、气泡保留 10 s；API 失败或无 key 时回退本地卖萌台词（中英）；托盘“对话 / Chat”开关（默认开）关闭后回退 L1 台词。

### L4 agent 化身与审批气泡（`app/agent-bridge.js`，实验功能）

托盘“设置 → 连接助手 / Connect agent”开启后，主进程 spawn 一个 `dsh --profile sdk` runtime 子进程，她从桌宠变成这个 agent 的化身。

- **需要本地 DSH checkout**：默认约定路径 `/home/rowan/Projects/deepseek-harness`（其 `packages/sdk/client/lib` 构建产物与 `apps/cli/lib/bin.js` 是硬依赖），可用 `userData/config.json` 的 `dshCheckout` / `agentDshHome` 覆盖；runtime 路径与环境变量只存在于主进程。
- **状态化身**：`session.status`（running/idle）直接驱动她的姿态——running 进入“思考”动画；idle 且刚完成任务时报“任务完成了～”；闲聊气泡在 agent 忙碌时让位。
- **审批气泡**：`approval/request` / `user-question/ask` 到达时，普通气泡升级为审批卡片（工具名 / 理由 / 问题摘要 + “允许一次 / 拒绝”），点击即回填 `allowed-once` / `rejected`（问题则回答首个选项或取消）。绝不自动批准；断开连接时未决审批按取消失败关闭。
- **输入框模式**：Ctrl+Shift+K 输入行复用——连接开启时派发给 agent（`session/prompt`）并显示“派任务”标记；否则仍是 L3 聊天（“聊天”标记）。
- **生命周期**：`session.event` 只保留 `turn/end` 防内存爆；退出走 SDK 的 EOF→SIGTERM→SIGKILL 拆除阶梯；runtime 崩溃 → 离线气泡 + 托盘 tooltip，不自动重启。
- **无 key 的诚实行为**：无 `DEEPSEK_API_KEY` 时任务回合真实失败关闭（`MISSING_CREDENTIAL`），气泡如实说明。离线冒烟 `node app/agent-smoke.js`（纯 Node，不依赖 Electron）覆盖 spawn → initialize → 状态通知 → 任务失败关闭 → shutdown 全链路。

L4 SDK 连接协议与 W1 PoC 结论详见 [docs/l4-dsh-sdk-research.md](docs/l4-dsh-sdk-research.md)。

## 精灵素材管线 / Sprite pipeline

角色动画基于 86 帧 PNG（13 组），由可复现流水线从原始精灵图集加工：

```sh
python3 scripts/prepare_sprites.py    # 幂等，重跑逐字节一致
```

- **输入**：`whale_girl_all_sprite_frames_v0.2/`（不入库，见 [.gitignore](.gitignore)；zip 由作者提供）
- **加工**：清除烘焙背景残留光晕（alpha<48 全部置 0）、边缘 de-fringe、think 组白底四边 flood-fill 抠图（保留角色内部白色）、组内 bbox 并集统一裁切、计算脚底锚点
- **输出**：`app/assets/sprites/<anim>/*.png` + `manifest.json`（每组 frameCount/fps/loop/尺寸/anchor，是运行时的唯一真相）
- **目检**：`scripts/preview_checkboard_sheet.png`（棋盘格底）、`scripts/preview_contact_sheet.png`
- **方法**：[scripts/README-sprites.md](scripts/README-sprites.md)

运行时由 `app/sprite-animator.js`（纯逻辑、可注入时钟）按 manifest 的 fps/loop 推帧，`app/pet.js` 的仲裁顺序为：拖拽 > 睡觉 > agent 思考 > CPU 工作 > 吃彩蛋 > 状态表情；换组时按 anchor 平移保证脚底不漂移。

## 开发 / Development

```sh
cd app
npm test                          # node --test，60 项，零依赖
WHALE_SKIP_DOM=1 npm test         # 无 Electron DOM 环境的降级路径
node app/agent-smoke.js           # L4 离线全链路冒烟（无需 API key）
timeout 8 ./node_modules/.bin/electron . ; echo $?   # 冒烟：124=健康驻留
```

CI：`.github/workflows/test.yml` 每次推送在 ubuntu + xvfb 上跑全量测试。

| 文件 | 说明 |
|---|---|
| `app/main.js` | 窗口/托盘/拖拽轮询/全屏基线检测/设置白名单 |
| `app/pet.js` | 渲染层：状态接线、动画仲裁、气泡、台词、聊天输入 |
| `app/pet-states.js` | 显式状态机（minDur + 优先级） |
| `app/sprite-animator.js` | 帧推进器（可注入时钟，纯逻辑） |
| `app/sensors.js` | 传感器事件中枢 |
| `app/chat-main.js` | DeepSeek API 主进程代理（key 只在主进程） |
| `app/memory.js` | 对话记忆与事实抽取 |
| `app/agent-bridge.js` | DSH SDK agent 连接与审批桥 |
| `app/lib-workarea.js` | 位置钳制/全屏判定纯函数 |
| `app/assets/sprites/` | 加工后的帧动画资产 + manifest |
| `docs/` | L4 调研、QA 审计、精灵集成规格 |

## 版权说明 / Artwork credit

鲸鱼娘形象来自 DeepSeek 官方；精灵帧由官方风格的生成图集加工而来，版权归 DeepSeek 所有，此处仅作为个人桌宠用途引用。代码部分按 MIT 发布（见 `LICENSE`）。

The whale-girl artwork derives from DeepSeek's official mascot imagery; all rights remain with DeepSeek, used here solely as a personal desktop pet. The code itself is released under the MIT license (see `LICENSE`).
