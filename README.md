# 深澜 · 福田城市积水情景演示

基于 [nannnnn-1/smartcity](https://github.com/nannnnn-1/smartcity) 的前端完善版，保留深圳福田数据、城市模型及三套预计算暴雨情景。原始基础版本：`f90e8cbe71fa4a5d1afbee9d032388d65f938a5f`。

## 网站功能

三维城市与六类图层；三套降雨情景；播放/暂停/倍速/时间轴；16 个虚拟监测点及水深过程线；风险统计、峰值定位、完整演示重置与处置建议示意。

可在「积水绕行」选择两个路口或在地图点选地面道路。系统按当前情景、时刻、方向、转向限制及水深阈值重新计算路线。福华一路示例用红线标出需要避开的积水区段。[直接打开示例](https://shallowpromise.github.io/smartcity/?view=routes) · [数据与模型说明](docs/route-model.md)

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

绕行交互回归可在服务启动后运行 `BASE_URL=http://127.0.0.1:8088 node tests/routes-browser.mjs`。在仓库根目录运行 `node scripts/solve-route.mjs 7959603173 8516154909 replay-2309 240 15` 可复算福华一路案例。

## 数据来源与归属

沿用原项目的数据与模型成果：© OpenStreetMap contributors（ODbL 1.0）；Mapzen Terrarium / AWS Open Data；Open-Meteo ERA5-Land（CC-BY 4.0）；深圳市相关部门公开信息。详细来源和研究方法参见原项目。本版另从 OpenStreetMap 补取转向关系与道路障碍数据，建立地面道路通行及逐帧避水求路模型。

风险色标沿用原型前端规则；道路/社区蓝 0.05、黄 0.15、橙 0.30、红 0.50、紫 1.00 m，下穿乘 0.62，河道乘 1.6，并非官方预警标准。页面计数使用该规则，与原情景文件中的 warn 字段口径存在差异，待模型负责人统一确认。

## 界面设计

三维底图采用日间建筑材质与浅绿公园配色。导航、侧栏、情景卡、指标和点位详情使用浅色半透明玻璃，动态告警行和处置建议共享柔和的折射轮廓。Chromium 使用 SVG 位移滤镜；其他浏览器使用半透明模糊材质。开启增强对比度或减少透明度后自动切为实色。实现参考 [archisvaze/liquid-glass](https://github.com/archisvaze/liquid-glass) 和 [apple-design](https://github.com/tzzs/apple-design-skill)。液态玻璃参考项目的 MIT 许可附于 `system/public/vendor/liquid-glass/LICENSE`。

顶部「专注地图」可隐藏侧栏，「显示面板」可恢复。
