# 可转债下修底价计算

一个部署在 Cloudflare Pages + Pages Functions 上的单页工具，用于根据正股代码和基准日期计算可转债下修底价相关指标。

## 功能

- 输入正股代码或名称时，从 `data/convertible_bond_stocks.json` 静态文件中本地联想。
- 点击“计算下修底价”后，调用 `/api/calculate` 获取行情并计算：
  - 前 20 交易日成交均价
  - 前 1 交易日成交均价
  - 下修底价
  - 到底转股价值
- 页面下方展示计算依据的交易日期、成交量、成交金额表格。

## 实现结构

```text
.
├── index.html
├── data/
│   └── convertible_bond_stocks.json
├── functions/
│   └── api/
│       └── calculate.js
├── scripts/
│   └── test-calculate.mjs
├── package.json
├── wrangler.toml
└── README.md
```

## 计算逻辑

`functions/api/calculate.js` 是由原 `cb_value.py` 迁移而来，核心流程如下：

1. 校验 6 位正股代码。
2. 根据代码前缀判断交易所：
   - `6`、`9` 开头：上交所
   - `0`、`1`、`2`、`3` 开头：深交所
3. 以输入日期为基准，取基准日前一个交易日及往前共 20 个交易日。
4. 计算：

```text
前20交易日均价 = 20日总成交金额 / 20日总成交量
前1交易日均价 = 前一交易日成交金额 / 前一交易日成交量
下修底价 = max(前20交易日均价, 前1交易日均价)
到底转股价值 = 前一交易日收盘价 / 下修底价 * 100
```

## API

请求：

```text
GET /api/calculate?code=000001&date=2026-06-25
```

响应示例：

```json
{
  "code": "000001",
  "name": "平安银行",
  "baseDate": "2026-06-25",
  "previousTradeDate": "2026-06-24",
  "avg20": "10.93",
  "avg1": "10.60",
  "floorPrice": "10.93",
  "cbValue": "96.16",
  "tableRows": [
    {
      "date": "2026-06-24",
      "volume": "11,708.09",
      "amount": "124,092.36"
    }
  ]
}
```

`tableRows` 返回 20 个交易日的成交依据数据，页面展示其中的日期、成交量(万股)、成交金额(万元)。

## 本地开发

安装依赖：

```sh
npm install
```

启动 Cloudflare Pages 本地环境：

```sh
npm run dev
```

访问：

```text
http://localhost:8788/
```

测试 API 迁移逻辑：

```sh
npm run test:api
```

## 部署

首次使用前需要登录 Cloudflare：

```sh
npx wrangler login
```

部署到 Cloudflare Pages：

```sh
npm run deploy
```

部署后检查：

```text
https://<your-project>.pages.dev/
https://<your-project>.pages.dev/api/calculate?code=000001&date=2026-06-25
```

## 免费额度注意

自动联想不调用后端，只读取静态 JSON 文件并在浏览器中过滤。只有用户点击计算时才会调用 Pages Function。

Pages Functions 请求计入 Cloudflare Workers 免费额度。当前实现对相同 `code + date` 的计算结果设置了缓存响应头，并在 Cloudflare 运行时中使用 Cache API 缓存，减少重复请求交易所接口。

