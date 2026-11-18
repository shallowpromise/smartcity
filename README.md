# 深澜 · 福田城市积水风险研判平台

基于 [nannnnn-1/smartcity](https://github.com/nannnnn-1/smartcity) 的前端完善版，保留深圳福田数据、城市模型及三套预计算暴雨情景。基准版本为 `f90e8cbe71fa4a5d1afbee9d032388d65f938a5f`。

## 网站功能

[打开平台](https://shallowpromise.github.io/smartcity/) · [数据研判](https://shallowpromise.github.io/smartcity/?view=analysis)

- **街道雨量**展示福田区 10 个街道的半小时、1 小时和 3 小时官方阈值、当前余量和风险提示。可对照情景降雨或导入带时间戳的实况累计雨量。[街道阈值](https://shallowpromise.github.io/smartcity/?view=analysis&tab=rain)
- **设施**可查询 70 条室内、55 条室外避难场所记录及模型范围内的 241 个 OSM 地铁出入口。按街道、名称、类型、登记容量筛选后可查看来源、定位依据、模型水深和超阈时长。77 条场所记录匹配到参考位置，44 条有地面网格采样，37 条可接驳地面路网。开放状态和现场入口待属地核实。[设施名录](https://shallowpromise.github.io/smartcity/?view=analysis&tab=sites)
- **绕行**根据当前时刻的模型水深、道路方向和禁转关系计算。场所接驳可比较避水最短与低水深优先路线。福华一路案例中，替代线增加 55 米，沿线模型最高水深从 49 cm 降到 2 cm。[绕行案例](https://shallowpromise.github.io/smartcity/?view=routes) · [模型与数据说明](docs/route-model.md)
- **避雨导航**可授权一次设备定位，也可随机生成福田中心片区的模拟起点。平台按当前时刻可通行的步行路程和两端接驳距离，推荐最近的室内避难场所，显示分段指引、沿线模型最高水深和绕行增加的距离。当前有 17 处室内场所可参与计算，实际入口及开放状态待核实。设备坐标只用于浏览器内计算。[使用我的位置](https://shallowpromise.github.io/smartcity/?view=rain-nav) · [体验积水绕行](https://shallowpromise.github.io/smartcity/?view=rain-nav&start=demo)
- **工况**并排显示同一时刻的基准与比较网格。六个工况涵盖排水能力降至 70%、局部堵塞、南侧两档水位顶托，以及按深圳中部流域 2024 版公式生成的 5 年和 50 年设计雨型。每组有 49 帧，可同步播放和比较水深、积水面积、暴露人口和点位差值。[同帧工况对比](https://shallowpromise.github.io/smartcity/?view=analysis&tab=compare)
- **实测校核**支持在浏览器导入 WGS84 站点地面积水观测，核对 9·7 复盘的同地点、同期有效样本。指标包括平均绝对误差、峰值和峰现时刻偏差，以及 15 cm 阈值的命中、漏报、空报。无实测覆盖时显示“未验证”。[实测校核](https://shallowpromise.github.io/smartcity/?view=analysis&tab=verify)
- **态势总览**展示水深、积水面积、预警点数和受影响人口。“水深解读”可展开查看网格统计与地表产流对比。[径流计算方法](docs/runoff-card.md)
- **监测预警**可查看按水深排列的 16 个虚拟点、风险分级和点位详情。**推演研判**可切换三套降雨情景、查看降雨曲线并控制播放。**联动处置**按当前风险列出建议、协同单位与时效。顶部每次只打开所选面板，四页共用地图与时间轴。[监测预警](https://shallowpromise.github.io/smartcity/?view=monitor) · [推演研判](https://shallowpromise.github.io/smartcity/?view=simulate) · [联动处置](https://shallowpromise.github.io/smartcity/?view=dispatch)

名录和阈值保留发布机构及资料日期。图上水深、道路通行条件和顶托工况来自模型。街道与站点导入文件只在当前页面处理，刷新后清除。官方实时雨量、水位、道路管制和场所开放状态待接入。[数据来源与覆盖](https://shallowpromise.github.io/smartcity/?view=analysis&tab=sources)

## 如何解读几十厘米的水深

点击左侧「水深解读」，可按当前帧查看达到 5 cm 的网格水深中位数，以及达到 50 cm 的网格数。9·7 情景第 210 分钟，最深网格为 59.3 cm；26,112 格中有 1,861 格达到 5 cm，这些格子的水深中位数为 9 cm，4 格达到 50 cm。统计使用导出的厘米网格，最大值使用模型导出的米制统计量。虚拟监测点曾按 50 年一遇情景的深水格辅助选址，并按当前水深排列告警。

模型按地表类型使用 SCS-CN 估算下渗、截留等综合降雨损失。道路 CN 为 96，绿地为 58。模型再将产流按地形汇集，并按设定的排水能力移除地表水。9·7 使用设定总量 300 mm 的八小时合成雨型。公开通报记录了福田低洼路段因汇水和下游顶托发生积水，具体路口的模型数值仍需同时同地的实测记录校核。[福田区水务局对此次积水的答复](https://www.sznews.com/zhuanti/content/mb/2023-09/14/content_30475114.htm)

原计算使用约 32 m 网格及概化排水参数。9·7 存档的水量闭合比约为 0.895，诊断分母取模型累计产流体积，未逐项列出屋面折减和边界等收支。这一比值不能直接用于修正水深。地表损失计算采用绿地 CN 58、道路 CN 96。

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

避雨导航的浏览器回归命令为 `BASE_URL=http://127.0.0.1:8088 node tests/walk-browser.mjs`。测试使用浏览器提供的测试坐标，覆盖位置权限、随机起点、可达场所排序与移动端地图。

## 数据来源与归属

沿用原项目的数据与模型成果：© OpenStreetMap contributors（ODbL 1.0）；Mapzen Terrarium / AWS Open Data；Open-Meteo ERA5-Land（CC-BY 4.0）；深圳市相关部门公开信息。详细来源和研究方法参见原项目。本版另从 OpenStreetMap 补取转向关系与道路障碍数据，建立地面道路通行及逐帧避水求路模型。

模型点位的基准水深分级为道路/社区蓝 0.05、黄 0.15、橙 0.30、红 0.50、紫 1.00 m，下穿乘 0.62，河道乘 1.6。街道阈值另取自 2026 版官方指引。页面计数使用该规则，与原情景文件中的 warn 字段口径存在差异。

## 离线复算

地面网格取自上述基准版本的 `data/processed/grid.npz`。运行以下命令需要 Python 3.10+、NumPy、openpyxl、pdfplumber 以及本次官方资料包。

```sh
python3 scripts/build-official-data.py /path/to/official.zip scripts/facility-osm-20261118.json /path/to/grid.npz
python3 scripts/build-sensitivity.py /path/to/grid.npz
```

导入器逐行核对官方名录和街道阈值，复用带来源的 OSM 参考快照。模型以原版 50 年工况的 49 帧水深网格逐字节一致作为复算检查。新增工况在同一网格、排水与产流计算程序中调整指定输入。顶托水位使用模型高程基准。面积退水时间指面积峰值至首次降到其一半的时间。设计雨型以 3 小时交替区块降雨和随后 5 小时退水构成。

## 界面设计

导航和情景选择各共享一枚随选项移动的玻璃胶囊。桌面按钮的高光跟随指针，触屏按钮在按下时轻微收缩。侧栏、工具条和时间轴各自对背后的地图做一次光学处理，内部指标和告警共享该背景。网页设计参考 [ECC 的 Liquid Glass 指南](https://github.com/affaan-m/ECC/blob/main/docs/zh-CN/skills/liquid-glass-design/SKILL.md)。

Chromium 使用 SVG 边缘折射，支持背景模糊的其他浏览器使用 CSS 材质。增强对比度或减少透明度时显示实色面板，减少动态效果时关闭胶囊滑动和跟随高光。原边缘折射参考 [archisvaze/liquid-glass](https://github.com/archisvaze/liquid-glass)，许可见 `system/public/vendor/liquid-glass/LICENSE`。[改版前的完整备份](https://github.com/shallowpromise/smartcity/tree/before-ecc-liquid-glass)

顶部「专注地图」可隐藏侧栏，「显示面板」可恢复。
