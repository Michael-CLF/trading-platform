// src/app/components/watchlist/watchlist.ts
import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import {
  Subscription,
  of,
  switchMap,
  interval,
  map,
  catchError,
  finalize,
  timeout,
  timer,
} from 'rxjs';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { MarketDataService } from '../../services/market-data.service';
import { PredictorService } from '../../services/predictor.service';
import { buildFeatures } from '../../shared/utils/features.utils';
import { makeNext15mLabels } from '../../shared/utils/labeler.utils';
import { firstValueFrom } from 'rxjs';
import { ReplacePipe } from '../../shared/pipes/replace.pipe';
import { PositionTrackerService } from '../../services/position-tracker.service';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { CommonModule } from '@angular/common';
import { TradeEntryModalComponent } from '../trade-entry-modal/trade-entry-modal';
import { ClosePositionModalComponent } from '../close-position-modal/close-position-modal';

interface WatchlistItem {
  symbol: string;
  signal: UnifiedSignal | null;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  loading: boolean;
  lastUpdate: Date;
}

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, ReplacePipe, TradeEntryModalComponent, ClosePositionModalComponent],
  templateUrl: './watchlist.html',
  styleUrls: ['./watchlist.scss'],
})
export class WatchlistComponent implements OnInit, OnDestroy {
  private strategy = inject(StrategyService);
  private market = inject(MarketDataService);
  private predictor = inject(PredictorService);
  private positionTracker = inject(PositionTrackerService);

  // Symbols to monitor
  private readonly SYMBOLS = TRADING_SYMBOLS; // Show all
  private atrPctBySymbol = new Map<string, number>();
  private readonly STRONG_CONF = 0.75;

  // Update every 15 minutes, offset by 30 seconds to ensure fresh bars
  private readonly UPDATE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly INITIAL_DELAY_MS = this.calculateInitialDelay();

  // State
  watchlistItems = signal<WatchlistItem[]>([]);
  isUpdating = signal(false);
  lastGlobalUpdate = signal<Date | null>(null);
  activePositions = signal<Set<string>>(new Set());
  // --- Trade entry modal state ---
  showTradeModal = signal(false);
  modalSymbol = signal<string | null>(null);

  // Open the modal with the selected symbol
  openRecordTrade(symbol: string) {
    this.modalSymbol.set(symbol);
    this.showTradeModal.set(true);
  }
  // --- Close position modal state ---
  showCloseModal = signal(false);
  closeSymbol = signal<string | null>(null);

  openClosePosition(symbol: string) {
    this.closeSymbol.set(symbol);
    this.showCloseModal.set(true);
  }

  cancelClosePosition() {
    this.showCloseModal.set(false);
  }

  saveClosePosition(exitPrice: number) {
    const sym = this.closeSymbol();
    if (!sym) return;
    this.positionTracker.closePosition(sym, exitPrice, 'manual');
    this.showCloseModal.set(false);
  }

  // Helper for template conditionals (keeps HTML clean)
  hasPosition(sym: string): boolean {
    return this.positionTracker.hasPosition(sym);
  }

  // Handle save from the modal → create a position with your *actual* fill
  async onRecordTrade(evt: { symbol: string; quantity: number; price: number }) {
    const { symbol, quantity, price } = evt;

    // Use your existing tracker to create/open a position
    this.positionTracker.openPosition({
      symbol,
      entryPrice: price,
      entryTime: new Date(),
      quantity,
      side: 'long',
    });

    // Fetch one fresh quote so P/L is visible immediately
    try {
      const q = await firstValueFrom(this.market.getQuote(symbol));
      this.positionTracker.updatePositionPrice(symbol, q.price);
    } catch {}

    // Close modal
    this.showTradeModal.set(false);
  }

  private updateSub?: Subscription;
  private signalSub?: Subscription;
  private positionsSub?: Subscription;

  private confidenceOf(s?: UnifiedSignal | null): number {
    return s?.confidence ?? (s as any)?.strength ?? (s as any)?.score ?? 0;
  }

  // Computed values
  buySignals = computed(
    () =>
      this.watchlistItems().filter(
        (i) => i.signal?.action === 'strong_buy' || i.signal?.action === 'buy',
      ).length,
  );

  sellSignals = computed(
    () =>
      this.watchlistItems().filter(
        (i) => i.signal?.action === 'strong_sell' || i.signal?.action === 'sell',
      ).length,
  );

  strongCount = computed(
    () =>
      this.watchlistItems().filter((item) => {
        const a = item.signal?.action;
        const c = this.confidenceOf(item.signal);
        return (
          c >= this.STRONG_CONF &&
          (a === 'buy' || a === 'sell' || a === 'strong_buy' || a === 'strong_sell')
        );
      }).length,
  );

  ngOnInit(): void {
    // Initialize watchlist items
    const initialItems = this.SYMBOLS.map((symbol) => ({
      symbol,
      signal: null,
      price: 0,
      priceChange: 0,
      priceChangePercent: 0,
      loading: true,
      lastUpdate: new Date(),
    }));
    this.watchlistItems.set(initialItems);
    for (const s of this.SYMBOLS) {
      this.loadAtrPct(s);
    }
    // Subscribe to unified signals
    this.signalSub = this.strategy.getAllUnifiedSignals().subscribe((signals) => {
      this.updateSignalsInWatchlist(signals);
    });

    // Initial update
    this.updateAllSymbols();

    // Schedule updates aligned to 15-minute intervals
    this.updateSub = timer(this.INITIAL_DELAY_MS, this.UPDATE_INTERVAL_MS).subscribe(() =>
      this.updateAllSymbols(),
    );

    this.positionsSub = this.positionTracker.getActivePositions().subscribe((positions) => {
      const symbols = new Set(Array.from(positions.keys()));
      this.activePositions.set(symbols);
    });
  }

  ngOnDestroy(): void {
    this.updateSub?.unsubscribe();
    this.signalSub?.unsubscribe();
    this.positionsSub?.unsubscribe();
  }

  /**
   * Calculate delay to next 15-minute mark + 30 seconds
   */
  private calculateInitialDelay(): number {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();

    // Find next 15-minute mark
    const minutesToNext15 = 15 - (minutes % 15);
    const delayMinutes = minutesToNext15 === 15 ? 0 : minutesToNext15;

    // Add 30 seconds offset for data availability
    const totalMs = (delayMinutes * 60 + 30 - seconds) * 1000 - milliseconds;

    const periodMs = 15 * 60 * 1000;
    return totalMs > 0 ? totalMs : totalMs + periodMs; // roll to the next 15-min slot + 30s
  }
  /** Load a lightweight ATR% from 5d of 15m bars; caches into atrPctBySymbol */
  private loadAtrPct(symbol: string): void {
    // Avoid reloading if we already have it
    if (this.atrPctBySymbol.has(symbol)) return;

    this.market
      .getBars15m(symbol, '5d')
      .pipe(
        timeout(8000),
        map((bars: any[]) => {
          if (!Array.isArray(bars) || bars.length < 15) return null;

          // Simple ATR(14) approximation on 15m bars
          // trueRange = max(high-low, abs(high-prevClose), abs(low-prevClose))
          let prevClose = bars[0].c ?? bars[0].close;
          const trs: number[] = [];
          for (let i = 1; i < bars.length; i++) {
            const b = bars[i];
            const high = b.h ?? b.high;
            const low = b.l ?? b.low;
            const close = b.c ?? b.close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trs.push(tr);
            prevClose = close;
          }
          if (!trs.length) return null;

          // ATR ~ EMA; use simple mean for robustness
          const atr = trs.slice(-14).reduce((a, x) => a + x, 0) / Math.min(14, trs.length);

          // Convert to percentage of last close
          const lastClose = prevClose;
          if (!lastClose || !isFinite(atr) || atr <= 0) return null;

          const atrPct = atr / lastClose; // e.g., 0.018 => 1.8%
          return Math.max(0.0025, Math.min(0.08, atrPct)); // clamp ~0.25%..8%
        }),
        catchError(() => of(null)),
        finalize(() => void 0),
      )
      .subscribe((pct) => {
        if (pct != null) this.atrPctBySymbol.set(symbol, pct);
      });
  }

  /**
   * Update all symbols with fresh data
   */
  private async updateAllSymbols(): Promise<void> {
    this.isUpdating.set(true);
    console.log('Updating watchlist at', new Date().toLocaleTimeString());

    // Run symbol updates in parallel instead of sequentially
    await Promise.all(this.SYMBOLS.map((s) => this.updateSymbol(s)));

    this.lastGlobalUpdate.set(new Date());
    this.isUpdating.set(false);
  }

  /**
   * Update individual symbol
   */
  private async updateSymbol(symbol: string): Promise<void> {
    try {
      // Update item loading state
      this.updateItemLoading(symbol, true);

      // Fetch 15m bars
      const bars = await firstValueFrom(this.market.getBars15m(symbol, '5d'));

      if (!bars || bars.length < 30) {
        console.warn(`Insufficient data for ${symbol}`);
        this.updateItemLoading(symbol, false);
        return;
      }

      // Calculate current price and change
      const currentPrice = bars[bars.length - 1].c;
      const previousClose = bars[bars.length - 2].c;
      const priceChange = currentPrice - previousClose;
      const priceChangePercent = (priceChange / previousClose) * 100;

      // Calculate technical indicators (SMA crossover)
      const closes = bars.map((b) => b.c);
      const smaSignal = this.calculateSMASignal(symbol, closes);
      if (smaSignal) {
        this.strategy.updateTechnicalIndicator(
          symbol,
          'sma_cross',
          smaSignal.signal,
          smaSignal.strength,
        );
      }

      // Build features and get ML prediction
      const labeled = makeNext15mLabels(bars);
      const built = buildFeatures(labeled, symbol);
      const feats = built.slice(-2).map((f) => f.feats);

      if (feats.length > 0) {
        const response = await firstValueFrom(this.predictor.predict({ symbol, feats }));

        if (response?.probs?.length > 0) {
          const probability = response.probs[response.probs.length - 1];
          this.strategy.updateMLPrediction(symbol, probability, 0.6);
        }
      }

      // Update watchlist item
      this.updateWatchlistItem(symbol, {
        price: currentPrice,
        priceChange,
        priceChangePercent,
        loading: false,
        lastUpdate: new Date(),
      });
    } catch (error) {
      console.error(`Error updating ${symbol}:`, error);
      this.updateItemLoading(symbol, false);
    }
  }
  private computeEvPct(symbol: string, confidence: number | undefined): number | null {
    if (confidence == null) return null;
    const atrPct = this.atrPctBySymbol.get(symbol) ?? 0.02; // ~2% fallback if not loaded
    const avgGain = 1.2 * atrPct; // assume winners stretch a bit above ATR
    const avgLoss = 0.8 * atrPct; // assume losers cut a bit sooner than ATR
    const p = Math.min(Math.max(confidence, 0), 1);
    return p * avgGain - (1 - p) * avgLoss; // could be negative
  }

  /** EV in dollars for a given stake (default $50) */
  public expectedValueUSD(item: WatchlistItem, stake = 50): number | null {
    const evPct = this.computeEvPct(
      item.symbol,
      item.signal?.confidence ?? (item.signal as any)?.strength ?? (item.signal as any)?.score,
    );
    return evPct == null ? null : stake * evPct;
  }
  /**
   * Calculate SMA signal for technical analysis
   */
  private calculateSMASignal(
    symbol: string,
    closes: number[],
  ): { signal: 'buy' | 'sell' | 'neutral'; strength: number } | null {
    const fast = 5;
    const slow = 20;
    const lastIndex = closes.length - 1;

    const sma = (period: number, index: number): number => {
      if (index + 1 < period) return NaN;
      let sum = 0;
      for (let i = index - period + 1; i <= index; i++) {
        sum += closes[i];
      }
      return sum / period;
    };

    const sma5Now = sma(fast, lastIndex);
    const sma20Now = sma(slow, lastIndex);
    const sma5Prev = sma(fast, lastIndex - 1);
    const sma20Prev = sma(slow, lastIndex - 1);

    if (!isFinite(sma5Now) || !isFinite(sma20Now) || !isFinite(sma5Prev) || !isFinite(sma20Prev)) {
      return null;
    }

    // Bullish crossover
    if (sma5Prev <= sma20Prev && sma5Now > sma20Now) {
      const strength = Math.min(0.9, 0.6 + ((sma5Now - sma20Now) / sma20Now) * 10);
      return { signal: 'buy', strength };
    }
    // Bearish crossover
    if (sma5Prev >= sma20Prev && sma5Now < sma20Now) {
      const strength = Math.min(0.9, 0.6 + ((sma20Now - sma5Now) / sma20Now) * 10);
      return { signal: 'sell', strength };
    }

    return { signal: 'neutral', strength: 0.3 };
  }

  /**
   * Update signals in watchlist from strategy service
   */
  private updateSignalsInWatchlist(signals: UnifiedSignal[]): void {
    const items = this.watchlistItems();
    const signalMap = new Map(signals.map((s) => [s.symbol, s]));

    const updated = items.map((item) => ({
      ...item,
      signal: signalMap.get(item.symbol) || item.signal,
    }));

    this.watchlistItems.set(updated);
  }

  /**
   * Update individual watchlist item
   */
  private updateWatchlistItem(symbol: string, updates: Partial<WatchlistItem>): void {
    this.watchlistItems.update((items) =>
      items.map((item) => (item.symbol === symbol ? { ...item, ...updates } : item)),
    );
  }
  /**
   * Update loading state for symbol
   */
  private updateItemLoading(symbol: string, loading: boolean): void {
    this.updateWatchlistItem(symbol, { loading });
  }

  togglePosition(symbol: string): void {
    const hasPosition = this.positionTracker.hasPosition(symbol);

    if (hasPosition) {
      // Close position
      const currentPrice = this.watchlistItems().find((item) => item.symbol === symbol)?.price || 0;
      this.positionTracker.closePosition(symbol, currentPrice, 'manual');
    } else {
      // Open position
      const item = this.watchlistItems().find((i) => i.symbol === symbol);
      if (
        item &&
        item.signal &&
        (item.signal.action === 'buy' || item.signal.action === 'strong_buy')
      ) {
        this.positionTracker.openPosition({
          symbol,
          entryPrice: item.price,
          entryTime: new Date(),
          quantity: 100, // Default 100 shares
          side: 'long',
          stopLoss: item.price * 0.98, // 2% stop loss
          takeProfit: item.price * 1.03, // 3% take profit
        });
      }
    }

    this.strategy.setPositionStatus(symbol, !hasPosition);
  }

  getTileClass(item: WatchlistItem): string {
    const action = item.signal?.action;
    const conf = this.confidenceOf(item.signal);

    // upgrade to strong if confidence >= threshold
    if ((action === 'buy' || action === 'strong_buy') && conf >= this.STRONG_CONF)
      return 'strong-buy';
    if ((action === 'sell' || action === 'strong_sell') && conf >= this.STRONG_CONF)
      return 'strong-sell';

    switch (action) {
      case 'strong_buy':
        return 'strong-buy';
      case 'buy':
        return 'buy';
      case 'strong_sell':
        return 'strong-sell';
      case 'sell':
        return 'sell';
      default:
        return 'hold';
    }
  }

  /**
   * Format confidence as percentage
   */
  formatConfidence(confidence: number | undefined): string {
    if (!confidence) return '0%';
    return `${Math.round(confidence * 100)}%`;
  }
}
