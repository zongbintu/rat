# 转债价值底价计算

## 环境约束

- Python: `3.11` 或 `3.12`
- 使用虚拟环境
- 依赖安装自 `requirements.txt`

## 初始化

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## 使用

```sh
python cb_value.py 000001
python cb_value.py 688066 2026-06-25
```

不输入日期时，默认使用运行当天日期。计算口径为：

- 输入日期作为基准日
- 取基准日前一交易日作为“前1日”
- 取前一交易日及其往前共 20 个交易日计算“前20日均价”

输出字段：

- 代码
- 名称
- 前20日均价
- 前1日均价
- 底价
- 转债价值
