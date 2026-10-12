const WIDTH = 30;

const fmt = (seconds) => `${Math.floor(seconds / 60)}m${Math.floor(seconds % 60)}s`;

/**
 * The trusty progress bar, now in one place:
 *   Progress : 42% [############------------------] 58%  elapsed: 0m12s | time-left: 0m16s | total(est): 0m28s  42 / 100 - ohio_columbus
 * Falls back to one line per 10% when stdout isn't a TTY (CI, `docker compose run -T`, log files).
 */
export class ProgressBar {
  constructor(label, total, { stream = process.stdout, format = String } = {}) {
    this.label = label;
    this.format = format;
    this.total = Math.max(total, 1);
    this.current = 0;
    this.stream = stream;
    this.started = Date.now();
    this.lastDecile = -1;
    this.lastDraw = 0;
  }

  tick(amount = 1, detail = '') {
    this.update(this.current + amount, detail);
  }

  update(current, detail = '') {
    this.current = Math.min(current, this.total);
    const now = Date.now();
    const finished = this.current >= this.total;
    if (!finished && now - this.lastDraw < 100) return;
    this.lastDraw = now;

    const ratio = this.current / this.total;
    const percent = Math.floor(ratio * 100);
    const elapsed = (now - this.started) / 1000;
    const estimate = ratio > 0 ? elapsed / ratio : 0;
    const filled = Math.round(ratio * WIDTH);
    const bar = `[${'#'.repeat(filled)}${'-'.repeat(WIDTH - filled)}]`;
    const line =
      `${this.label} : ${percent}% ${bar} ${100 - percent}%  ` +
      `elapsed: ${fmt(elapsed)} | time-left: ${fmt(Math.max(estimate - elapsed, 0))} | total(est): ${fmt(estimate)}  ` +
      `${this.format(this.current)} / ${this.format(this.total)}${detail ? ` - ${detail}` : ''}`;

    if (this.stream.isTTY) {
      const cols = this.stream.columns || 120;
      this.stream.write(`\r${line.slice(0, cols - 1).padEnd(cols - 1)}`);
      if (finished) this.stream.write('\n');
    } else {
      const decile = Math.floor(percent / 10);
      if (decile !== this.lastDecile) {
        this.lastDecile = decile;
        this.stream.write(`${line}\n`);
      }
    }
  }
}
