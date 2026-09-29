#!/usr/bin/env bash
set -u
cd "$(dirname "$0")"
NODE="node --experimental-strip-types --disable-warning=ExperimentalWarning"
rm -rf output
mkdir -p output/baseline output/fault_tolerant

echo "### Part A - baseline (stops at the first failure)"
$NODE src/baseline.ts 2>&1 | tee output/baseline/console.txt
echo "baseline exit code: ${PIPESTATUS[0]}" | tee -a output/baseline/console.txt

echo; echo "### Parts B, C, D - fault-tolerant processor"
$NODE src/fault_tolerant.ts 2>&1 | tee output/fault_tolerant/console.txt.tmp
mv output/fault_tolerant/console.txt.tmp output/fault_tolerant/console.txt

echo; echo "### Part E - comparison"
$NODE src/compare.ts

echo; echo "### unit tests"
$NODE --test tests/*.test.ts 2>&1 | tee output/unit_tests.txt | tail -8

node - <<'JS'
const fs = require("fs"), crypto = require("crypto");
const files = ["src/common.ts", "src/baseline.ts", "src/fault_tolerant.ts", "src/compare.ts", "data/transactions.csv", "tests/fault_tolerance.test.ts"];
const manifest = {
  generated_at: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  version: `v${require("./package.json").version}`,
  sha256: Object.fromEntries(files.map((file) => [file, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16)])),
};
fs.writeFileSync("output/run_manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
JS
