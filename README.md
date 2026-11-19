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
