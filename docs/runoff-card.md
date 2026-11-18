# 绿地与道路径流对比

在“态势总览 → 水深解读”选择 50、100 或 200 mm 累计降雨，可查看同一场雨在两类地表产生的直接径流。两条横条共用所选雨量作为满量程。综合损失包括下渗与截留。后续积水深度还取决于地形汇流和排水能力。

计算沿用模型的 SCS-CN 参数，绿地 CN 为 58，道路 CN 为 96。若累计降雨 P 不超过 0.2S，累计径流 Q 为零。超过初损后，Q = (P − 0.2S)² / (P + 0.8S)，其中 S = 25400 / CN − 254，单位均为毫米。综合损失为 P − Q。[HEC-HMS 技术手册](https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/canopy-surface-infiltration-and-runoff-volume/infiltration/scs-curve-number-loss-model)

| 100 mm 累计降雨 | 直接径流 | 下渗、截留等综合损失 |
| --- | ---: | ---: |
| 绿地 | 16.2 mm | 83.8 mm |
| 道路 | 88.3 mm | 11.7 mm |

产流对比卡独立于地图时间轴，可以在同一时刻切换雨量进行比较。
