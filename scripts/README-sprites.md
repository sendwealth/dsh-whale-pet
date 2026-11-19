# 素材流水线（prepare_sprites.py）

一条命令把源精灵帧处理成生产可用的透明 PNG + manifest：

```bash
python3 scripts/prepare_sprites.py
```

- 输入（只读，永不改动）：`whale_girl_all_sprite_frames_v0.2/whale_girl_sprite_frames/`
  （86 帧，13 组；fps/loop/中文标签来自同目录 `animations.json`）
- 输出：
  - `app/assets/sprites/<anim>/<anim>_NNN.png`（RGBA，透明背景）
  - `app/assets/sprites/manifest.json`：version / generatedBy / animations
    （labelZh、frameCount、fps、loop、width、height、anchorX/anchorY（0-1 归一化，
    角色脚底中心）、frames 列表）
  - `scripts/preview_contact_sheet.png`：每组一行的拼贴预览，供人眼验收

## 处理步骤

1. **think 组白色抠底**：对 RGB 各 ≥242 且通道极差 ≤12 的"近白"像素建掩码，
   从图像四边做 4-连通 flood-fill，只清除与边界连通的背景连通域；
   另外仅清除与背景域相邻（膨胀 2px 环内）的近白抗锯齿 fringe。
   角色内部的白眼睛/白色装饰因不与边界连通而被保留（think_001 保留约 13.7k 内部白像素）。
2. **残留光晕清理（所有帧）**：alpha ≤ 48 的低透明噪点（蓝灰光晕、interact 角落
   alpha≈105 以下的噪点由阈值+边缘处理一并覆盖）直接置 0。
3. **de-fringe / unpremultiply**：对 48<alpha<255 的边缘半透明像素，按
   `fg = (rgb - bg*(1-a)) / a` 扣除烘进像素的背景色。背景色估计：非 think 帧取
   该帧微透明像素（0<a≤48）的平均 RGB（实测约 RGB(100,122,177) 蓝灰），
   think 帧固定 (254,254,254)。
4. **裁切与对齐**：按内容 bbox（alpha>8）取**组内并集** + 2px padding 裁切，
   保证组内所有帧同尺寸、角色不跳动；anchor 记录为并集 bbox 底边中心相对
   原画布的归一化坐标。

## 依赖与再生成

- 开发期工具，仅依赖系统 Pillow 与 numpy（不进运行时 package.json 依赖）。
- 脚本幂等、确定性：重复运行输出逐字节一致（已用 sha256 验证）；源目录与 zip 不动。
- 换源素材后重跑一条命令即可全部再生成；如需调参见脚本顶部常量
  （`ALPHA_CUTOFF`、`WHITE_MIN`、`WHITE_SAT_MAX`、`PADDING`）。
