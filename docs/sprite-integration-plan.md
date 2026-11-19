# 精灵帧动画集成规格（v1 待流水线产物落地后执行）

素材：`app/assets/sprites/<anim>/<anim>_NNN.png` + `app/assets/sprites/manifest.json`
（由 `scripts/prepare_sprites.py` 从 `whale_girl_all_sprite_frames_v0.2/` 生成）

## 状态 → 动画映射

| 状态机/事件 | 动画 | loop | 说明 |
|---|---|---|---|
| idle | idle | ✓ | 基础待机；随机间隔插入一次 blink（非循环播完回 idle） |
| talk | idle | ✓ | 说话时用 idle，气泡承担表达 |
| happy | happy | ✗ | 播完回 idle |
| angry | angry | ✗ | 播完回 idle（可循环至 minDur 结束） |
| sleep | sleep | ✓ | 替代 grayscale filter |
| shy (摸中部) | interact | ✗ | 原 shy CSS 动画退役 |
| curious | surprised | ✗ | 鼠标靠近探出 |
| 拖拽中 | drag | ✓ | begin-drag→end-drag 区间 |
| agent 任务中 | think | ✓ | agentBusy/chatting 期间 |
| cpu-busy | work | ✓ | 传感器事件期间 |
| 闲逛彩蛋 | walk | ✓ | 随机走动（L2 遗留 wiggle 升级） |
| follow 模式彩蛋 | follow | ✓ | 设置项，跟随鼠标 |
| eat 彩蛋 | eat | ✗ | 长时间陪伴后随机触发（每天≤2 次） |

## 新模块 app/sprite-animator.js

- 纯逻辑、可注入时钟与回调，风格对齐 pet-states.js（含 module.exports 守卫）
- `SpriteAnimator.create({ manifest, clock, onFrame })`：play(anim, {loop, holdLast})、stop、当前帧索引；帧率来自 manifest
- 渲染层绑定：把 `onFrame` 指向设置 `img.src`（预加载全部帧后才开始播，避免闪烁）
- resize：CSS `image-rendering: auto`，按组高缩放到约 130px 高，anchorX/anchorY 保持脚底贴地
- 回归 CSS：删除 happy/angry/shy/sleep 等 figure keyframe（保留 bob 作为无动画 fallback）

## 测试要求（延续 QA 闭环：每个行为有测试）

1. `app/tests/sprite-animator.test.js`：注入假时钟——帧推进、loop 回绕、非循环播完回调、fps 尊重 manifest
2. `app/tests/sprites-assets.test.js`：manifest 与磁盘文件一致（帧数、文件存在、尺寸一致、anchor 在 0-1）
3. dom-smoke 更新：状态切换后 img.src 变化、sleep 状态不再依赖 filter
