import { Component, Input, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, of, switchMap, interval, map, catchError } from 'rxjs';
import { FeatureVector } from '../../shared/models/feature-vector.model';
import { PredictorService } from '../../services/predictor.service';
import { MarketDataService } from '../../services/market-data.service';
import { makeNext15mLabels } from '../../shared/utils/labeler.utils';
import { buildFeatures } from '../../shared/utils/features.utils';
import { StrategyService } from '../../services/strategy.service';

@Component({
  selector: 'app-tracker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tracker.html',
  styleUrls: ['./tracker.scss'],
})
export class Tracker implements OnInit, OnDestroy {
  /** Ticker to monitor (can be bound from parent) */
  @Input() symbol = 'AAPL';

  /** Trading threshold used for suggestion line */
  @Input() threshold = 0.62;

  /** Polling frequency (ms) */
  @Input() refreshMs = 5000;

  // ---- reactive state ----
  loading = signal(true);
  lastProb = signal<number | null>(null);
  lastUpdated = signal<Date | null>(null);
  errorMsg = signal<string | null>(null);
  unifiedSignal = signal<any>(null);

  suggestion = computed(() => {
    const p = this.lastProb();
    if (p == null) return '-';
    return p >= this.threshold ? 'BUY' : 'HOLD/SELL';
  });

  private sub?: Subscription;
  private strategySub?: Subscription;

  constructor(
    private predictor: PredictorService,
    private market: MarketDataService,
    private strategy: StrategyService,
  ) {}

  ngOnInit(): void {
    // Run immediately, then poll
    this.fetchOnce().subscribe();
    this.sub = interval(this.refreshMs)
      .pipe(switchMap(() => this.fetchOnce()))
      .subscribe();

    // Subscribe to unified signals
    this.strategySub = this.strategy.getUnifiedSignal(this.symbol).subscribe((signal) => {
      if (signal) {
        this.unifiedSignal.set(signal);
        console.log('Unified signal:', signal);
      }
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.strategySub?.unsubscribe();
  }

  private fetchOnce() {
    this.loading.set(true);
    this.errorMsg.set(null);

    // Use same 15m bars + feature builder as elsewhere
    return this.market.getBars15m(this.symbol, '5d').pipe(
      switchMap((bars) => {
        if (!bars?.length) return of(null);

        const labeled = makeNext15mLabels(bars);
        const built = buildFeatures(labeled, this.symbol);

        // Send last 1–2 feature rows (most recent points)
        const feats: FeatureVector[] = built.slice(-2).map((f) => f.feats);
        if (!feats.length) return of(null);

        return this.predictor.predict({ symbol: this.symbol, feats });
      }),
      map((resp) => {
        if (!resp) return;
        const probs = resp.probs ?? [];
        const last = probs.at(-1) ?? null;

        this.lastProb.set(last);
        this.lastUpdated.set(new Date());
        this.loading.set(false);

        // Send ML prediction to strategy service
        if (last !== null) {
          this.strategy.updateMLPrediction(this.symbol, last, this.threshold);
        }
      }),
      catchError((err) => {
        this.errorMsg.set(err?.message ?? 'Prediction failed');
        this.loading.set(false);
        return of(null);
      }),
    );
  }
}
