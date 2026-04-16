# 理财与基金数据看板

本地/内网 MVP，用 Next.js 展示基金涨跌、银行理财净值、产品详情、关注清单和采集状态。

## 快速开始

```powershell
npm install
npm run db:push
npm run collect:seed
npm run dev
```

打开 `http://localhost:3000` 查看页面。

## 真实采集

```powershell
pip install -r requirements.txt
npm run collect
```

基金数据优先使用 AKShare。银行理财数据会尝试解析中国理财网公开披露页面；页面结构或访问策略变化时，任务会记录失败并保留旧数据。

## Windows 每日任务

```powershell
powershell -ExecutionPolicy Bypass -File scripts/register_windows_task.ps1
```

计划任务每天 22:30 运行：

```powershell
python scripts/collector/run_daily.py
```

## 数据边界

页面只做公开数据展示和系统计算，不构成投资建议。中国理财网公开披露内容仅按内部/非商业 MVP 使用，公开上线前需要替换为授权数据源。
