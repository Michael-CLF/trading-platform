import { Component, Input, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Subscription,
  of,
  switchMap,
  interval,
  map,
  catchError,
  timeout,
  finalize,
  distinctUntilChanged,
} from 'rxjs';
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

  /** Trading threshold used for suggestion line (0..1) */
  @Input() threshold = 0.6;

  /** Polling frequency (ms) */
  @Input() refreshMs = 5000;

  // ---- reactive state ----
  loading = signal(true);
  lastProb = signal<number | null>(null);
  lastUpdated = signal<Date | null>(null);
  errorMsg = signal<string | null>(null);
  unifiedSignal = signal<any>(null);

  // Use the actual input threshold for BUY/SELL edges (symmetric around 0.5)
  private get buyEdge() {
    return this.threshold;
  }
  private get sellEdge() {
    return 1 - this.threshold;
  }

  suggestion = computed(() => {
    const p = this.lastProb();
    if (p == null) return '-';
    if (p >= this.buyEdge) return 'BUY';
    if (p <= this.sellEdge) return 'SELL';
    return 'HOLD';
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

    // Subscribe to unified signals for this symbol
    this.strategySub = this.strategy.getUnifiedSignal(this.symbol).subscribe((sig) => {
      if (sig) {
        this.unifiedSignal.set(sig);
        // Optionally you can surface sig.confidence here later
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

    return this.market.getBars15m(this.symbol, '5d').pipe(
      timeout(8000), // don't hang the UI if the API stalls
      switchMap((bars) => {
        if (!bars?.length) return of(null);

        const labeled = makeNext15mLabels(bars);
        const built = buildFeatures(labeled, this.symbol);

        // Use the last 1–2 feature rows (most recent points)
        const feats: FeatureVector[] = built.slice(-2).map((f) => f.feats);
        if (!feats.length) return of(null);

        return this.predictor.predict({ symbol: this.symbol, feats }).pipe(
          // if predictor is slow/hangs, stop spinner and fall back
          timeout(8000),
          catchError(() => of(null)),
        );
      }),
      map((resp) => {
        if (!resp) return;

        const probs = Array.isArray(resp.probs) ? resp.probs : [];
        const last = probs.at(-1) ?? null;

        // Avoid noisy flicker/logs on duplicate values
        if (last !== this.lastProb()) {
          this.lastProb.set(last);
          this.lastUpdated.set(new Date());

          // Feed ML prediction to strategy service for unified signal calc
          if (last !== null) {
            this.strategy.updateMLPrediction(this.symbol, last, this.threshold);
          }
        }
      }),
      catchError((err) => {
        this.errorMsg.set(err?.message ?? 'Prediction failed');
        return of(null);
      }),
      // ✅ always stop the spinner (success, empty, or error)
      finalize(() => this.loading.set(false)),
    );
  }
}
