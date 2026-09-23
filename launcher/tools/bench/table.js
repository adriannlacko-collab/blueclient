'use strict';

/**
 * Markdown tables out of run.js result files (2026-09-22).
 *
 *   node tools/bench/table.js results/jvm-26.3.jsonl [...]
 *
 * One row per variant, over the clean timed runs (not training, not failed,
 * not contaminated by other load on the machine): median [min–max].
 */

const fs = require('fs');

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function cell(xs, digits = 1) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return '—';
  const f = (x) => x.toFixed(digits);
  return `${f(median(v))} [${f(Math.min(...v))}–${f(Math.max(...v))}]`;
}

for (const file of process.argv.slice(2)) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const order = [];
  const by = {};
  const all = {};
  for (const r of rows) {
    if (r.training) continue;
    if (!all[r.variant]) { all[r.variant] = []; order.push(r.variant); }
    all[r.variant].push(r);
    if (!r.ok || r.contaminated) continue;
    (by[r.variant] = by[r.variant] || []).push(r);
  }
  console.log(`\n**${file}**\n`);
  console.log('| config | clean/all | title (s) | in world (s) | avg FPS | 1% low FPS | pause p99 (ms) | pause max (ms) | GC+safepoint pause before title (ms) | peak RSS (MB) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const id of order) {
    const rs = by[id] || [];
    const col = (f) => rs.map(f);
    console.log(`| ${id} | ${rs.length}/${all[id].length} | ${cell(col((r) => r.titleS))} | ${cell(col((r) => r.worldS))} | ` +
      `${cell(col((r) => r.fps && r.fps.avgFps))} | ${cell(col((r) => r.fps && r.fps.low1Fps))} | ` +
      `${cell(col((r) => r.pauses.window.p99Ms))} | ${cell(col((r) => r.pauses.window.maxMs))} | ` +
      `${cell(col((r) => r.pauses.startup.totalMs), 0)} | ${cell(col((r) => r.peakRssMb), 0)} |`);
  }
  // Paired by round: the load from other tenants moves between rounds far
  // more than between the neighbouring runs of one round, so each variant is
  // set against the first variant (the baseline) of the same round, and the
  // median of those per-round changes is what the variant is judged by.
  const base = order[0];
  const baseBy = {};
  for (const r of by[base] || []) baseBy[r.round] = r;
  const metrics = [
    ['title', (r) => r.titleS],
    ['in world', (r) => r.worldS],
    ['avg FPS', (r) => r.fps && r.fps.avgFps],
    ['1% low', (r) => r.fps && r.fps.low1Fps],
    ['pause max', (r) => r.pauses.window.maxMs]
  ];
  console.log(`\nPaired against **${base}** in the same round — median change [min–max] over rounds:\n`);
  console.log('| config | rounds | ' + metrics.map((m) => m[0]).join(' | ') + ' |');
  console.log('|---|---|' + metrics.map(() => '---').join('|') + '|');
  for (const id of order.slice(1)) {
    const pairs = (by[id] || []).filter((r) => baseBy[r.round]).map((r) => [r, baseBy[r.round]]);
    const cells = metrics.map(([, f]) => {
      const d = pairs.map(([a, b]) => (f(a) / f(b) - 1) * 100).filter(Number.isFinite);
      if (!d.length) return '—';
      const s = (x) => (x > 0 ? '+' : '') + x.toFixed(0) + '%';
      return `${s(median(d))} [${s(Math.min(...d))}…${s(Math.max(...d))}]`;
    });
    console.log(`| ${id} | ${pairs.length} | ${cells.join(' | ')} |`);
  }

  const trained = rows.filter((r) => r.training);
  for (const t of trained) {
    console.log(`\n(${t.variant}: training run, title ${t.titleS && t.titleS.toFixed(1)} s, world ${t.worldS && t.worldS.toFixed(1)} s, exit ${t.exit}, foreign cores ${JSON.stringify(t.foreignCores)})`);
  }
}
