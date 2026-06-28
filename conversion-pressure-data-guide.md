# 可转债转股压力图表数据补齐指南

这个文档用于一步步补齐“可转债转股是否压制正股股价”的日频分析数据。目标图表需要把正股收盘价、正股成交量、每日新增转股数量放到同一个交易日期轴上对比。

## 1. 最小可用数据

先补齐下面 4 个字段，就可以做出第一版图表。

| 字段 | 含义 | 用途 | 必需 |
| --- | --- | --- | --- |
| `date` | 交易日期 | 统一时间轴 | 是 |
| `stock_close` | 正股收盘价 | 观察股价走势 | 是 |
| `stock_volume` | 正股成交量 | 判断市场承接和异常放量 | 是 |
| `stock_amount` | 正股成交额 | 辅助判断资金承接强弱 | 建议 |
| `pct_change` | 正股涨跌幅 | 快速识别价格冲击 | 建议 |
| `new_conversion_shares` | 每日新增转股数量 | 衡量新增股票供给压力 | 是 |

建议 CSV/JSON 字段先按这个结构准备：

```csv
date,stock_code,bond_code,stock_close,stock_volume,stock_amount,pct_change,new_conversion_shares
2026-06-01,000001,127000,12.69,5760,73120,-1.10,24.3
```

单位建议：

| 字段 | 推荐单位 |
| --- | --- |
| `stock_close` | 元 |
| `stock_volume` | 万股 |
| `stock_amount` | 万元 |
| `pct_change` | % |
| `new_conversion_shares` | 万股 |

## 2. 推荐补充数据

如果要更可靠地分析“压制关系”，建议继续补齐这些字段。

| 字段 | 含义 | 为什么有用 |
| --- | --- | --- |
| `turnover_rate` | 正股换手率 | 比成交量更适合跨阶段比较 |
| `free_float_shares` | 流通股本 | 可计算新增转股占流通盘比例 |
| `conversion_price` | 转股价 | 判断转股是否有经济动力 |
| `bond_close` | 转债收盘价 | 判断持有人更可能卖债还是转股 |
| `conversion_premium_rate` | 转股溢价率 | 判断转股吸引力 |
| `remaining_bond_balance` | 剩余转债余额 | 判断后续潜在转股压力 |
| `cum_conversion_shares` | 累计转股数量 | 判断累计稀释压力 |
| `event` | 事件标签 | 标注强赎、下修、公告、到期等事件 |

推荐完整结构：

```csv
date,stock_code,bond_code,stock_close,stock_volume,turnover_rate,free_float_shares,new_conversion_shares,cum_conversion_shares,remaining_bond_balance,conversion_price,bond_close,conversion_premium_rate,event
```

## 3. 数据来源优先级

数据源建议按“官方公告优先、交易行情其次、第三方补全”的顺序处理。

| 数据项 | 首选来源 | 备选来源 | 注意事项 |
| --- | --- | --- | --- |
| 交易日期 | 沪深交易所交易日历 | AkShare、Tushare、东方财富交易日历 | 需要排除周末和节假日 |
| 正股收盘价 | 深交所市场行情、上交所行情数据 | 东方财富、腾讯财经、新浪财经、AkShare、Tushare | 深市正股优先用深交所官网，长周期建议使用前复权价 |
| 正股成交量 | 深交所市场行情、上交所行情数据 | 东方财富、腾讯财经、新浪财经、AkShare、Tushare | 统一成“万股” |
| 正股成交额 | 深交所市场行情、上交所行情数据 | 东方财富、腾讯财经、新浪财经、AkShare、Tushare | 统一成“万元” |
| 正股涨跌幅 | 深交所市场行情、上交所行情数据 | 东方财富、腾讯财经、新浪财经、AkShare、Tushare | 统一成百分比数值 |
| 正股换手率 | 东方财富、Tushare、AkShare | 自己用成交量/流通股本计算 | 口径要固定 |
| 流通股本 | 上市公司定期报告、交易所资料 | 东方财富、Tushare、AkShare | 股本变动会影响换手率和稀释比例 |
| 转股价 | 募集说明书、后续转股价格调整公告 | 巨潮资讯、上交所/深交所公告、东方财富 | 下修、分红送转后会变化 |
| 剩余转债余额 | 转股结果公告、强赎公告、交易所债券信息 | 东方财富、集思录、Tushare、AkShare | 用于推导新增转股规模 |
| 累计转股数量 | 转股结果暨股份变动公告 | 巨潮资讯、上交所/深交所公告、东方财富 | 官方公告频率不一定是日频 |
| 每日新增转股数量 | 深交所可转债页面、日频剩余转债余额差分推导 | 第三方可转债数据、公司公告差分 | 深市可转债优先用深交所官方页面 |
| 强赎/下修/到期事件 | 公司公告 | 巨潮资讯、交易所公告、东方财富公告 | 事件会显著改变转股行为 |

## 4. 深交所每日转股数据

深市可转债的每日新增转股数量，可以优先从深交所官网获取：

```text
https://www.szse.cn/market/bond/convertible/index.html
```

建议采集步骤：

1. 打开深交所可转债页面。
2. 用转债代码或转债简称定位目标可转债。
3. 查找与转股相关的日频字段，例如每日转股数量、转股数量、累计转股数量、剩余可转债余额等。
4. 如果页面直接提供“每日新增转股数量”，优先直接使用该字段。
5. 如果页面只提供“累计转股数量”或“剩余可转债余额”，用相邻交易日差分推导每日新增转股数量。
6. 保存时统一字段名为 `new_conversion_shares`，单位统一成“万股”。

深交所数据落表建议：

```csv
date,bond_code,bond_name,new_conversion_shares,cum_conversion_shares,remaining_bond_balance,source
2026-06-03,127000,示例转债,104.20,1820.35,1231474000,SZSE
```

注意：

- 深交所页面适用于深市可转债。沪市可转债需要从上交所、公司公告或其他数据源补齐。
- 如果深交所页面给出的单位不是“万股”，入库前要统一换算。
- 如果同一天既有官方“每日新增转股数量”，又能用余额差分推导，优先使用官方直接字段，并把差分结果作为校验。
- 采集时建议同时保存 `source` 字段，方便后续区分官方数据、第三方数据和估算数据。

## 5. 深交所正股行情数据

深市正股的交易日期、收盘价、成交量、成交额、涨跌幅，可以优先从深交所官网获取：

```text
https://www.szse.cn/market/trend/index.html
```

建议采集字段：

| 页面字段 | 落表字段 | 建议单位 |
| --- | --- | --- |
| 交易日期 | `date` | `YYYY-MM-DD` |
| 收盘价 | `stock_close` | 元 |
| 成交量 | `stock_volume` | 万股 |
| 成交额 | `stock_amount` | 万元 |
| 涨跌幅 | `pct_change` | % |

深交所行情数据落表建议：

```csv
date,stock_code,stock_close,stock_volume,stock_amount,pct_change,stock_source
2026-06-03,000001,12.38,9080,112450,-1.35,SZSE
```

注意：

- 这个页面适用于深市正股行情。沪市正股需要从上交所或其他行情源补齐。
- 成交量和成交额要确认页面单位，入库前统一成“万股”和“万元”。
- 涨跌幅建议保存为数值，例如 `-1.35`，不要保存成带百分号的字符串。
- 如果后续要做长周期分析，仍需考虑是否改用前复权收盘价；深交所页面的日行情通常是原始收盘价。

## 6. 每日新增转股数量的计算逻辑

如果能拿到每日剩余转债余额，可以这样计算：

```text
当日转股金额 = 前一交易日剩余转债余额 - 当日剩余转债余额
每日新增转股数量 = 当日转股金额 / 当日有效转股价
```

如果单位要换成“万股”：

```text
每日新增转股数量(万股) = 当日转股金额(元) / 当日有效转股价(元) / 10000
```

注意：

- 可转债面值通常是 100 元，但如果数据源直接给的是“剩余余额金额”，就直接用金额差分。
- 如果数据源给的是“剩余张数”，先换算成金额：`剩余金额 = 剩余张数 * 100`。
- 转股价发生调整时，必须使用当日有效转股价。
- 如果只拿到月度或季度公告，只能得到区间新增转股，不能还原精确日频。

## 7. 补齐步骤

### 第一步：确定分析对象

先记录：

```text
正股代码：
正股名称：
转债代码：
转债名称：
上市日期：
转股起始日：
到期日：
当前转股价：
```

### 第二步：拉取交易日历

生成从“转股起始日”到“分析结束日”的交易日期列表。

输出字段：

```text
date
```

### 第三步：补正股行情

按交易日期补齐：

```text
stock_close
stock_volume
stock_amount
pct_change
turnover_rate
```

检查：

- 日期是否连续覆盖所有交易日。
- 成交量单位是否统一为万股。
- 成交额单位是否统一为万元。
- 涨跌幅是否保存为百分比数值。
- 如果跨分红送转，确认是否需要前复权收盘价。

### 第四步：补转债关键口径

按交易日期补齐：

```text
conversion_price
remaining_bond_balance
bond_close
conversion_premium_rate
```

检查：

- 转股价是否在下修、分红送转后正确变更。
- 剩余转债余额是否单调下降。
- 如果余额出现上升，通常是数据口径或复权处理错误。

### 第五步：补齐或计算每日新增转股数量

深市可转债优先从深交所官网补齐：

```text
https://www.szse.cn/market/bond/convertible/index.html
```

如果能直接拿到每日新增转股数量，就直接写入：

```text
new_conversion_shares
```

如果只能拿到剩余转债余额，再用差分计算。

用剩余转债余额做差分：

```text
new_conversion_amount = previous_remaining_bond_balance - remaining_bond_balance
new_conversion_shares = new_conversion_amount / conversion_price
```

再换算成万股：

```text
new_conversion_shares_wan = new_conversion_shares / 10000
```

异常检查：

- 新增转股数量不能为负。
- 如果某天为负，检查余额单位、债券代码、日期对齐。
- 如果转股价缺失，不能直接计算该日新增股数。

### 第六步：标注事件

把重要公告事件填入 `event` 字段：

```text
下修公告
强赎公告
不下修公告
赎回登记日
停止交易日
停止转股日
到期兑付日
```

这些事件很重要，因为它们会改变持有人转股意愿。

### 第七步：生成压力指标

有了基础数据后，可以计算：

```text
volume_ratio_5d = 当日成交量 / 前5日平均成交量
conversion_ratio_5d = 当日新增转股数量 / 前5日平均新增转股数量
new_conversion_to_float = 当日新增转股数量 / 流通股本
next_1d_return = 次日收盘价 / 当日收盘价 - 1
next_5d_return = 5日后收盘价 / 当日收盘价 - 1
```

第一版压力窗口规则可以先用：

```text
当日新增转股数量显著高于近5日均值
且当日成交量高于近5日均量
且当日或后续1-5日股价下跌
```

示例：

```text
conversion_ratio_5d >= 2
volume_ratio_5d >= 1.25
next_5d_return < 0
```

## 8. 最终数据样例

```csv
date,stock_code,bond_code,stock_close,stock_volume,stock_amount,pct_change,turnover_rate,free_float_shares,conversion_price,remaining_bond_balance,new_conversion_shares,bond_close,conversion_premium_rate,event,stock_source,conversion_source
2026-06-01,000001,127000,12.69,5760,73120,-1.10,1.69,340000,11.80,1250000000,24.30,121.35,8.42,,SZSE,SZSE
2026-06-02,000001,127000,12.55,6550,82203,-1.10,1.92,340000,11.80,1243770000,52.80,120.48,9.16,,SZSE,SZSE
2026-06-03,000001,127000,12.38,9080,112450,-1.35,2.66,340000,11.80,1231474000,104.20,119.72,10.21,强赎预期升温,SZSE,SZSE
```

## 9. 先补哪些数据

建议按这个顺序推进：

1. `date`
2. `stock_close`
3. `stock_volume`
4. `stock_amount`
5. `pct_change`
6. `conversion_price`
7. `remaining_bond_balance`
8. `new_conversion_shares`
9. `turnover_rate`
10. `bond_close`
11. `conversion_premium_rate`
12. `event`

只要第 1 至第 8 项齐了，就可以从 mock demo 变成真实数据 demo。

## 10. 需要人工确认的口径

补数据前最好先确定这些口径：

| 问题 | 建议 |
| --- | --- |
| 收盘价用不复权还是前复权？ | 短周期可用不复权，长周期建议前复权 |
| 成交量单位是什么？ | 统一成万股 |
| 成交额单位是什么？ | 统一成万元 |
| 涨跌幅如何保存？ | 保存为百分比数值，例如 `-1.35` |
| 新增转股数量单位是什么？ | 统一成万股 |
| 转债余额单位是什么？ | 统一成元 |
| 转股价调整日如何处理？ | 使用当日实际生效的转股价 |
| 没有日频余额怎么办？ | 先用公告区间数据做低精度版本，并在图中标注为区间估算 |
