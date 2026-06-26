import { calculate } from "../functions/api/calculate.js";

const cases = [
  ["000001", "2026-06-25"],
  ["688066", "2026-06-25"],
];

for (const [code, date] of cases) {
  const result = await calculate(code, date);

  if (!result.floorPrice || !result.cbValue) {
    throw new Error(`${code} did not return calculated metrics`);
  }

  if (!Array.isArray(result.tableRows) || result.tableRows.length === 0) {
    throw new Error(`${code} did not return table rows`);
  }

  console.log(
    [
      `${code} ${result.name}`,
      `previousTradeDate=${result.previousTradeDate}`,
      `avg20=${result.avg20}`,
      `avg1=${result.avg1}`,
      `floorPrice=${result.floorPrice}`,
      `cbValue=${result.cbValue}`,
      `tableRows=${result.tableRows.length}`,
    ].join(" "),
  );
}
