// Builds final concept SVGs + mockup pages for the BlueClient flame icon.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..');
const R = path.join(__dirname, 'html');
fs.mkdirSync(R, { recursive: true });

const F = `M 256 476 A 148 148 0 0 1 108 328 C 108 250, 150 196, 196 150 C 226 120, 236 84, 226 36 C 290 70, 318 118, 316 170 C 336 150, 346 126, 344 98 C 388 144, 404 230, 404 328 A 148 148 0 0 1 256 476 Z`;

const CONCEPTS = {
  ember: {
    name: 'Rising Ember', blurb: 'Leaning flame whose base curls into an open crescent — the closest match to the feather mark.',
    add: `<circle cx="226" cy="340" r="134"/><path d="M 92 340 C 92 266, 118 196, 170 150 C 206 122, 226 96, 232 58 C 262 84, 272 112, 268 142 C 312 110, 356 88, 392 44 C 404 120, 380 200, 330 244 L 290 290 L 200 300 L 120 340 Z"/>`,
    cut: `<circle cx="231" cy="314" r="131"/>`, top: '',
    stars: [[222, 336, 12], [174, 360, 9], [270, 360, 9], [222, 398, 8], [268, 300, 7], [178, 310, 7], [300, 400, 6]],
    small: [[214, 348, 26], [290, 392, 16]],
  },
  core: {
    name: 'Starcore', blurb: 'Upright flame with its belly hollowed into a star-filled orb. Boldest silhouette; strongest at small sizes.',
    add: `<path d="${F}"/>`, cut: `<circle cx="256" cy="322" r="112"/>`, top: '',
    stars: [[256, 318, 13], [206, 344, 9], [306, 344, 9], [256, 380, 8], [296, 282, 7], [216, 282, 7]],
    small: [[256, 322, 30]],
  },
  cradle: {
    name: 'Moon Cradle', blurb: 'Solid flame rising out of a crescent moon, with twinkles around it. Simplest shapes, most "campfire".',
    add: `<circle cx="256" cy="292" r="176"/>`, cut: `<circle cx="256" cy="268" r="172"/>`,
    top: `<path d="${F}" transform="translate(256 412) scale(0.64) translate(-256 -476)"/>`,
    stars: [[118, 196, 11], [398, 176, 9], [152, 122, 6], [364, 104, 6]],
    small: [[112, 180, 22], [404, 160, 18]],
  },
};

function star(x, y, s, w) {
  return `<rect x="${x - w / 2}" y="${y - s}" width="${w}" height="${2 * s}" rx="${w / 2}"/><rect x="${x - s}" y="${y - w / 2}" width="${2 * s}" height="${w}" rx="${w / 2}"/>`;
}
let uid = 0;
// opts: fg (color or 'url(#g)'), bg: null | {type:'navy'|'blue'|'white'|'black'}, small: bool, pad: shrink mark inside tile
function icon(key, { fg = '#fff', bg = null, small = false, size = 512, glow = false } = {}) {
  const c = CONCEPTS[key]; const id = `k${uid++}`;
  const starList = small ? c.small : c.stars;
  const sw = small ? 0.5 : 0.36;
  const bgs = {
    navy: `<radialGradient id="bg${id}" cx="50%" cy="28%" r="80%"><stop offset="0" stop-color="#1f3d56"/><stop offset="1" stop-color="#060d16"/></radialGradient>`,
    blue: `<linearGradient id="bg${id}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#3b8bff"/><stop offset="1" stop-color="#0a2a78"/></linearGradient>`,
    white: `<linearGradient id="bg${id}"><stop offset="0" stop-color="#fff"/></linearGradient>`,
    black: `<linearGradient id="bg${id}"><stop offset="0" stop-color="#0d0f12"/></linearGradient>`,
  };
  const inset = bg ? 'translate(256 262) scale(0.78) translate(-256 -256)' : '';
  const glowF = glow ? `<filter id="gl${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="10" result="b"/><feFlood flood-color="#7fb8ff" flood-opacity=".45"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
<defs>${bg ? bgs[bg] : ''}${glowF}<mask id="m${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#000"/><g fill="#fff">${c.add}</g><g fill="#000">${c.cut}</g><g fill="#fff">${c.top}</g></mask></defs>
${bg ? `<rect width="512" height="512" rx="114" fill="url(#bg${id})"/>` : ''}
<g transform="${inset}"${glow ? ` filter="url(#gl${id})"` : ''}><rect width="512" height="512" fill="${fg}" mask="url(#m${id})"/><g fill="${fg}">${starList.map(([x, y, s]) => star(x, y, s, s * sw)).join('')}</g></g>
</svg>`;
}

// ---------- export SVG files ----------
fs.mkdirSync(`${OUT}/concepts`, { recursive: true });
Object.keys(CONCEPTS).forEach((k, i) => {
  const n = `${String.fromCharCode(97 + i)}-${k}`;
  fs.writeFileSync(`${OUT}/concepts/${n}.svg`, icon(k));
  fs.writeFileSync(`${OUT}/concepts/${n}-small.svg`, icon(k, { small: true }));
  fs.writeFileSync(`${OUT}/concepts/${n}-app-icon.svg`, icon(k, { bg: 'navy', glow: true }));
});

// ---------- mockup pages ----------
const css = `*{box-sizing:border-box}body{margin:0;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#dfe8f2;background:#070d15}
.h{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#6f8aa3;margin:0 0 18px}`;
const forest = `background:
  radial-gradient(ellipse at 50% 120%, rgba(10,22,34,.0) 0, #07101a 70%),
  linear-gradient(180deg,#0e1c2a 0%,#12283a 55%,#0a1520 100%)`;
const trees = `<svg viewBox="0 0 1200 200" preserveAspectRatio="none" style="position:absolute;left:0;right:0;bottom:0;width:100%;height:45%;opacity:.9;filter:blur(2.5px)"><path fill="#0f2130" d="M0 200 V120 l30-40 20 30 25-60 30 50 20-20 30 50 40-70 30 40 25-30 35 60 30-50 40 40 30-60 35 50 25-20 40 60 30-80 40 70 30-30 35 40 25-50 40 60 30-40 35 30 40-60 30 50 25-30 40 70 30-60 35 40 30-20 40 50 30-70 30 60 L1200 110 V200Z"/></svg>`;

// 1. Hero sheet — each concept on the reference-style night background
let hero = `<html><head><style>${css}
.wrap{padding:48px}.row{display:flex;gap:28px}
.card{position:relative;flex:1;height:560px;border-radius:28px;overflow:hidden;${forest};display:flex;align-items:center;justify-content:center}
.card svg{position:relative;filter:drop-shadow(0 0 22px rgba(140,190,255,.25))}
.cap{margin-top:16px}.cap b{font-size:20px;color:#fff}.cap p{margin:6px 0 0;color:#8ea4b8;font-size:14px;line-height:1.45}
</style></head><body><div class="wrap"><p class="h">BlueClient · flame mark concepts</p><div class="row">`;
Object.entries(CONCEPTS).forEach(([k, c], i) => {
  hero += `<div style="flex:1"><div class="card">${trees}${icon(k, { size: 300 })}</div><div class="cap"><b>${String.fromCharCode(65 + i)} — ${c.name}</b><p>${c.blurb}</p></div></div>`;
});
hero += `</div></div></body></html>`;
fs.writeFileSync(`${R}/m1-hero.html`, hero);

// 2. App icon + colorways + size ramp
let sheet = `<html><head><style>${css}
.wrap{padding:44px 48px}.sec{margin-bottom:40px}
.grid{display:grid;grid-template-columns:180px repeat(4,1fr);gap:18px;align-items:center}
.lab{font-size:15px;color:#fff}.lab small{display:block;color:#6f8aa3;font-size:12px;margin-top:4px}
.tile{display:flex;justify-content:center}
.tile svg{filter:drop-shadow(0 10px 24px rgba(0,0,0,.5))}
.ramp{display:flex;align-items:flex-end;gap:26px;padding:22px 26px;border-radius:18px;background:#0c1622}
.ramp.l{background:#eef2f6}
.ramp div{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:11px;color:#6f8aa3}
.colh{font-size:12px;color:#6f8aa3;text-align:center;letter-spacing:.08em;text-transform:uppercase}
</style></head><body><div class="wrap">
<div class="sec"><p class="h">App icon · colorways</p><div class="grid"><div></div>
<div class="colh">Night (primary)</div><div class="colh">Blue</div><div class="colh">Light</div><div class="colh">Mono</div>`;
Object.entries(CONCEPTS).forEach(([k, c], i) => {
  sheet += `<div class="lab">${String.fromCharCode(65 + i)} — ${c.name}</div>
  <div class="tile">${icon(k, { bg: 'navy', glow: true, size: 168 })}</div>
  <div class="tile">${icon(k, { bg: 'blue', size: 168 })}</div>
  <div class="tile">${icon(k, { bg: 'white', fg: '#0d2a4a', size: 168 })}</div>
  <div class="tile">${icon(k, { bg: 'black', size: 168 })}</div>`;
});
sheet += `</div></div><div class="sec"><p class="h">Size ramp · small sizes switch to a bolder, fewer-star variant</p>`;
Object.entries(CONCEPTS).forEach(([k, c], i) => {
  sheet += `<div style="display:flex;gap:18px;margin-bottom:14px;align-items:center"><div class="lab" style="width:180px">${String.fromCharCode(65 + i)} — ${c.name}</div><div class="ramp">`;
  [128, 64, 48, 32, 24, 16].forEach(s => sheet += `<div>${icon(k, { bg: 'navy', size: s, small: s <= 48 })}<span>${s}</span></div>`);
  sheet += `</div><div class="ramp l">`;
  [64, 32, 16].forEach(s => sheet += `<div>${icon(k, { fg: '#0d2a4a', size: s, small: s <= 48 })}<span>${s}</span></div>`);
  sheet += `</div></div>`;
});
sheet += `</div></div></body></html>`;
fs.writeFileSync(`${R}/m2-app-icons.html`, sheet);

// 3. In-context: launcher splash, browser tab, taskbar
function ctx(k, i) {
  const c = CONCEPTS[k];
  return `<div class="launcher">${trees}
    <div class="top"><div class="brand">${icon(k, { size: 26, small: true })}<span>BlueClient</span></div><div class="dots"><i></i><i></i><i></i></div></div>
    <div class="center">${icon(k, { size: 150 })}<div class="word">BLUE<span>CLIENT</span></div><div class="btn">PLAY</div></div>
  </div>
  <div class="under">
    <div class="tab"><div class="tb">${icon(k, { size: 16, small: true, fg: '#0d2a4a' })}<span>BlueClient — Launcher</span><em>×</em></div><div class="tb off"><span>New Tab</span></div></div>
    <div class="taskbar">
      <b></b><b></b><div class="active">${icon(k, { bg: 'navy', size: 34, small: true })}</div><b></b><b></b>
    </div>
  </div>
  <div class="cap">${String.fromCharCode(65 + i)} — ${c.name}</div>`;
}
let ctxp = `<html><head><style>${css}
.wrap{padding:44px 48px}.row{display:flex;gap:28px}.col{flex:1}
.launcher{position:relative;height:430px;border-radius:16px;overflow:hidden;${forest};box-shadow:0 20px 50px rgba(0,0,0,.5)}
.top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:rgba(5,10,16,.45)}
.brand{display:flex;gap:10px;align-items:center;font-weight:600;font-size:14px}
.dots i{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2a3e52;margin-left:7px}
.center{position:relative;display:flex;flex-direction:column;align-items:center;margin-top:34px}
.center svg{filter:drop-shadow(0 0 26px rgba(140,190,255,.35))}
.word{margin-top:12px;font-weight:800;letter-spacing:.3em;font-size:20px}.word span{color:#6fb0ff}
.btn{margin-top:22px;padding:11px 54px;border-radius:10px;background:linear-gradient(#3b8bff,#1f5fd6);font-weight:700;letter-spacing:.2em;font-size:13px;box-shadow:0 6px 18px rgba(59,139,255,.35)}
.under{display:flex;gap:14px;margin-top:16px;align-items:stretch}
.tab{flex:1.4;background:#dfe3e8;border-radius:10px;padding:8px 8px 0;display:flex;gap:4px}
.tb{display:flex;align-items:center;gap:8px;background:#fff;color:#222;font-size:12px;padding:8px 10px;border-radius:8px 8px 0 0;flex:1;white-space:nowrap;overflow:hidden}
.tb em{margin-left:auto;font-style:normal;color:#888}.tb.off{background:transparent;color:#666;flex:.6}
.tb svg{flex:none}.tb svg rect[fill="#fff"]{}
.taskbar{flex:1;display:flex;gap:10px;justify-content:center;align-items:center;background:rgba(30,40,55,.85);border-radius:12px;padding:8px}
.taskbar b{width:34px;height:34px;border-radius:8px;background:#2c3a4c}
.taskbar .active{position:relative}.taskbar .active:after{content:"";position:absolute;left:11px;right:11px;bottom:-6px;height:3px;border-radius:2px;background:#6fb0ff}
.cap{margin-top:14px;font-size:17px;color:#fff;font-weight:600}
</style></head><body><div class="wrap"><p class="h">In context · launcher, browser tab, taskbar</p><div class="row">`;
Object.keys(CONCEPTS).forEach((k, i) => ctxp += `<div class="col">${ctx(k, i)}</div>`);
ctxp += `</div></div></body></html>`;
fs.writeFileSync(`${R}/m3-in-context.html`, ctxp);
console.log('built');
