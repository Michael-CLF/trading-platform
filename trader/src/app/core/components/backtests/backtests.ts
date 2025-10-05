// src/app/core/components/backtests/backtests.ts
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { MarketDataService } from '../../services/market-data.service';
import { Bar15m } from '../../shared/models/bar.model';
import { LabeledBar15m } from '../../shared/models/label.model';
import { FeatureVector } from '../../shared/models/feature-vector.model';
import { BacktestSummary } from '../../shared/models/backtest.models';
import { Metrics } from '../../shared/models/metrics.model';

import { makeNext15mLabels } from '../../shared/utils/labeler.utils';
import { buildFeatures } from '../../shared/utils/features.utils';
import { applyPerSideCosts } from '../../shared/utils/cost.utils';
import {
  buildEquityCurve,
  maxDrawdown,
  sharpe,
  cagrFromEquity,
} from '../../shared/utils/metrics.utils';
import { BacktestsSettingsService } from '../../services/backtests-settings.service';
import { PredictorService } from '../../services/predictor.service';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';

type SortKey =
  | 'symbol'
  | 'trades'
  | 'winRate'
  | 'pnlPct'
  | 'cagr'
  | 'sharpe'
  | 'maxDd'
  | 'hitRate'
  | 'turnover';

@Component({
  selector: 'app-backtests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './backtests.html',
  styleUrls: ['./backtests.scss'],
})
export class BacktestsComponent {
  private readonly market = inject(MarketDataService);
  private readonly settings = inject(BacktestsSettingsService, { optional: true });
  private readonly predictor = inject(PredictorService);

  loading = signal(true);
  rows = signal<BacktestSummary[]>([]);
  trackBySymbol = (_: number, r: { symbol: string }) => r.symbol;

  // UI knobs
  entryBps = 5;
  exitBps = 3;
  longTh = 0.62;

  // Sweep chart config
  chartW = 720;
  chartH = 260;
  chartPad = 36;

  private _sweepRows = signal<
    Array<{ th: number; trades: number; winRate: number; pnlPct: number }>
  >([]);
  sweepRows = this._sweepRows.asReadonly();

  private defaultSymbols = TRADING_SYMBOLS;
  private symbols = [...this.defaultSymbols];

  private _metricsBySymbol = signal<Record<string, Metrics>>({});
  metricsBySymbol = this._metricsBySymbol.asReadonly();

  sortKey = signal<SortKey>('pnlPct');
  sortDir = signal<'asc' | 'desc'>('desc');

  // ---------- Lifecycle ----------
  async ngOnInit() {
    const s = this.settings?.load?.();
    if (s) {
      this.entryBps = s.entryBps ?? this.entryBps;
      this.exitBps = s.exitBps ?? this.exitBps;
      this.longTh = s.longTh ?? this.longTh;
      if (Array.isArray(s.symbols) && s.symbols.length) {
        // Always use the new symbols, ignore saved ones for now
        this.symbols = [...this.defaultSymbols];
      }
    }
    await this.recompute();
  }

  // ---------- Knobs ----------
  onKnobChange() {
    this.settings?.save?.({
      entryBps: this.entryBps,
      exitBps: this.exitBps,
      longTh: this.longTh,
      symbols: this.symbols,
    });
  }

  async resetBacktestSettings() {
    this.entryBps = 5;
    this.exitBps = 3;
    this.longTh = 0.62;
    this.symbols = [...TRADING_SYMBOLS];
    this.onKnobChange();
    await this.recompute();
  }

  // ---------- Sorting ----------
  sortedRows = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    const base = this.rows();
    const m = this.metricsBySymbol();

    const valueOf = (r: BacktestSummary): number | string => {
      switch (key) {
        case 'symbol':
          return r.symbol;
        case 'trades':
          return r.trades;
        case 'winRate':
          return r.winRate;
        case 'pnlPct':
          return r.pnlPct;
        case 'cagr':
          return m[r.symbol]?.cagr ?? Number.NEGATIVE_INFINITY;
        case 'sharpe':
          return m[r.symbol]?.sharpe ?? Number.NEGATIVE_INFINITY;
        case 'maxDd':
          return m[r.symbol]?.maxDd ?? Number.POSITIVE_INFINITY;
        case 'hitRate':
          return m[r.symbol]?.hitRate ?? Number.NEGATIVE_INFINITY;
        case 'turnover':
          return m[r.symbol]?.turnover ?? Number.NEGATIVE_INFINITY;
      }
    };

    const arr = [...base];
    arr.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        const cmp = String(av).localeCompare(String(bv));
        return dir === 'asc' ? cmp : -cmp;
      }
      const cmp = (av as number) - (bv as number);
      return dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  });

  setSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      const descByDefault: SortKey[] = [
        'trades',
        'winRate',
        'pnlPct',
        'cagr',
        'sharpe',
        'hitRate',
        'turnover',
      ];
      this.sortDir.set(descByDefault.includes(key) ? 'desc' : 'asc');
    }
  }

  // ---------- Recompute ----------
  async recompute() {
    this.loading.set(true);
    const results: BacktestSummary[] = [];
    const metricsMap: Record<string, Metrics> = {};

    for (const s of this.symbols) {
      const bars15 = await firstValueFrom(this.market.getBars15m(s, '5d'));
      if (bars15.length < 30) continue;

      const labeled = makeNext15mLabels(bars15);
      const builtFeats = buildFeatures(labeled, s);

      // Strip client-only field `mod` before sending to the API
      const feats: FeatureVector[] = builtFeats.map((f) => {
        const { mod, ...rest } = f.feats as any;
        return rest as FeatureVector;
      });

      // Run AI predictor
      const aiReq = { symbol: s, feats };
      const aiResult = await firstValueFrom(this.predictor.predict(aiReq));
      console.log('AI Prediction', s, aiResult);

      const { row, metrics } = runMlBacktest(
        s,
        bars15,
        labeled,
        feats,
        this.entryBps,
        this.exitBps,
        this.longTh,
      );

      results.push(row);
      metricsMap[s] = metrics;
    }

    this.rows.set(results);
    this._metricsBySymbol.set(metricsMap);
    this.loading.set(false);
  }

  // ---------- Sweep Chart ----------
  sweepChart = computed(() => {
    const data = this.sweepRows();
    const W = this.chartW;
    const H = this.chartH;
    const P = this.chartPad;

    if (!data.length) {
      return { winPath: '', pnlPath: '', points: [], xTicks: [], yTicksLeft: [], yTicksRight: [] };
    }

    const thMin = Math.min(...data.map((d) => d.th));
    const thMax = Math.max(...data.map((d) => d.th));
    const pnlMin = Math.min(...data.map((d) => d.pnlPct));
    const pnlMax = Math.max(...data.map((d) => d.pnlPct));
    const pnlRange = pnlMax - pnlMin || 1e-9;

    const x = (t: number) => P + ((t - thMin) / (thMax - thMin || 1e-9)) * (W - 2 * P);
    const yWin = (w: number) => H - P - w * (H - 2 * P);
    const yPnl = (p: number) => H - P - ((p - pnlMin) / pnlRange) * (H - 2 * P);

    const winPts = data.map((d) => `${x(d.th)},${yWin(d.winRate)}`).join(' ');
    const pnlPts = data.map((d) => `${x(d.th)},${yPnl(d.pnlPct)}`).join(' ');

    const xTicks = [];
    for (let t = thMin; t <= thMax + 1e-9; t += 0.04) {
      const tt = Number(t.toFixed(2));
      xTicks.push({ x: x(tt), label: tt.toFixed(2) });
    }

    const yTicksLeft = [];
    for (let w = 0; w <= 1 + 1e-9; w += 0.25) {
      yTicksLeft.push({ y: yWin(w), label: `${Math.round(w * 100)}%` });
    }

    const yTicksRight = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const p = pnlMin + (i / steps) * pnlRange;
      yTicksRight.push({ y: yPnl(p), label: `${(p * 100).toFixed(1)}%` });
    }

    const points = data.map((d) => ({
      x: x(d.th),
      yWin: yWin(d.winRate),
      yPnl: yPnl(d.pnlPct),
      th: d.th,
      win: d.winRate,
      pnl: d.pnlPct,
    }));

    return {
      winPath: `M ${winPts}`,
      pnlPath: `M ${pnlPts}`,
      points,
      xTicks,
      yTicksLeft,
      yTicksRight,
    };
  });

  sweepScale = computed(() => {
    const data = this.sweepRows();
    const W = this.chartW;
    const P = this.chartPad;
    const innerW = Math.max(1e-9, W - 2 * P);

    if (!data.length) {
      return {
        thToX: (_th: number) => P,
        xToTh: (_px: number) => this.longTh,
        domain: { thMin: this.longTh, thMax: this.longTh },
      };
    }

    const thMin = Math.min(...data.map((d) => d.th));
    const thMax = Math.max(...data.map((d) => d.th));
    const span = Math.max(1e-9, thMax - thMin);

    return {
      thToX: (th: number) => {
        const t = Math.min(1, Math.max(0, (th - thMin) / span));
        return P + t * innerW;
      },
      xToTh: (px: number) => {
        const t = Math.min(1, Math.max(0, (px - P) / innerW));
        return thMin + t * span;
      },
      domain: { thMin, thMax },
    };
  });

  async applyThreshold(th: number) {
    if (this.loading()) return;
    this.longTh = Number(th.toFixed(2));
    this.onKnobChange();
    await this.recompute();
  }

  async onSweepChartClick(evt: MouseEvent) {
    if (this.loading()) return;
    const rect = (evt.currentTarget as SVGElement).getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const newTh = this.sweepScale().xToTh(x);
    await this.applyThreshold(newTh);
  }

  async sweep() {
    this.loading.set(true);
    const out: Array<{ th: number; trades: number; winRate: number; pnlPct: number }> = [];

    const thresholds: number[] = [];
    for (let t = 0.54; t <= 0.7 + 1e-9; t += 0.02) thresholds.push(Number(t.toFixed(2)));

    const s = this.symbols[0];
    const bars15 = await firstValueFrom(this.market.getBars15m(s, '5d'));
    if (bars15.length >= 30) {
      const labeled = makeNext15mLabels(bars15);
      const feats = buildFeatures(labeled, s).map((f) => f.feats);
      for (const th of thresholds) {
        const { row } = runMlBacktest(s, bars15, labeled, feats, this.entryBps, this.exitBps, th);
        out.push({ th, trades: row.trades, winRate: row.winRate, pnlPct: row.pnlPct });
      }
    }

    this._sweepRows.set(out);
    this.onKnobChange();
    this.loading.set(false);
  }
}

/* ===========================
   Helpers
=========================== */

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function scoreFeatures(feats: Record<string, number>): number {
  const r1 = feats['r1'] ?? 0;
  const r5 = feats['r5'] ?? 0;
  const r15 = feats['r15'] ?? 0;
  const r60 = feats['r60'] ?? 0;
  const rsi14 = feats['rsi14'] ?? 50;
  const gap9 = feats['emaGap9'] ?? 0;
  const gap21 = feats['emaGap21'] ?? 0;
  const atr14 = feats['atr14'] ?? 0;
  const spy15 = feats['spy15m'] ?? 0;

  const x =
    0.8 * r5 +
    0.55 * r15 +
    0.25 * r60 +
    0.2 * spy15 +
    0.1 * ((rsi14 - 50) / 50) +
    0.08 * gap9 +
    0.04 * gap21 -
    0.02 * atr14 +
    0.15 * r1;

  return x;
}

function predictProb(fv: FeatureVector): number {
  return sigmoid(scoreFeatures(fv as any));
}

function runMlBacktest(
  symbol: string,
  bars15: Bar15m[],
  labeled: LabeledBar15m[],
  feats: FeatureVector[],
  entryBps: number,
  exitBps: number,
  longTh: number,
): { row: BacktestSummary; metrics: Metrics } {
  let trades = 0;
  let wins = 0;

  const stepReturns: number[] = [];
  const stepTs: string[] = [];

  const n = Math.min(labeled.length, feats.length);

  for (let i = 0; i < n; i++) {
    const p = predictProb(feats[i]);
    if (i + 1 >= bars15.length) break;

    if (p >= longTh) {
      const entry = bars15[i].c;
      const exit = bars15[i + 1].c;
      const gross = exit / entry - 1;
      const net = applyPerSideCosts(gross, entryBps, exitBps);

      if (net > 0) wins++;
      trades++;

      stepReturns.push(net);
      stepTs.push(bars15[i + 1].ts15);
    }
  }

  const curve = buildEquityCurve(stepTs, stepReturns, 1);
  const metrics: Metrics = {
    cagr: cagrFromEquity(curve),
    sharpe: sharpe(stepReturns),
    maxDd: maxDrawdown(curve.map((p) => p.equity)),
    hitRate: trades ? wins / trades : 0,
    turnover: trades / Math.max(stepReturns.length, 1),
  };

  const pnlPct = (curve.at(-1)?.equity ?? 1) - 1;
  const row: BacktestSummary = {
    symbol,
    trades,
    winRate: metrics.hitRate,
    pnlPct,
  };

  return { row, metrics };
}
