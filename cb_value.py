#!/usr/bin/env python3
"""Calculate convertible-bond floor price metrics from exchange data."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import requests


SZSE_REPORT_URL = "https://www.szse.cn/api/report/ShowReport/data"
SSE_DAYK_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/dayk/{code}"
SSE_SNAP_URL = "https://yunhq.sse.com.cn:32042/v1/sh1/snap/{code}"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "application/json,text/plain,*/*",
}


@dataclass(frozen=True)
class DailyQuote:
    date: dt.date
    code: str
    name: str
    close: Decimal
    volume: Decimal
    amount: Decimal


@dataclass(frozen=True)
class Result:
    code: str
    name: str
    avg_20: Decimal
    avg_1: Decimal
    floor_price: Decimal
    cb_value: Decimal
    previous_trade_date: dt.date


class QuoteError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="根据股票代码和基准日期计算前20日均价、前1日均价、底价和转债价值。"
    )
    parser.add_argument("code", help="6位证券代码，例如 000001 或 688066")
    parser.add_argument(
        "date",
        nargs="?",
        help="基准日期，格式 YYYY-MM-DD；不填默认为当前日期",
    )
    return parser.parse_args()


def parse_date(value: str | None) -> dt.date:
    if not value:
        return dt.date.today()
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise QuoteError("日期格式错误，应为 YYYY-MM-DD") from exc


def detect_exchange(code: str) -> str:
    if not re.fullmatch(r"\d{6}", code):
        raise QuoteError("证券代码必须是6位数字")
    if code.startswith(("6", "9")):
        return "sse"
    if code.startswith(("0", "1", "2", "3")):
        return "szse"
    raise QuoteError(f"无法根据代码判断交易所: {code}")


def decimal_from_text(value: Any) -> Decimal:
    if value is None:
        raise QuoteError("接口返回空数值")
    return Decimal(str(value).replace(",", "").replace("\xa0", "").strip())


def round_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def previous_day(value: dt.date) -> dt.date:
    return value - dt.timedelta(days=1)


def fetch_json(session: requests.Session, url: str, **kwargs: Any) -> Any:
    headers = kwargs.pop("headers", HEADERS)
    response = session.get(url, timeout=15, headers=headers, **kwargs)
    response.raise_for_status()
    return response.json()


def fetch_jsonp(session: requests.Session, url: str, **kwargs: Any) -> Any:
    headers = kwargs.pop("headers", HEADERS)
    response = session.get(url, timeout=15, headers=headers, **kwargs)
    response.raise_for_status()
    text = response.text.strip()
    match = re.fullmatch(r"[\w$]+\((.*)\)", text, flags=re.S)
    if not match:
        raise QuoteError(f"无法解析 JSONP 响应: {text[:120]}")
    return json.loads(match.group(1))


def fetch_szse_quotes(
    session: requests.Session, code: str, base_date: dt.date, needed: int = 20
) -> list[DailyQuote]:
    quotes: dict[dt.date, DailyQuote] = {}
    end = previous_day(base_date)
    attempts = 0

    while len(quotes) < needed and attempts < 80:
        start = end - dt.timedelta(days=4)
        params = {
            "SHOWTYPE": "JSON",
            "CATALOGID": "1815_stock_snapshot",
            "TABKEY": "tab1",
            "txtDMorJC": code,
            "txtBeginDate": start.isoformat(),
            "txtEndDate": end.isoformat(),
        }
        payload = fetch_json(session, SZSE_REPORT_URL, params=params)
        if not payload:
            raise QuoteError("深交所接口返回空数据")
        block = payload[0]
        error = block.get("error")
        if error and "最多只能查询五天" not in error:
            raise QuoteError(f"深交所接口错误: {error}")

        for row in block.get("data") or []:
            if row.get("zqdm") != code:
                continue
            trade_date = dt.date.fromisoformat(row["jyrq"])
            amount_wan_yuan = decimal_from_text(row["cjje"])
            volume_wan_shares = decimal_from_text(row["cjgs"])
            quotes[trade_date] = DailyQuote(
                date=trade_date,
                code=code,
                name=clean_name(row["zqjc"]),
                close=decimal_from_text(row["ss"]),
                volume=volume_wan_shares * Decimal("10000"),
                amount=amount_wan_yuan * Decimal("10000"),
            )

        end = start - dt.timedelta(days=1)
        attempts += 1

    ordered = sorted(quotes.values(), key=lambda item: item.date, reverse=True)
    if len(ordered) < needed:
        raise QuoteError(f"深交所仅获取到 {len(ordered)} 个交易日数据，少于 {needed} 个")
    return ordered[:needed]


def fetch_sse_quotes(
    session: requests.Session, code: str, base_date: dt.date, needed: int = 20
) -> list[DailyQuote]:
    snap = fetch_jsonp(
        session,
        SSE_SNAP_URL.format(code=code),
        params={
            "callback": "jsonpCallback",
            "select": "name",
        },
        headers=headers_with_referer(),
    )
    name = snap.get("snap", [""])[0] if isinstance(snap.get("snap"), list) else ""

    dayk = fetch_jsonp(
        session,
        SSE_DAYK_URL.format(code=code),
        params={
            "callback": "jsonpCallback",
            "select": "date,open,high,low,close,volume,amount",
            "begin": -260,
            "end": -1,
        },
        headers=headers_with_referer(),
    )
    rows = dayk.get("kline") or []
    quotes: list[DailyQuote] = []
    cutoff = int(previous_day(base_date).strftime("%Y%m%d"))
    for row in rows:
        if int(row[0]) > cutoff:
            continue
        trade_date = dt.datetime.strptime(str(row[0]), "%Y%m%d").date()
        quotes.append(
            DailyQuote(
                date=trade_date,
                code=code,
                name=clean_name(name),
                close=decimal_from_text(row[4]),
                volume=decimal_from_text(row[5]),
                amount=decimal_from_text(row[6]),
            )
        )

    quotes.sort(key=lambda item: item.date, reverse=True)
    if len(quotes) < needed:
        raise QuoteError(f"上交所仅获取到 {len(quotes)} 个交易日数据，少于 {needed} 个")
    return quotes[:needed]


def headers_with_referer() -> dict[str, str]:
    headers = dict(HEADERS)
    headers["Referer"] = "https://www.sse.com.cn/"
    return headers


def clean_name(value: str) -> str:
    return (
        str(value)
        .replace("&nbsp;", "")
        .replace("\xa0", "")
        .replace(" ", "")
        .strip()
    )


def calculate(code: str, base_date: dt.date) -> Result:
    exchange = detect_exchange(code)
    with requests.Session() as session:
        if exchange == "szse":
            quotes = fetch_szse_quotes(session, code, base_date)
        else:
            quotes = fetch_sse_quotes(session, code, base_date)

    total_amount = sum((item.amount for item in quotes), Decimal("0"))
    total_volume = sum((item.volume for item in quotes), Decimal("0"))
    if total_volume <= 0 or quotes[0].volume <= 0:
        raise QuoteError("成交量为0，无法计算均价")

    previous_quote = quotes[0]
    avg_20 = round_money(total_amount / total_volume)
    avg_1 = round_money(previous_quote.amount / previous_quote.volume)
    floor_price = max(avg_20, avg_1)
    cb_value = round_money(previous_quote.close / floor_price * Decimal("100"))

    return Result(
        code=code,
        name=previous_quote.name,
        avg_20=avg_20,
        avg_1=avg_1,
        floor_price=floor_price,
        cb_value=cb_value,
        previous_trade_date=previous_quote.date,
    )


def print_result(result: Result) -> None:
    print(f"代码: {result.code}")
    print(f"名称: {result.name}")
    print(f"前一交易日: {result.previous_trade_date.isoformat()}")
    print(f"前20日均价: {result.avg_20}")
    print(f"前1日均价: {result.avg_1}")
    print(f"底价: {result.floor_price}")
    print(f"转债价值: {result.cb_value}")


def main() -> int:
    args = parse_args()
    try:
        result = calculate(args.code, parse_date(args.date))
    except (QuoteError, requests.RequestException) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    print_result(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
