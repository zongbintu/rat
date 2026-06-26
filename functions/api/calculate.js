const SZSE_REPORT_URL = "https://www.szse.cn/api/report/ShowReport/data";
const SSE_DAYK_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/dayk/";
const SSE_SNAP_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/snap/";

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

class QuoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "QuoteError";
    this.status = status;
  }
}

export async function onRequestGet(context) {
  try {
    const requestUrl = new URL(context.request.url);
    const code = normalizeCode(requestUrl.searchParams.get("code"));
    const baseDate = parseDate(requestUrl.searchParams.get("date"));
    const cacheKey = new Request(
      `${requestUrl.origin}${requestUrl.pathname}?code=${code}&date=${baseDate}`,
      context.request,
    );

    const cache = typeof caches !== "undefined" ? caches.default : null;
    const cached = cache ? await cache.match(cacheKey) : null;
    if (cached) {
      return cached;
    }

    const result = await calculate(code, baseDate);
    const response = jsonResponse(result, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });

    if (cache) {
      context.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return response;
  } catch (error) {
    const status = error instanceof QuoteError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "计算失败，请稍后重试";
    return jsonResponse(
      { error: message },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function calculate(code, baseDate) {
  const exchange = detectExchange(code);
  const quotes =
    exchange === "szse"
      ? await fetchSzseQuotes(code, baseDate)
      : await fetchSseQuotes(code, baseDate);

  const totalAmount = quotes.reduce((sum, item) => sum + item.amount, 0);
  const totalVolume = quotes.reduce((sum, item) => sum + item.volume, 0);
  const previousQuote = quotes[0];

  if (!previousQuote || totalVolume <= 0 || previousQuote.volume <= 0) {
    throw new QuoteError("成交量为 0，无法计算均价", 422);
  }

  const avg20 = roundMoney(totalAmount / totalVolume);
  const avg1 = roundMoney(previousQuote.amount / previousQuote.volume);
  const floorPrice = Math.max(avg20, avg1);
  const cbValue = roundMoney((previousQuote.close / floorPrice) * 100);

  return {
    code,
    name: previousQuote.name,
    baseDate,
    previousTradeDate: previousQuote.date,
    avg20: formatMoney(avg20),
    avg1: formatMoney(avg1),
    floorPrice: formatMoney(floorPrice),
    cbValue: formatMoney(cbValue),
    tableRows: quotes.map((quote) => ({
      date: quote.date,
      volume: formatWan(quote.volume),
      amount: formatWan(quote.amount),
    })),
  };
}

function normalizeCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new QuoteError("证券代码必须是 6 位数字");
  }
  return code;
}

function detectExchange(code) {
  if (/^[69]/.test(code)) {
    return "sse";
  }
  if (/^[0123]/.test(code)) {
    return "szse";
  }
  throw new QuoteError(`无法根据代码判断交易所：${code}`);
}

function parseDate(value) {
  if (!value) {
    return todayInShanghai();
  }
  const date = String(value).trim();
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new QuoteError("日期格式错误，应为 YYYY-MM-DD");
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
    throw new QuoteError("日期格式错误，应为有效日期");
  }

  return date;
}

function todayInShanghai() {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

async function fetchSzseQuotes(code, baseDate, needed = 20) {
  const quotes = new Map();
  let end = addDays(baseDate, -1);
  let attempts = 0;

  while (quotes.size < needed && attempts < 80) {
    const start = addDays(end, -4);
    const payload = await fetchJson(SZSE_REPORT_URL, {
      SHOWTYPE: "JSON",
      CATALOGID: "1815_stock_snapshot",
      TABKEY: "tab1",
      txtDMorJC: code,
      txtBeginDate: start,
      txtEndDate: end,
    });

    if (!Array.isArray(payload) || payload.length === 0) {
      throw new QuoteError("深交所接口返回空数据", 502);
    }

    const block = payload[0];
    const error = block?.error;
    if (error && !String(error).includes("最多")) {
      throw new QuoteError(`深交所接口错误：${error}`, 502);
    }

    for (const row of block?.data || []) {
      if (row.zqdm !== code) {
        continue;
      }

      const tradeDate = parseDate(row.jyrq);
      const amountWanYuan = decimalFromText(row.cjje);
      const volumeWanShares = decimalFromText(row.cjgs);
      quotes.set(tradeDate, {
        date: tradeDate,
        code,
        name: cleanName(row.zqjc),
        close: decimalFromText(row.ss),
        volume: volumeWanShares * 10000,
        amount: amountWanYuan * 10000,
      });
    }

    end = addDays(start, -1);
    attempts += 1;
  }

  const ordered = [...quotes.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  if (ordered.length < needed) {
    throw new QuoteError(
      `深交所仅获取到 ${ordered.length} 个交易日数据，少于 ${needed} 个`,
      502,
    );
  }
  return ordered.slice(0, needed);
}

async function fetchSseQuotes(code, baseDate, needed = 20) {
  const headers = headersWithReferer();
  const snap = await fetchJsonp(`${SSE_SNAP_URL}${code}`, {
    callback: "jsonpCallback",
    select: "name",
  }, headers);
  const name = Array.isArray(snap?.snap) ? snap.snap[0] : "";

  const dayk = await fetchJsonp(`${SSE_DAYK_URL}${code}`, {
    callback: "jsonpCallback",
    select: "date,open,high,low,close,volume,amount",
    begin: "-260",
    end: "-1",
  }, headers);

  const cutoff = Number(addDays(baseDate, -1).replaceAll("-", ""));
  const quotes = [];
  for (const row of dayk?.kline || []) {
    if (Number(row[0]) > cutoff) {
      continue;
    }

    quotes.push({
      date: formatSseDate(row[0]),
      code,
      name: cleanName(name),
      close: decimalFromText(row[4]),
      volume: decimalFromText(row[5]),
      amount: decimalFromText(row[6]),
    });
  }

  quotes.sort((a, b) => b.date.localeCompare(a.date));
  if (quotes.length < needed) {
    throw new QuoteError(
      `上交所仅获取到 ${quotes.length} 个交易日数据，少于 ${needed} 个`,
      502,
    );
  }
  return quotes.slice(0, needed);
}

async function fetchJson(url, params, headers = BASE_HEADERS) {
  const response = await fetch(withParams(url, params), { headers });
  if (!response.ok) {
    throw new QuoteError(`接口请求失败：HTTP ${response.status}`, 502);
  }
  return response.json();
}

async function fetchJsonp(url, params, headers = BASE_HEADERS) {
  const response = await fetch(withParams(url, params), { headers });
  if (!response.ok) {
    throw new QuoteError(`接口请求失败：HTTP ${response.status}`, 502);
  }

  const text = (await response.text()).trim();
  const match = text.match(/^[\w$]+\((.*)\)$/s);
  if (!match) {
    throw new QuoteError(`无法解析 JSONP 响应：${text.slice(0, 120)}`, 502);
  }
  return JSON.parse(match[1]);
}

function withParams(url, params) {
  const nextUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    nextUrl.searchParams.set(key, value);
  }
  return nextUrl.toString();
}

function headersWithReferer() {
  return {
    ...BASE_HEADERS,
    Referer: "https://www.sse.com.cn/",
  };
}

function decimalFromText(value) {
  if (value === null || value === undefined || value === "") {
    throw new QuoteError("接口返回空数值", 502);
  }

  const number = Number(String(value).replaceAll(",", "").replace(/\u00a0/g, "").trim());
  if (!Number.isFinite(number)) {
    throw new QuoteError(`无法解析数值：${value}`, 502);
  }
  return number;
}

function cleanName(value) {
  return String(value || "")
    .replaceAll("&nbsp;", "")
    .replace(/\u00a0/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function addDays(dateText, days) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatSseDate(value) {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return roundMoney(value).toFixed(2);
}

function formatWan(value) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(value / 10000));
}

function jsonResponse(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
