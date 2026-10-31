import { number, quantity, unitOf } from './journeys.js';
import { paint } from './terminal.js';

export function bucketsFor(daily, count) {
  const size = Math.max(1, Math.ceil(daily.length / count));
  const buckets = [];
  for (let i = 0; i < daily.length; i += size) {
    const items = daily.slice(i, i + size);
    buckets.push({ start: items[0].date, end: items.at(-1).date, days: items.length,
      amount: items.reduce((sum, d) => sum + d.amount, 0), cumulative: items.at(-1).cumulative,
      goal: items.every(d => d.goal > 0) ? items.reduce((sum, d) => sum + d.goal, 0) / items.length : null });
  }
  return { buckets, size };
}
const shortDate = date => date.slice(5).replace('-', '/');

function drawLine(values, pixelsX, pixelsY, ceiling, point) {
  const coord = (index, value) => [Math.round(index * (pixelsX - 1) / Math.max(1, values.length - 1)), Math.round((1 - value / ceiling) * (pixelsY - 1))];
  values.forEach((value, i) => {
    const [x1, y1] = coord(Math.max(0, i - 1), values[Math.max(0, i - 1)]);
    const [x2, y2] = coord(i, value);
    const steps = Math.max(1, Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = 0; s <= steps; s++) point(Math.round(x1 + (x2 - x1) * s / steps), Math.round(y1 + (y2 - y1) * s / steps));
  });
}

// Braille gives each terminal cell a 2×4 plotting surface for a continuous line.
export function plot(stats, { width = 70, height = 10, cumulative = false, color = true, cursor = null } = {}) {
  const unit = unitOf(stats.activity);
  const divisor = unit === 'minutes' && cumulative ? 60 : 1;
  const chartUnit = unit === 'minutes' ? cumulative ? 'hours' : 'min/day' : cumulative ? unit : `${unit}/day`;
  const columns = Math.max(8, width - 11);
  const { buckets, size } = bucketsFor(stats.daily, columns);
  const values = buckets.map(b => (cumulative ? b.cumulative : b.amount / b.days) / divisor);
  const goals = cumulative ? [] : buckets.map(bucket => bucket.goal);
  const hasGoals = goals.some(goal => goal > 0);
  const max = Math.max(1, ...values, ...goals.map(goal => goal || 0));
  const scale = 10 ** Math.floor(Math.log10(max));
  const ceiling = Math.ceil(max / scale * 2) / 2 * scale;
  const pixelsX = columns * 2, pixelsY = height * 4;
  const pixels = Array.from({ length: pixelsY }, () => Array(pixelsX).fill(false));
  const point = (x, y) => { if (x >= 0 && y >= 0 && x < pixelsX && y < pixelsY) pixels[y][x] = true; };
  const coord = (i, value) => [Math.round(i * (pixelsX - 1) / Math.max(1, values.length - 1)), Math.round((1 - value / ceiling) * (pixelsY - 1))];
  if (cumulative) {
    drawLine(values, pixelsX, pixelsY, ceiling, point);
  } else {
    values.forEach((value, i) => {
      if (!value) return;
      const x = Math.floor(i * pixelsX / values.length);
      const right = Math.max(x + 1, Math.floor((i + 1) * pixelsX / values.length) - 1);
      const y = coord(i, value)[1];
      for (let px = x; px < right; px++) for (let py = y; py < pixelsY; py++) point(px, py);
    });
  }
  const goalRows = Array.from({ length: columns }, (_, col) => {
    const goal = goals[Math.min(goals.length - 1, Math.floor(col * goals.length / columns))];
    return goal > 0 ? Math.min(height - 1, Math.floor((1 - goal / ceiling) * (height - 1))) : -1;
  });
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const lines = [` ${chartUnit}${size > 1 ? ` · ${size}-day buckets${cumulative ? ' (end totals)' : ' (daily average)'}` : ''}`];
  for (let row = 0; row < height; row++) {
    const label = row === 0 || row === height - 1 || row === Math.floor(height / 2) ? number(ceiling * (1 - row / (height - 1))).padStart(8) : ' '.repeat(8);
    let line = `${label} ${paint('│', 'border', color)}`;
    for (let col = 0; col < columns; col++) {
      let bitsOn = 0;
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) if (pixels[row * 4 + dy][col * 2 + dx]) bitsOn |= bits[dy][dx];
      line += bitsOn ? paint(String.fromCodePoint(0x2800 + bitsOn), stats.activity.color, color)
        : row === goalRows[col] ? paint('┄', 'yellow', color)
          : row === Math.floor(height / 2) ? paint('╌', 'border', color) : ' ';
    }
    lines.push(line);
  }
  lines.push(`         ${paint('└' + '─'.repeat(columns), 'border', color)}`);
  const left = shortDate(stats.start), right = shortDate(stats.end);
  lines.push(`          ${left}${' '.repeat(Math.max(0, columns - left.length - right.length))}${right}`);
  if (cursor != null) {
    const index = Math.min(stats.daily.length - 1, Math.max(0, cursor));
    const position = Math.round(index / Math.max(1, stats.daily.length - 1) * (columns - 1));
    const day = stats.daily[index];
    lines.push(' '.repeat(10 + position) + paint('▲', 'bright', color));
    lines.push(` ${day.date}  ·  ${quantity(day.amount, unit)}  ·  ${quantity(day.cumulative, unit, unit === 'minutes')} cumulative`);
    lines.push(day.goal > 0 ? ` Goal: ${quantity(day.goal, unit)} · ${day.goalMet ? 'met' : 'not met'}` : ' No goal on this day.');
  }
  if (hasGoals) {
    const constant = stats.daily.every(day => day.goal === stats.daily[0].goal);
    lines.push(paint(constant ? ` ┄ Daily goal: ${quantity(goals[0], unit)}` : ` ┄ Daily goals by date${size > 1 ? ' (bucket average)' : ''}`, 'yellow', color));
  }
  return lines;
}

export function categoryPlot(stats, { width = 70, height = 10, color = true, cursor = null, selected = 0 } = {}) {
  const unit = unitOf(stats.activity), divisor = unit === 'minutes' ? 60 : 1;
  const columns = Math.max(8, width - 11), pixelsX = columns * 2, pixelsY = height * 4;
  const series = stats.series.map((item, index) => ({ ...item, index,
    values: bucketsFor(item.daily, columns).buckets.map(bucket => bucket.cumulative / divisor) }));
  const max = Math.max(1, ...series.map(item => item.total / divisor));
  const scale = 10 ** Math.floor(Math.log10(max)), ceiling = Math.ceil(max / scale * 2) / 2 * scale;
  const pixels = Array.from({ length: pixelsY }, () => Array(pixelsX).fill(null));
  // Draw the selected line last so it remains visible when curves overlap.
  const ordered = [...series.filter(item => item.index !== selected), ...series.filter(item => item.index === selected)];
  for (const item of ordered) {
    if (!color && item.index !== selected) continue;
    drawLine(item.values, pixelsX, pixelsY, ceiling, (x, y) => { pixels[y][x] = item.index; });
  }
  const bits = [[1, 8], [2, 16], [4, 32], [64, 128]];
  const lines = [` ${unit === 'minutes' ? 'hours' : unit} · ${color ? 'cumulative by category' : `selected: ${series[selected]?.name ?? ''}`}`];
  for (let row = 0; row < height; row++) {
    const label = row === 0 || row === height - 1 || row === Math.floor(height / 2) ? number(ceiling * (1 - row / (height - 1))).padStart(8) : ' '.repeat(8);
    let line = `${label} ${paint('│', 'border', color)}`;
    for (let col = 0; col < columns; col++) {
      const masks = new Map();
      for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) {
        const owner = pixels[row * 4 + dy][col * 2 + dx];
        if (owner != null) masks.set(owner, (masks.get(owner) || 0) | bits[dy][dx]);
      }
      const owner = masks.has(selected) ? selected : masks.keys().next().value;
      line += owner != null ? paint(String.fromCodePoint(0x2800 + masks.get(owner)), series[owner].color, color) : ' ';
    }
    lines.push(line);
  }
  lines.push(`         ${paint('└' + '─'.repeat(columns), 'border', color)}`);
  const left = shortDate(stats.start), right = shortDate(stats.end);
  lines.push(`          ${left}${' '.repeat(Math.max(0, columns - left.length - right.length))}${right}`);
  if (cursor != null) {
    const index = Math.min(stats.daily.length - 1, Math.max(0, cursor));
    const position = Math.round(index / Math.max(1, stats.daily.length - 1) * (columns - 1));
    lines.push(' '.repeat(10 + position) + paint('▲', 'bright', color));
  }
  return lines;
}
