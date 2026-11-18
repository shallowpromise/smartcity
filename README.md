# 深澜 · 福田城市积水情景演示

基于 [nannnnn-1/smartcity](https://github.com/nannnnn-1/smartcity) 的前端完善版，保留深圳福田数据、城市模型及三套预计算暴雨情景。原始基础版本：`f90e8cbe71fa4a5d1afbee9d032388d65f938a5f`。

## 网站功能

三维城市与六类图层；三套降雨情景；播放/暂停/倍速/时间轴；16 个虚拟监测点及水深过程线；风险统计、峰值定位、完整演示重置与处置建议示意。

顶部选择「积水绕行」，再点「查看红荔路绕行示例」，即可定位 9·7 复盘的第 4 小时，对比两条路线的距离和沿线最高模型水深。可以切换红荔路、福华三路、福中一路三组起终点，改变演示阈值，或拖动时间轴。无候选线满足条件时，面板会给出提示。

演示采用有向地面路网，按共享 OSM 节点连接道路，考虑基本单行和静态通行标签，排除已标注的桥隧及非地面层。固定路口的候选路线在三套情景各帧和三档阈值下离线求得，网页按当前帧重新比较。任意路口选点、桥隧、禁转、实测与规则校核所需资料见 [A 同学的数据与模型任务单](docs/A_ROUTE_HANDOFF.md)。

所有数据均为静态文件。监测点为模型辅助选址的虚拟点位，水深为模型结果，未经逐点实测率定；仅供课程展示，不用于真实防汛决策。没有实时监测或实际调度接入。

## 本地运行

Node.js 18+，当前版本 Chrome/Edge，启用 WebGL2。无需安装依赖即可启动：

```bash
cd system
node server.mjs
```

访问 http://127.0.0.1:8088 。也可使用普通静态 HTTP 服务，以 `system/public` 为根目录。

## GitHub Pages

仓库 Settings → Pages → Source 选择 GitHub Actions。推送到 main 或手动运行工作流即可发布。发布产物仅包含 `system/public`，无需业务后端。查看 Actions 部署输出获得访问网址。

## 验证

```bash
node --test system/tests/*.test.mjs
```

浏览器回归需在 system 目录执行 `npm ci`、`npx playwright install chromium`；启动本地服务后运行 `node tests/browser.mjs`。`node tests/pages.mjs` 单独创建临时静态服务验证项目子路径。

绕行交互回归可在服务启动后运行 `BASE_URL=http://127.0.0.1:8088 node tests/routes-browser.mjs`。如需重新生成候选路线，在仓库根目录运行 `python3 scripts/build-route-candidates.py /path/to/osm_raw.json`，传入课程源仓库的原始 OSM 文件。

## 数据来源与归属

沿用原项目的数据与模型成果：© OpenStreetMap contributors（ODbL 1.0）；Mapzen Terrarium / AWS Open Data；Open-Meteo ERA5-Land（CC-BY 4.0）；深圳市相关部门公开信息。详细来源和研究方法参见原项目。未重新采集数据或重建水文模型。

风险色标沿用原型前端规则；道路/社区蓝 0.05、黄 0.15、橙 0.30、红 0.50、紫 1.00 m，下穿乘 0.62，河道乘 1.6，并非官方预警标准。页面计数使用该规则，与原情景文件中的 warn 字段口径存在差异，待模型负责人统一确认。

## 界面设计

本次美化采用 [apple-design 技能](https://github.com/tzzs/apple-design-skill) 的内容层级、材质与可访问性指导，为桌面网页实现独立的 `apple-design.css`：玻璃质感导航与工具栏、稳定的数据卡片背景、系统字体、统一圆角、克制的蓝色主操作，以及高对比度/减少动态效果支持。这是网页视觉适配，并非 Apple 原生 Liquid Glass 组件。

顶部“专注地图”可隐藏侧栏，点击“显示面板”或导航可恢复。原三维模型、风险色标、播放及重置功能保持不变。
