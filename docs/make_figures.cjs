const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIAGRAMS = path.join(ROOT, "docs", "diagrams");
const FIGURES = path.join(ROOT, "docs", "figures");
fs.mkdirSync(DIAGRAMS, { recursive: true });
fs.mkdirSync(FIGURES, { recursive: true });

const BLACK = "#000000";
const WHITE = "#FFFFFF";
const GREY = "#E6E6E6";
const FONT = "fontFamily=Helvetica;fontColor=#000000;";
const BOLD = "fontStyle=1;";
const DASHED = "dashed=1;";

const escapeXml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/\n/g, "&#xa;");

function createDiagram(name) {
  const cells = [];
  let counter = 1;
  const nextId = (prefix) => `${prefix}${++counter}`;

  function box(label, x, y, width, height, style = "", parent = "1") {
    const id = nextId("v");
    const fullStyle = `whiteSpace=wrap;html=1;fillColor=${WHITE};strokeColor=${BLACK};${FONT}fontSize=11;${style}`;
    cells.push(`<mxCell id="${id}" value="${escapeXml(label)}" style="${fullStyle}" vertex="1" parent="${parent}">`
      + `<mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`);
    return id;
  }
  const text = (label, x, y, width, height, style = "") =>
    box(label, x, y, width, height, `text;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;${style}`);

  function edge(source, target, label = "", style = "", points = [], parent = "1") {
    const id = nextId("e");
    const fullStyle = `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=${BLACK};${FONT}fontSize=10;endArrow=block;endFill=1;${style}`;
    const waypoints = points.length ? `<Array as="points">${points.map(([px, py]) => `<mxPoint x="${px}" y="${py}"/>`).join("")}</Array>` : "";
    cells.push(`<mxCell id="${id}" value="${escapeXml(label)}" style="${fullStyle}" edge="1" parent="${parent}" source="${source}" target="${target}">`
      + `<mxGeometry relative="1" as="geometry">${waypoints}</mxGeometry></mxCell>`);
  }

  function polyline(points, style = "") {
    const id = nextId("l");
    const [first, ...rest] = points;
    const last = rest.pop();
    const waypoints = rest.length ? `<Array as="points">${rest.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>` : "";
    cells.push(`<mxCell id="${id}" value="" style="endArrow=none;html=1;strokeColor=${BLACK};${style}" edge="1" parent="1">`
      + `<mxGeometry relative="1" as="geometry"><mxPoint x="${first[0]}" y="${first[1]}" as="sourcePoint"/>`
      + `<mxPoint x="${last[0]}" y="${last[1]}" as="targetPoint"/>${waypoints}</mxGeometry></mxCell>`);
  }

  function write() {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="drawio" version="26.0.0">\n<diagram name="${name}" id="${name}">\n`
      + `<mxGraphModel grid="1" gridSize="10" page="0" background="${WHITE}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>\n`
      + cells.join("\n") + "\n</root></mxGraphModel></diagram></mxfile>\n";
    const file = path.join(DIAGRAMS, `${name}.drawio`);
    fs.writeFileSync(file, xml);
    return file;
  }

  return { name, box, text, edge, polyline, write };
}

function architecture() {
  const d = createDiagram("diag_architecture");
  const csv = d.box("data/transactions.csv  (15 synthetic transactions)", 280, 20, 340, 40);
  const processor = d.box("runFaultTolerant()  (src/fault_tolerant.ts)", 40, 110, 820, 250, `swimlane;startSize=26;${BOLD}`);
  const validate = d.box("Validate", 40, 60, 120, 44, "rounded=1;", processor);
  const process = d.box("Process", 230, 60, 120, 44, "rounded=1;", processor);
  const record = d.box("Record", 420, 60, 120, 44, "rounded=1;", processor);
  const classifier = d.box("TransactionError.failureType\nNetwork | Timeout | Database | Validation", 590, 50, 210, 64, "", processor);
  const policy = d.box("Retry policy\nmax 2 retries, backoff 0.05 s x 2^n\nDatabase exhausted: rollback\nother: skip, continue", 560, 160, 240, 70, `fillColor=${GREY};`, processor);
  d.edge(validate, process, "", "", [], processor);
  d.edge(process, record, "", "", [], processor);
  d.edge(process, classifier, "exception", `${DASHED}exitX=0.5;exitY=0;entryX=0.25;entryY=0;`, [[290, 38], [642, 38]], processor);
  d.edge(record, classifier, "", `${DASHED}exitX=1;exitY=0.5;entryX=0;entryY=0.5;`, [], processor);
  d.edge(classifier, policy, "", `${DASHED}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`, [], processor);
  d.edge(policy, validate, "retry: next attempt", `${DASHED}exitX=0;exitY=0.5;entryX=0.5;entryY=1;`, [[100, 195]], processor);

  const gateway = d.box("Payment gateway (simulated)\ncharged transaction ids (idempotency)", 60, 440, 240, 60, "shape=box3d;");
  const ledger = d.box("Ledger (simulated)\nrecords, count, total", 340, 430, 220, 80, "shape=cylinder3;boundedLbl=1;");
  const checkpoints = d.box("Checkpoint files\noutput/fault_tolerant/checkpoints/CPn.json\nevery 5 successful transactions", 600, 430, 260, 80, "shape=folder;tabWidth=60;tabHeight=14;tabPosition=left;");
  const logs = d.box("events.jsonl, attempts.csv,\ntransactions.csv, summary.json", 340, 580, 220, 56, "shape=note;size=12;");

  d.edge(csv, validate, "", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;", [[450, 90], [140, 90]]);
  d.edge(process, gateway, "charge", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;", [[330, 400], [180, 400]]);
  d.edge(record, ledger, "write", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;", [[520, 400], [450, 400]]);
  d.edge(record, checkpoints, "every 5 successes:\nsave checkpoint", "exitX=0.75;exitY=1;entryX=0.3;entryY=0;", [[550, 380], [678, 380]]);
  d.edge(policy, checkpoints, "rollback:\nread latest checkpoint", `${DASHED}exitX=0.75;exitY=1;entryX=0.75;entryY=0;`);
  d.edge(checkpoints, ledger, "restore", `${DASHED}exitX=0;exitY=0.5;entryX=1;entryY=0.5;`);
  d.edge(policy, logs, "", `${DASHED}exitX=0.25;exitY=1;entryX=1;entryY=0.5;`, [[660, 420], [580, 420], [580, 608]]);
  return d;
}

function transactionFlow() {
  const d = createDiagram("diag_txn_flow");
  const start = d.box("next transaction\n(attempt = 1)", 250, 20, 220, 50, "ellipse;");
  const attempt = d.box("attempt: Validate -> Process -> Record", 240, 120, 240, 50, `rounded=1;${BOLD}`);
  const success = d.box("SUCCESS\nledger updated", 260, 230, 200, 50, `fillColor=${BLACK};fontColor=${WHITE};${BOLD}`);
  const checkpointQuestion = d.box("successful\ntransactions % 5 == 0 ?", 260, 330, 200, 80, "rhombus;");
  const checkpoint = d.box("save checkpoint CPn\n(JSON file)", 260, 460, 200, 56, "shape=folder;tabWidth=50;tabHeight=12;tabPosition=left;");
  const next = d.box("continue with next transaction", 240, 600, 240, 50, "ellipse;");

  const classify = d.box("classify by failureType", 600, 120, 200, 50);
  const retryQuestion = d.box("retryable AND\nattempt <= 2 ?", 580, 220, 240, 90, "rhombus;");
  const backoff = d.box("backoff 0.05 s x 2^(attempt-1)\nattempt += 1", 880, 235, 200, 60, `fillColor=${GREY};`);
  const databaseQuestion = d.box("Database ?", 620, 360, 160, 80, "rhombus;");
  const rollback = d.box("ROLLBACK\nrestore latest checkpoint", 580, 490, 240, 60, `fillColor=${BLACK};fontColor=${WHITE};${BOLD}`);
  const failed = d.box("FAILED\nlogged, skipped", 880, 490, 200, 60, `fillColor=${BLACK};fontColor=${WHITE};${BOLD}`);

  d.edge(start, attempt, "", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;");
  d.edge(attempt, success, "no exception", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;");
  d.edge(success, checkpointQuestion, "", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;");
  d.edge(checkpointQuestion, checkpoint, "yes", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;");
  d.edge(checkpointQuestion, next, "no", "exitX=0;exitY=0.5;entryX=0;entryY=0.5;", [[220, 370], [220, 625]]);
  d.edge(checkpoint, next, "", "exitX=0.5;exitY=1;entryX=0.5;entryY=0;");
  d.edge(attempt, classify, "exception", `${DASHED}exitX=1;exitY=0.5;entryX=0;entryY=0.5;`);
  d.edge(classify, retryQuestion, "", `${DASHED}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`);
  d.edge(retryQuestion, backoff, "yes", `${DASHED}exitX=1;exitY=0.5;entryX=0;entryY=0.5;`);
  d.edge(backoff, attempt, "retry", `${DASHED}exitX=0.5;exitY=0;entryX=0.75;entryY=0;`, [[980, 95], [420, 95]]);
  d.edge(retryQuestion, databaseQuestion, "no (exhausted\nor Validation)", `${DASHED}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`);
  d.edge(databaseQuestion, rollback, "yes", `${DASHED}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`);
  d.edge(databaseQuestion, failed, "no", `${DASHED}exitX=1;exitY=0.5;entryX=0.5;entryY=0;`, [[980, 400]]);
  d.edge(rollback, next, "", "exitX=0.5;exitY=1;entryX=1;entryY=0.5;", [[700, 625]]);
  d.edge(failed, next, "", "exitX=0.5;exitY=1;entryX=1;entryY=0.5;", [[980, 660], [700, 660], [700, 625]]);
  return d;
}

function faultTree() {
  const d = createDiagram("diag_fta");
  const gate = `rounded=1;fillColor=${GREY};${BOLD}`;
  const noArrow = "endArrow=none;";
  const top = d.box("TOP EVENT\nstudent payment lost, double-charged\nor recorded inconsistently", 330, 20, 320, 64, `fillColor=${BLACK};fontColor=${WHITE};${BOLD}`);
  const orGate = d.box("OR", 460, 120, 60, 50, gate);
  d.edge(top, orGate, "", `${noArrow}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`);
  const branches = [
    ["Payment not completed\n(lost)", 40, "Transient fault\n(Network / Timeout)", "No retry or\nretries exhausted\n[mitigated: retry x2]"],
    ["Double charge", 370, "Timeout after\nthe charge was applied", "Retry charges again\n[mitigated: charged ids set]"],
    ["Ledger inconsistent", 700, "Database fault\nafter row insert", "No rollback\n[mitigated: checkpoint\n+ rollback]"],
  ];
  for (const [label, x, cause, missingProtection] of branches) {
    const centerX = x + 120;
    const middle = d.box(label, x, 220, 240, 56);
    d.edge(orGate, middle, "", `${noArrow}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`, [[490, 195], [centerX, 195]]);
    const andGate = d.box("AND", centerX - 30, 320, 60, 50, gate);
    d.edge(middle, andGate, "", `${noArrow}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`);
    const first = d.box(cause, x, 430, 115, 90, "ellipse;fontSize=10;");
    const second = d.box(missingProtection, x + 125, 430, 115, 90, `ellipse;fontSize=10;fillColor=${GREY};`);
    d.edge(andGate, first, "", `${noArrow}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`, [[centerX, 400], [x + 57, 400]]);
    d.edge(andGate, second, "", `${noArrow}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`, [[centerX, 400], [x + 182, 400]]);
  }
  d.box("", 40, 560, 24, 16, `fillColor=${GREY};`);
  d.text("grey basic event = the failure mode blocked by a mechanism of this implementation", 70, 556, 520, 24, "align=left;fontSize=10;");
  return d;
}

function axes(d, x0, y0, width, height, yTicks, yFormat, xLabels = []) {
  d.polyline([[x0, y0], [x0, y0 + height]]);
  d.polyline([[x0, y0 + height], [x0 + width, y0 + height]]);
  for (const [tick, fraction] of yTicks) {
    const y = y0 + height - fraction * height;
    d.polyline([[x0 - 5, y], [x0, y]]);
    if (fraction > 0) d.polyline([[x0, y], [x0 + width, y]], `strokeColor=${GREY};`);
    d.text(yFormat(tick), x0 - 60, y - 10, 52, 20, "align=right;fontSize=10;");
  }
  for (const [label, x] of xLabels) d.text(label, x - 60, y0 + height + 6, 120, 30, "fontSize=10;verticalAlign=top;");
}

const loadSummary = (mode) => JSON.parse(fs.readFileSync(path.join(ROOT, "output", mode, "summary.json"), "utf8"));
const thousands = (amount) => `${Math.round(amount / 1000)}k`;

function beforeAfter() {
  const baseline = loadSummary("baseline");
  const faultTolerant = loadSummary("fault_tolerant");
  const d = createDiagram("fig_before_after");
  d.text("Baseline vs fault-tolerant run (15 transactions, 437 000 KZT)", 20, 10, 700, 26, `align=left;fontSize=13;${BOLD}`);
  const panels = [
    ["Transactions", [["Successful", baseline.successful_transactions, faultTolerant.successful_transactions],
      ["Failed / not completed", baseline.transactions_lost, faultTolerant.transactions_lost]], 15, String, 40, [0, 5, 10, 15]],
    ["Amount, thousand KZT", [["Processed", baseline.processed_amount_kzt / 1000, faultTolerant.processed_amount_kzt / 1000],
      ["Lost", baseline.lost_amount_kzt / 1000, faultTolerant.lost_amount_kzt / 1000]], 450, (value) => `${value}k`, 440, [0, 150, 300, 450]],
  ];
  const height = 220;
  for (const [title, categories, maximum, format, panelX, ticks] of panels) {
    const x0 = panelX + 60;
    const width = 300;
    const y0 = 90;
    d.text(title, x0 - 10, 50, width, 24, `align=left;fontSize=12;${BOLD}`);
    axes(d, x0, y0, width, height, ticks.map((tick) => [tick, tick / maximum]), format);
    categories.forEach(([label, baselineValue, faultTolerantValue], index) => {
      const centerX = x0 + 75 + index * 150;
      const barWidth = 50;
      for (const [value, offset, fill] of [[baselineValue, -barWidth - 4, WHITE], [faultTolerantValue, 4, BLACK]]) {
        const barHeight = Math.max(1, Math.round((value / maximum) * height));
        d.box("", centerX + offset, y0 + height - barHeight, barWidth, barHeight, `fillColor=${fill};`);
        d.text(format(value), centerX + offset - 10, y0 + height - barHeight - 22, barWidth + 20, 20, "fontSize=10;");
      }
      d.text(label, centerX - 70, y0 + height + 6, 140, 24, "fontSize=10;verticalAlign=top;");
    });
  }
  d.box("", 600, 12, 22, 14, `fillColor=${WHITE};`);
  d.text("Baseline", 626, 8, 70, 22, "align=left;fontSize=10;");
  d.box("", 700, 12, 22, 14, `fillColor=${BLACK};`);
  d.text("Fault-tolerant", 726, 8, 100, 22, "align=left;fontSize=10;");
  return d;
}

function timeline() {
  const events = fs.readFileSync(path.join(ROOT, "output", "fault_tolerant", "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const series = [[0, 0]];
  const checkpoints = [];
  const rollbacks = [];
  let running = 0;
  for (const event of events) {
    if (event.event === "TRANSACTION_SUCCESS") { running += event.amount; series.push([event.step, running]); }
    else if (event.event === "CHECKPOINT") checkpoints.push([event.step, event.total_amount, event.checkpoint, event.success_count]);
    else if (event.event === "ROLLBACK") rollbacks.push([event.step, event.total_amount, event.transaction, event.restored]);
  }
  const maxStep = Math.max(...series.map((point) => point[0]));
  const maxAmount = 300_000;
  const d = createDiagram("fig_timeline");
  d.text("Fault-tolerant run: ledger total, checkpoints and rollbacks per attempt step", 20, 10, 800, 26, `align=left;fontSize=13;${BOLD}`);
  const x0 = 90;
  const y0 = 60;
  const width = 780;
  const height = 260;
  const X = (step) => x0 + Math.round((step / maxStep) * width);
  const Y = (amount) => y0 + height - Math.round((amount / maxAmount) * height);
  axes(d, x0, y0, width, height, [0, 100_000, 200_000, 300_000].map((value) => [value, value / maxAmount]), thousands,
    [0, 5, 10, 15, 20, 25].map((step) => [String(step), X(step)]));
  d.text("thousand KZT", x0 - 80, y0 - 30, 120, 20, "align=left;fontSize=10;");
  d.text("attempt step (from output/fault_tolerant/events.jsonl)", x0 + width / 2 - 150, y0 + height + 34, 300, 20, "fontSize=10;");
  const points = [];
  series.forEach(([step, amount], index) => {
    if (index > 0) points.push([X(step), Y(series[index - 1][1])]);
    points.push([X(step), Y(amount)]);
  });
  points.push([X(maxStep), Y(series[series.length - 1][1])]);
  d.polyline(points, "strokeWidth=2;");
  for (const [step, amount, name, count] of checkpoints) {
    d.box("", X(step) - 6, Y(amount) - 6, 12, 12, `ellipse;fillColor=${BLACK};`);
    d.text(`${name}: ${count} txns, ${thousands(amount)}`, X(step) - 130, Y(amount) - 34, 130, 20, "align=right;fontSize=10;");
  }
  for (const [step, amount, transaction, restored] of rollbacks) {
    d.box("", X(step) - 7, Y(amount) - 7, 14, 14, `shape=cross;rotation=45;size=0.3;fillColor=${BLACK};`);
    d.text(`${transaction}: DB fault x3\nrollback -> ${restored}`, X(step) + 8, Y(amount) + 4, 140, 34, "align=left;fontSize=10;verticalAlign=top;");
  }
  d.polyline([[360, 82], [400, 82]], "strokeWidth=2;");
  d.text("ledger total", 404, 72, 150, 20, "align=left;fontSize=10;");
  d.box("", 374, 100, 12, 12, `ellipse;fillColor=${BLACK};`);
  d.text("checkpoint", 404, 96, 100, 20, "align=left;fontSize=10;");
  d.box("", 373, 121, 14, 14, `shape=cross;rotation=45;size=0.3;fillColor=${BLACK};`);
  d.text("rollback", 404, 118, 100, 20, "align=left;fontSize=10;");
  return d;
}

const drawioBinary = process.env.DRAWIO || "drawio";
for (const diagram of [architecture(), transactionFlow(), faultTree(), beforeAfter(), timeline()]) {
  const source = diagram.write();
  const png = path.join(FIGURES, `${diagram.name}.png`);
  execFileSync(drawioBinary, ["-x", "-f", "png", "-s", "2", "-b", "16", "-o", png, source], { stdio: ["ignore", "ignore", "ignore"] });
  console.log("wrote", path.relative(ROOT, source), "->", path.relative(ROOT, png));
}
