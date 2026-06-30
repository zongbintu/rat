const SZSE_STOCK_HISTORY_URL =
  "https://www.szse.cn/api/market/ssjjhq/getHistoryData";
const SZSE_CONVERSION_URL =
  "https://www.szse.cn/api/report/ShowReport/data";
const SSE_QUERY_URL = "https://query.sse.com.cn/commonQuery.do";
const SSE_DAYK_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/dayk/";
const SSE_SNAP_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/snap/";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

const SZSE_HEADERS = {
  ...BASE_HEADERS,
  Referer: "https://www.szse.cn/",
};

const SSE_HEADERS = {
  ...BASE_HEADERS,
  Referer: "https://www.sse.com.cn/market/bonddata/convertible/",
};

const SSE_QUOTE_HEADERS = {
  ...BASE_HEADERS,
  Referer: "https://www.sse.com.cn/",
};

class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserInputError";
    this.status = 400;
  }
}

function parseNumber(value) {
  const normalized = String(value ?? "0")
    .replace(/,/g, "")
    .replace(/\u00a0/g, "")
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFixedNumber(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function cleanName(value) {
  return String(value || "")
    .replaceAll("&nbsp;", "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function jsonError(message, status = 400) {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

async function fetchJson(url, headers = SZSE_HEADERS) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`官方数据接口返回 HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchJsonp(url, params, headers = SSE_HEADERS) {
  const response = await fetch(withParams(url, params), { headers });
  if (!response.ok) {
    throw new Error(`官方数据接口返回 HTTP ${response.status}`);
  }

  const text = (await response.text()).trim();
  const match = text.match(/^[\w$]+\((.*)\)$/s);
  if (!match) {
    throw new Error(`官方 JSONP 数据格式异常：${text.slice(0, 80)}`);
  }
  return JSON.parse(match[1]);
}

function withParams(url, params) {
  const nextUrl = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    nextUrl.searchParams.set(key, String(value ?? ""));
  });
  return nextUrl.toString();
}

function detectExchange(stockCode, bondCode) {
  const isSzse = /^[03]/.test(stockCode) && /^12/.test(bondCode);
  const isSse = /^6/.test(stockCode) && /^11/.test(bondCode);

  if (isSzse) {
    return "SZSE";
  }
  if (isSse) {
    return "SSE";
  }
  throw new UserInputError("正股和转债代码需同属深交所或上交所");
}

function validateDate(dateText) {
  if (!dateText) {
    return;
  }

  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new UserInputError("开始日期格式必须是 YYYY-MM-DD");
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new UserInputError("开始日期必须是有效日期");
  }
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function todayInShanghai() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function compactDate(dateText) {
  return String(dateText).replaceAll("-", "");
}

function formatSseDate(value) {
  const text = String(value || "");
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return text;
}

async function fetchSzseStockRows(stockCode, startDate) {
  const url = new URL(SZSE_STOCK_HISTORY_URL);
  url.searchParams.set("cycleType", "32");
  url.searchParams.set("marketId", "1");
  url.searchParams.set("code", stockCode);

  const payload = await fetchJson(url, SZSE_HEADERS);
  if (payload.code !== "0" || !payload.data?.picupdata) {
    throw new Error("深交所正股行情数据格式异常");
  }

  return {
    name: payload.data.name || stockCode,
    rows: payload.data.picupdata
      .filter((item) => !startDate || item[0] >= startDate)
      .map((item) => ({
        date: item[0],
        close: parseNumber(item[2]),
        // 深交所行情接口成交量字段按“手”返回，这里统一换算成“万股”。
        volume: toFixedNumber(parseNumber(item[7]) / 100, 2),
        amount: toFixedNumber(parseNumber(item[8]) / 10000, 2),
        pctChange: parseNumber(item[6]),
        stockSource: "SZSE",
      })),
  };
}

async function fetchSseStockRows(stockCode, startDate) {
  const snap = await fetchJsonp(
    `${SSE_SNAP_URL}${stockCode}`,
    {
      callback: "jsonpCallback",
      select: "name",
    },
    SSE_QUOTE_HEADERS,
  );
  const name = cleanName(Array.isArray(snap?.snap) ? snap.snap[0] : "");
  const beginDate = compactDate(addDays(startDate, -14));
  const endDate = compactDate(todayInShanghai());
  const dayk = await fetchJsonp(
    `${SSE_DAYK_URL}${stockCode}`,
    {
      callback: "jsonpCallback",
      select: "date,open,high,low,close,volume,amount",
      begin: beginDate,
      end: endDate,
    },
    SSE_QUOTE_HEADERS,
  );

  if (!Array.isArray(dayk?.kline)) {
    throw new Error("上交所正股行情数据格式异常");
  }

  const rows = dayk.kline
    .map((item, index, source) => {
      const date = formatSseDate(item[0]);
      const close = parseNumber(item[4]);
      const previousClose = index > 0 ? parseNumber(source[index - 1][4]) : 0;
      return {
        date,
        close,
        volume: toFixedNumber(parseNumber(item[5]) / 10000, 2),
        amount: toFixedNumber(parseNumber(item[6]) / 10000, 2),
        pctChange: previousClose
          ? toFixedNumber(((close - previousClose) / previousClose) * 100, 2)
          : 0,
        stockSource: "SSE",
      };
    })
    .filter((item) => item.date >= startDate);

  if (rows.length === 0) {
    throw new Error("上交所正股行情没有覆盖所选开始日期");
  }

  return {
    name: name || stockCode,
    rows,
  };
}

async function fetchSzseConversionRows(bondCode) {
  const firstPage = await fetchSzseConversionPage(bondCode, 1);
  const metadata = firstPage?.metadata || {};
  const pageCount = Math.min(Number(metadata.pagecount || 1), 20);
  const pages = [firstPage];

  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchSzseConversionPage(bondCode, index + 2),
      ),
    );
    pages.push(...rest);
  }

  return pages.flatMap((page) => page.data || []);
}

async function fetchSzseConversionPage(bondCode, pageNo) {
  const url = new URL(SZSE_CONVERSION_URL);
  url.searchParams.set("SHOWTYPE", "JSON");
  url.searchParams.set("CATALOGID", "convertible_bond_conversion");
  url.searchParams.set("txtkzdm", bondCode);
  url.searchParams.set("PAGENO", String(pageNo));

  const payload = await fetchJson(url, SZSE_HEADERS);
  const report = Array.isArray(payload) ? payload[0] : null;
  if (!report || report.error) {
    throw new Error("深交所可转债转股数据格式异常");
  }
  return report;
}

async function fetchSseConversionRows(bondCode) {
  const firstPage = await fetchSseConversionPage(bondCode, 1);
  const pageCount = Math.min(Number(firstPage?.pageHelp?.pageCount || 1), 20);
  const pages = [firstPage];

  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchSseConversionPage(bondCode, index + 2),
      ),
    );
    pages.push(...rest);
  }

  return pages.flatMap((page) => page.result || []);
}

async function fetchSseConversionPage(bondCode, pageNo) {
  const payload = await fetchJsonp(SSE_QUERY_URL, {
    jsonCallBack: "jsonpCallback",
    isPagination: true,
    "pageHelp.pageSize": 100,
    "pageHelp.pageNo": pageNo,
    "pageHelp.beginPage": 1,
    "pageHelp.cacheSize": 1,
    "pageHelp.endPage": 1,
    pagecache: false,
    sqlId: "COMMON_SSE_SJ_ZQSJ_KZZZGTJ_L",
    SEARCH_YEAR: "",
    BOND_CODE: bondCode,
  });

  if (!payload || !Array.isArray(payload.result)) {
    throw new Error("上交所可转债转股数据格式异常");
  }
  return payload;
}

function buildSzseConversionMap(conversionRows) {
  const conversionMap = new Map();

  conversionRows.forEach((row) => {
    const conversionDate = row.conversion_date;
    const conversionPrice = parseNumber(row.conversion_price);
    const conversionFaceAmount = parseNumber(row.conversion_quantity);
    const accumulatedConversionFaceAmount = parseNumber(
      row.accumulated_conversion_quantity,
    );
    const accumulatedConversionRatio = parseNumber(
      row.accumulated_conversion_ratio,
    );
    const newConversionShares =
      conversionPrice > 0
        ? (conversionFaceAmount * 100) / conversionPrice / 10000
        : 0;

    conversionMap.set(conversionDate, {
      bondName: String(row.security_short_name || "").trim(),
      conversion: toFixedNumber(newConversionShares, 2),
      conversionFaceAmount,
      conversionPrice: conversionPrice || null,
      accumulatedConversionFaceAmount,
      accumulatedConversionRatio,
      conversionSource: "SZSE",
    });
  });

  return conversionMap;
}

function buildSseConversionMap(conversionRows) {
  const conversionMap = new Map();

  conversionRows.forEach((row) => {
    const conversionDate = formatSseDate(row.TRADE_DATE);
    const dayConversionShares = parseNumber(row.DAY_CONV_VOL);
    const accumulatedConversionShares = parseNumber(row.TOT_CONV_VOL);

    conversionMap.set(conversionDate, {
      bondName: cleanName(row.BOND_ABBR || row.SECURITY_ABBR_FULL),
      conversion: toFixedNumber(dayConversionShares / 10000, 2),
      conversionFaceAmount: dayConversionShares,
      conversionPrice: parseNumber(row.CONV_PRICE) || null,
      accumulatedConversionFaceAmount: accumulatedConversionShares,
      accumulatedConversionRatio: parseNumber(row.TOT_CONV_RATE),
      conversionSource: "SSE",
    });
  });

  return conversionMap;
}

function mergeRows(stockRows, conversionMap) {
  return stockRows.map((stockRow) => {
    const conversion = conversionMap.get(stockRow.date);
    return {
      ...stockRow,
      conversion: conversion?.conversion || 0,
      conversionFaceAmount: conversion?.conversionFaceAmount || 0,
      conversionPrice: conversion?.conversionPrice || null,
      accumulatedConversionFaceAmount:
        conversion?.accumulatedConversionFaceAmount || null,
      accumulatedConversionRatio: conversion?.accumulatedConversionRatio || null,
      conversionSource: conversion?.conversionSource || null,
    };
  });
}

function resolveBondName(exchange, conversionRows, bondCode) {
  if (exchange === "SSE") {
    const conversionEvent = conversionRows.find((row) =>
      cleanName(row.BOND_ABBR || row.SECURITY_ABBR_FULL),
    );
    return (
      cleanName(
        conversionEvent?.BOND_ABBR || conversionEvent?.SECURITY_ABBR_FULL,
      ) || bondCode
    );
  }

  const conversionEvent = conversionRows.find(
    (row) => String(row.security_short_name || "").trim().length > 0,
  );
  return String(conversionEvent?.security_short_name || "").trim() || bondCode;
}

function buildSources(exchange, stockCode) {
  if (exchange === "SSE") {
    return {
      stock: `https://www.sse.com.cn/assortment/stock/list/info/company/index.shtml?COMPANY_CODE=${stockCode}`,
      conversion: "https://www.sse.com.cn/market/bonddata/convertible/",
    };
  }

  return {
    stock: "https://www.szse.cn/market/trend/index.html",
    conversion: "https://www.szse.cn/market/bond/convertible/index.html",
  };
}

async function fetchPressureData(exchange, stockCode, bondCode, startDate) {
  if (exchange === "SSE") {
    const [stockData, conversionRows] = await Promise.all([
      fetchSseStockRows(stockCode, startDate),
      fetchSseConversionRows(bondCode),
    ]);
    return {
      stockData,
      conversionRows,
      conversionMap: buildSseConversionMap(conversionRows),
    };
  }

  const [stockData, conversionRows] = await Promise.all([
    fetchSzseStockRows(stockCode, startDate),
    fetchSzseConversionRows(bondCode),
  ]);
  return {
    stockData,
    conversionRows,
    conversionMap: buildSzseConversionMap(conversionRows),
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const stockCode = url.searchParams.get("stock") || "002726";
  const bondCode = url.searchParams.get("bond") || "128119";
  const startDate = url.searchParams.get("start") || "2026-04-01";

  try {
    if (!/^\d{6}$/.test(stockCode)) {
      return jsonError("正股代码必须是 6 位数字");
    }
    if (!/^\d{6}$/.test(bondCode)) {
      return jsonError("转债代码必须是 6 位数字");
    }
    validateDate(startDate);

    const exchange = detectExchange(stockCode, bondCode);
    const { stockData, conversionRows, conversionMap } =
      await fetchPressureData(exchange, stockCode, bondCode, startDate);
    const rows = mergeRows(stockData.rows, conversionMap);

    return Response.json(
      {
        market: exchange,
        stockCode,
        stockName: stockData.name,
        bondCode,
        bondName: resolveBondName(exchange, conversionRows, bondCode),
        startDate,
        endDate: rows.at(-1)?.date || startDate,
        sources: buildSources(exchange, stockCode),
        rows,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (error) {
    return jsonError(
      error.message || "真实数据源读取失败",
      error.status || 502,
    );
  }
}
