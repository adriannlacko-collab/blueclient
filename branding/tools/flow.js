// Builds the "Flowing Flame" marks (simplified ribbon style) + a mockup page.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..');
const R = path.join(__dirname, 'html');
fs.mkdirSync(R, { recursive: true });

// Catmull-Rom through [x, y, width] control points
function spline(pts, n = 32) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([f(0), f(1), Math.max(0, f(2))]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// Tapered ribbon: offset the centerline by half its width on both sides
function ribbon(pts) {
  const s = spline(pts), L = [], Rt = [];
  s.forEach((p, i) => {
    const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const w = p[2] / 2;
    L.push([p[0] - dy * w, p[1] + dx * w]); Rt.push([p[0] + dy * w, p[1] - dx * w]);
  });
  return 'M' + L.concat(Rt.reverse()).map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L') + ' Z';
}
function star(x, y, s, w) {
  return `<rect x="${x - w / 2}" y="${y - s}" width="${w}" height="${2 * s}" rx="${w / 2}"/><rect x="${x - s}" y="${y - w / 2}" width="${2 * s}" height="${w}" rx="${w / 2}"/>`;
}

const bowl = [[118, 206, 0], [100, 290, 22], [132, 382, 42], [216, 448, 48], [316, 450, 36], [394, 402, 16], [426, 332, 0]];
const STARS = [[256, 380, 13], [200, 358, 9], [312, 368, 9], [230, 414, 8], [290, 412, 7], [162, 318, 7]];
const SMALL = [[256, 378, 22], [192, 350, 14], [318, 362, 14]];
const MARKS = {
  classic: {
    name: 'Flowing Flame', blurb: 'Two S-curved flame ribbons over a crescent bowl of stars. Both tips point up — reads as fire instantly.',
    ribbons: [bowl,
      [[246, 324, 0], [204, 284, 22], [184, 226, 42], [202, 160, 52], [246, 106, 44], [268, 68, 28], [262, 26, 0]],
      [[318, 336, 0], [358, 290, 20], [370, 234, 32], [356, 180, 28], [362, 144, 14], [386, 114, 0]]],
  },
  wave: {
    name: 'Flowing Flame · Wave', blurb: 'Same build, but the main crest rolls over to the right like your reference.',
    ribbons: [bowl,
      [[246, 324, 0], [202, 282, 22], [180, 222, 42], [196, 156, 52], [238, 102, 46], [274, 66, 32], [308, 46, 16], [342, 44, 0]],
      [[318, 336, 0], [360, 290, 20], [372, 234, 32], [352, 180, 28], [348, 144, 14], [364, 112, 0]]],
  },
};
// geometry centre of the marks, used to centre them in a tile
const CX = 263, CY = 250;

let uid = 0;
function icon(key, { fg = '#fff', bg = null, small = false, size = 512 } = {}) {
  const m = MARKS[key], id = `f${uid++}`;
  const bgs = {
    sky: `<linearGradient id="b${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2463d8"/><stop offset="1" stop-color="#7fdcef"/></linearGradient>`,
    navy: `<radialGradient id="b${id}" cx="50%" cy="28%" r="80%"><stop offset="0" stop-color="#1f3d56"/><stop offset="1" stop-color="#060d16"/></radialGradient>`,
    white: `<linearGradient id="b${id}"><stop offset="0" stop-color="#fff"/></linearGradient>`,
    black: `<linearGradient id="b${id}"><stop offset="0" stop-color="#0d0f12"/></linearGradient>`,
  };
  const scale = bg ? 0.8 : 1.08;
  const tf = `translate(256 256) scale(${scale}) translate(${-CX} ${-CY})`;
  const stars = (small ? SMALL : STARS).map(([x, y, s]) => star(x, y, s, s * (small ? 0.5 : 0.34))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${bg ? `<defs>${bgs[bg]}</defs><rect width="512" height="512" rx="114" fill="url(#b${id})"/>` : ''}<g fill="${fg}" transform="${tf}">${m.ribbons.map(r => `<path d="${ribbon(r)}"/>`).join('')}${stars}</g></svg>`;
}

// ---------- SVG exports ----------
Object.keys(MARKS).forEach((k, i) => {
  const n = `${String.fromCharCode(100 + i)}-flow-${k}`; // d-, e-
  fs.writeFileSync(`${OUT}/concepts/${n}.svg`, icon(k));
  fs.writeFileSync(`${OUT}/concepts/${n}-small.svg`, icon(k, { small: true }));
  fs.writeFileSync(`${OUT}/concepts/${n}-app-icon.svg`, icon(k, { bg: 'sky' }));
});

// ---------- mockup page ----------
const trees = `<svg viewBox="0 0 1200 200" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:0;width:100%;height:45%;opacity:.9;filter:blur(2.5px)"><path fill="#0f2130" d="M0 200 V120 l30-40 20 30 25-60 30 50 20-20 30 50 40-70 30 40 25-30 35 60 30-50 40 40 30-60 35 50 25-20 40 60 30-80 40 70 30-30 35 40 25-50 40 60 30-40 35 30 40-60 30 50 25-30 40 70 30-60 35 40 30-20 40 50 30-70 30 60 L1200 110 V200Z"/></svg>`;
let h = `<html><head><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#dfe8f2;background:#070d15}
.wrap{padding:44px 48px}.h{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6f8aa3;margin:0 0 18px}
.row{display:flex;gap:28px;margin-bottom:34px}
.hero{position:relative;flex:1;height:440px;border-radius:26px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.hero.sky{background:linear-gradient(135deg,#2463d8,#7fdcef)}
.hero.night{background:linear-gradient(180deg,#0e1c2a,#12283a 55%,#0a1520)}
.hero svg.m{position:relative;filter:drop-shadow(0 0 20px rgba(160,210,255,.35))}
.cap{margin-top:12px}.cap b{font-size:18px;color:#fff}.cap p{margin:5px 0 0;color:#8ea4b8;font-size:14px}
.tiles{display:flex;gap:22px;align-items:center}.tiles svg{filter:drop-shadow(0 10px 22px rgba(0,0,0,.45))}
.ramp{display:flex;align-items:flex-end;gap:22px;padding:20px 24px;border-radius:18px;background:#0c1622}.ramp.l{background:#eef2f6}
.ramp div{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11px;color:#6f8aa3}
.launcher{position:relative;width:560px;height:340px;border-radius:16px;overflow:hidden;background:linear-gradient(180deg,#0e1c2a,#12283a 55%,#0a1520)}
.center{position:relative;display:flex;flex-direction:column;align-items:center;padding-top:30px}
.center svg{filter:drop-shadow(0 0 24px rgba(140,190,255,.35))}
.word{margin-top:8px;font-weight:800;letter-spacing:.3em;font-size:19px}.word span{color:#6fb0ff}
.btn{margin-top:18px;padding:10px 52px;border-radius:10px;background:linear-gradient(#3b8bff,#1f5fd6);font-weight:700;letter-spacing:.2em;font-size:13px}
.side{display:flex;flex-direction:column;gap:14px;justify-content:center}
.tab{background:#dfe3e8;border-radius:10px;padding:8px 8px 0;width:300px}
.tb{display:flex;align-items:center;gap:8px;background:#fff;color:#222;font-size:12px;padding:8px 10px;border-radius:8px 8px 0 0}
.taskbar{display:flex;gap:10px;justify-content:center;align-items:center;background:rgba(30,40,55,.9);border-radius:12px;padding:8px;width:300px}
.taskbar b{width:34px;height:34px;border-radius:8px;background:#2c3a4c}
</style></head><body><div class="wrap"><p class="h">BlueClient · flowing flame — simplified</p><div class="row">`;
Object.entries(MARKS).forEach(([k, m]) => {
  h += `<div style="flex:1"><div class="hero sky">${icon(k, { size: 380 }).replace('<svg', '<svg class="m"')}</div><div class="cap"><b>${m.name}</b><p>${m.blurb}</p></div></div>`;
});
h += `<div style="flex:1"><div class="hero night">${trees}${icon('classic', { size: 380 }).replace('<svg', '<svg class="m"')}</div><div class="cap"><b>On the night background</b><p>Same mark in the first concept's forest style.</p></div></div></div>`;
h += `<p class="h">App icon · colorways</p>`;
Object.keys(MARKS).forEach(k => {
  h += `<div class="tiles" style="margin-bottom:22px">${['sky', 'navy', 'white', 'black'].map(bg => icon(k, { bg, size: 150, fg: bg === 'white' ? '#1a4fb0' : '#fff' })).join('')}
  <div class="ramp">${[96, 64, 48, 32, 24, 16].map(s => `<div>${icon(k, { bg: 'sky', size: s, small: s <= 48 })}<span>${s}</span></div>`).join('')}</div>
  <div class="ramp l">${[48, 32, 16].map(s => `<div>${icon(k, { fg: '#1a4fb0', size: s, small: true })}<span>${s}</span></div>`).join('')}</div></div>`;
});
h += `<p class="h" style="margin-top:34px">In context</p><div class="row" style="align-items:center">
<div class="launcher">${trees}<div class="center">${icon('classic', { size: 150 })}<div class="word">BLUE<span>CLIENT</span></div><div class="btn">PLAY</div></div></div>
<div class="side"><div class="tab"><div class="tb">${icon('classic', { size: 16, small: true, fg: '#1a4fb0' })}<span>BlueClient — Launcher</span></div></div>
<div class="taskbar"><b></b><b></b>${icon('classic', { bg: 'sky', size: 34, small: true })}<b></b><b></b></div>
<div class="taskbar" style="background:#e9edf2">${['', '', 'x', '', ''].map(x => x ? icon('classic', { bg: 'sky', size: 34, small: true }) : '<b style="background:#cfd6de"></b>').join('')}</div></div>
<div class="launcher" style="background:linear-gradient(135deg,#2463d8,#7fdcef)"><div class="center">${icon('wave', { size: 150 })}<div class="word">BLUE<span style="color:#0b2a6b">CLIENT</span></div><div class="btn" style="background:#fff;color:#1f5fd6">PLAY</div></div></div>
</div></div></body></html>`;
fs.writeFileSync(`${R}/m4-flowing-flame.html`, h);
console.log('built');
