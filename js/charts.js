/**
 * Small dependency-free SVG charts.
 *
 * Every chart here is single-series on one axis, which keeps identity out of
 * colour entirely — the title names the series, so no legend is needed and no
 * colour-blind pair can collide. Colours come from CSS custom properties on
 * `.viz-root` (see styles.css) so light and dark are each chosen, not flipped.
 */

const NS = 'http://www.w3.org/2000/svg';

const el = (name, attrs = {}, children = []) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  for (const c of children) node.appendChild(c);
  return node;
};

const text = (s) => document.createTextNode(s);

/**
 * Gridlines at values a human would have chosen, covering [lo, hi].
 * Bars always pass lo = 0 (length encodes magnitude, so the baseline is not
 * negotiable); line charts may start above zero, where the axis shows change.
 */
function niceTicks(hi, lo = 0, count = 4) {
  if (hi <= lo) return { min: lo, max: lo + 1, ticks: [lo, lo + 1] };
  const rough = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) || 10 * mag;
  const bottom = Math.floor(lo / step) * step;
  const top = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = bottom; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min: bottom, max: top, ticks };
}

const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function frame(host, title, subtitle) {
  host.innerHTML = '';
  host.classList.add('viz-root');
  const wrap = document.createElement('figure');
  wrap.className = 'chart';
  const cap = document.createElement('figcaption');
  cap.innerHTML = `<span class="chart-title">${title}</span>${subtitle ? `<span class="chart-sub">${subtitle}</span>` : ''}`;
  wrap.appendChild(cap);
  const plot = document.createElement('div');
  plot.className = 'chart-plot';
  wrap.appendChild(plot);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.appendChild(tip);
  host.appendChild(wrap);
  return { wrap, plot, tip };
}

function empty(host, title, message) {
  const { plot } = frame(host, title, '');
  plot.innerHTML = `<p class="chart-empty">${message}</p>`;
}

function showTip(tip, wrap, x, y, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const box = wrap.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(4, Math.min(x - w / 2, box.width - w - 4))}px`;
  tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
}

// ---------------------------------------------------------------------------
// Line chart over a real time axis
// ---------------------------------------------------------------------------

export function renderLine(host, opts) {
  const {
    title, subtitle = '', points = [], format = (v) => String(Math.round(v)),
  } = opts;

  if (points.length < 2) {
    empty(host, title, points.length === 1
      ? 'One data point so far — log this lift again and the trend line appears.'
      : 'No data yet.');
    return;
  }

  const { wrap, plot, tip } = frame(host, title, subtitle);
  const W = 640; const H = 240;
  const M = { t: 16, r: 16, b: 28, l: 48 };

  const xs = points.map((p) => new Date(`${p.date}T00:00:00`).getTime());
  const ys = points.map((p) => p.value);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const lo = Math.min(...ys); const hi = Math.max(...ys);
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.05);
  const { min: yMin, max: yMax, ticks } = niceTicks(hi + pad, Math.max(0, lo - pad));

  const sx = (t) => M.l + ((t - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (v) => H - M.b - ((v - yMin) / (yMax - yMin || 1)) * (H - M.t - M.b);

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': `${title}. ${points.length} points from ${points[0].date} to ${points.at(-1).date}.`,
  });

  for (const t of ticks) {
    svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    svg.appendChild(el('text', { x: M.l - 8, y: sy(t) + 4, class: 'axis', 'text-anchor': 'end' }, [text(format(t))]));
  }
  svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'baseline' }));

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.value).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { d, class: 'line' }));

  points.forEach((p, i) => {
    svg.appendChild(el('circle', { cx: sx(xs[i]), cy: sy(p.value), r: 4.5, class: 'dot' }));
  });

  // Direct-label the latest point only — never a number on every dot.
  const last = points.at(-1);
  svg.appendChild(el('text', {
    x: sx(xs.at(-1)), y: sy(last.value) - 12, class: 'point-label', 'text-anchor': 'end',
  }, [text(format(last.value))]));

  svg.appendChild(el('text', { x: M.l, y: H - 8, class: 'axis' }, [text(shortDate(points[0].date))]));
  svg.appendChild(el('text', { x: W - M.r, y: H - 8, class: 'axis', 'text-anchor': 'end' }, [text(shortDate(points.at(-1).date))]));

  const cross = el('line', { class: 'crosshair', y1: M.t, y2: H - M.b, x1: 0, x2: 0, opacity: 0 });
  svg.appendChild(cross);
  const halo = el('circle', { class: 'dot-halo', r: 7, opacity: 0 });
  svg.appendChild(halo);

  plot.appendChild(svg);

  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * W;
    let best = 0;
    points.forEach((_, i) => {
      if (Math.abs(sx(xs[i]) - px) < Math.abs(sx(xs[best]) - px)) best = i;
    });
    const p = points[best];
    cross.setAttribute('x1', sx(xs[best]));
    cross.setAttribute('x2', sx(xs[best]));
    cross.setAttribute('opacity', 1);
    halo.setAttribute('cx', sx(xs[best]));
    halo.setAttribute('cy', sy(p.value));
    halo.setAttribute('opacity', 1);
    showTip(tip, wrap, (sx(xs[best]) / W) * rect.width, (sy(p.value) / H) * rect.height + svg.offsetTop,
      `<strong>${format(p.value)}</strong><span>${shortDate(p.date)}</span>${p.note ? `<span>${p.note}</span>` : ''}`);
  };
  const leave = () => {
    cross.setAttribute('opacity', 0);
    halo.setAttribute('opacity', 0);
    tip.hidden = true;
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', move, { passive: true });
  svg.addEventListener('mouseleave', leave);
  svg.addEventListener('touchend', leave);
}

// ---------------------------------------------------------------------------
// Vertical bars
// ---------------------------------------------------------------------------

export function renderBars(host, opts) {
  const {
    title, subtitle = '', bars = [], format = (v) => String(Math.round(v)),
  } = opts;

  if (!bars.length) { empty(host, title, 'No sessions logged yet.'); return; }

  const { wrap, plot, tip } = frame(host, title, subtitle);
  const W = 640; const H = 220;
  const M = { t: 14, r: 12, b: 30, l: 54 };
  const { max, ticks } = niceTicks(Math.max(...bars.map((b) => b.value)), 0);

  const innerW = W - M.l - M.r;
  const slot = innerW / bars.length;
  const barW = Math.max(6, Math.min(46, slot - 6)); // keeps a clear gap between bars
  const sy = (v) => H - M.b - (v / (max || 1)) * (H - M.t - M.b);

  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img',
    'aria-label': `${title}. ${bars.map((b) => `${b.label}: ${format(b.value)}`).join('; ')}`,
  });

  for (const t of ticks) {
    svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    svg.appendChild(el('text', { x: M.l - 8, y: sy(t) + 4, class: 'axis', 'text-anchor': 'end' }, [text(format(t))]));
  }

  bars.forEach((b, i) => {
    const x = M.l + slot * i + (slot - barW) / 2;
    const y = sy(b.value);
    const rect = el('rect', {
      x, y, width: barW, height: Math.max(1, H - M.b - y), rx: 4, class: 'bar',
    });
    const show = () => {
      const box = svg.getBoundingClientRect();
      showTip(tip, wrap, ((x + barW / 2) / W) * box.width, (y / H) * box.height + svg.offsetTop,
        `<strong>${format(b.value)}</strong><span>${b.tipLabel || b.label}</span>${b.sub ? `<span>${b.sub}</span>` : ''}`);
    };
    rect.addEventListener('mouseenter', show);
    rect.addEventListener('touchstart', show, { passive: true });
    rect.addEventListener('mouseleave', () => { tip.hidden = true; });
    svg.appendChild(rect);

    const every = Math.ceil(bars.length / 6);
    if (bars.length <= 8 || i === bars.length - 1 || i % every === 0) {
      svg.appendChild(el('text', {
        x: x + barW / 2, y: H - 10, class: 'axis', 'text-anchor': 'middle',
      }, [text(b.label)]));
    }
  });

  svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, class: 'baseline' }));
  plot.appendChild(svg);
}

// ---------------------------------------------------------------------------
// Horizontal bars (weekly sets per muscle)
// ---------------------------------------------------------------------------

export function renderHBars(host, opts) {
  const {
    title, subtitle = '', rows = [], format = (v) => String(Math.round(v)), capAt = null,
  } = opts;

  if (!rows.length) { empty(host, title, 'Nothing logged in this window.'); return; }

  const { plot } = frame(host, title, subtitle);
  const max = Math.max(...rows.map((r) => r.value), capAt || 0);
  const list = document.createElement('ul');
  list.className = 'hbars';

  for (const r of rows) {
    const li = document.createElement('li');
    const over = capAt !== null && r.value > capAt;
    li.innerHTML = `
      <span class="hbar-label">${r.label}</span>
      <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, (r.value / max) * 100)}%"></span></span>
      <span class="hbar-value">${format(r.value)}${over ? ' <span class="hbar-warn">⚠ over</span>' : ''}</span>`;
    list.appendChild(li);
  }
  plot.appendChild(list);
}

/** Accessible fallback: the same numbers as a table. */
export function renderTable(host, columns, rows) {
  const table = document.createElement('table');
  table.className = 'data-table';
  table.innerHTML = `<thead><tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  host.appendChild(table);
}
