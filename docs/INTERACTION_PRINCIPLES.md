# Spatial Storytelling Mixer 核心交互原则

## 所滑即所见（Slide What You See）

本系统禁止采用传统GIS软件或三维软件的参数编辑模式。

导演不应编辑：
- Heading
- Pitch
- Roll
- Duration
- FOV
- Relative Altitude

等技术参数。

导演应直接操作：
- 高度轨 (Altitude Track)
- 速度轨 (Speed Track)
- 关注轨 (Look-at Track)
- 时间轴 (Timeline / Playhead)

系统负责将导演动作实时转换为底层技术参数。

任何轨道的修改都必须立即反馈到三维场景。

即：
- **滑动高度轨**：立即看到镜头升降；
- **滑动速度轨**：立即看到飞行节奏变化；
- **滑动关注轨**：立即看到镜头转向；
- **滑动时间轴**：立即看到空间位置变化。

导演永远操作结果。
系统永远负责计算过程。

所有新增功能都必须遵守：
**所滑即所见 (Slide What You See)**。
