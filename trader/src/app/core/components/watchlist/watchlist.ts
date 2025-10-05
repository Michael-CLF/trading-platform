// src/app/components/watchlist/watchlist.ts
import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval, timer } from 'rxjs';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { MarketDataService } from '../../services/market-data.service';
import { PredictorService } from '../../services/predictor.service';
import { buildFeatures } from '../../shared/utils/features.utils';
import { makeNext15mLabels } from '../../shared/utils/labeler.utils';
import { firstValueFrom } from 'rxjs';
import { ReplacePipe } from '../../shared/pipes/replace.pipe';
import { PositionTrackerService } from '../../services/position-tracker.service';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';

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
  imports: [CommonModule, ReplacePipe],
  templateUrl: './watchlist.html',
  styleUrls: ['./watchlist.scss'],
})
export class WatchlistComponent implements OnInit, OnDestroy {
  private strategy = inject(StrategyService);
  private market = inject(MarketDataService);
  private predictor = inject(PredictorService);
  private positionTracker = inject(PositionTrackerService);

  // Symbols to monitor
  private readonly SYMBOLS = TRADING_SYMBOLS.slice(0, 8); // Show first 8 in watchlist

  // Update every 15 minutes, offset by 30 seconds to ensure fresh bars
  private readonly UPDATE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly INITIAL_DELAY_MS = this.calculateInitialDelay();

  // State
  watchlistItems = signal<WatchlistItem[]>([]);
  isUpdating = signal(false);
  lastGlobalUpdate = signal<Date | null>(null);
  activePositions = signal<Set<string>>(new Set());

  private updateSub?: Subscription;
  private signalSub?: Subscription;

  // Computed values
  buySignals = computed(() =>
    this.watchlistItems().filter(
      (item) => item.signal?.action === 'strong_buy' || item.signal?.action === 'buy',
    ),
  );

  sellSignals = computed(() =>
    this.watchlistItems().filter(
      (item) => item.signal?.action === 'strong_sell' || item.signal?.action === 'sell',
    ),
  );

  strongSignals = computed(() =>
    this.watchlistItems()
      .filter((item) => item.signal && item.signal.confidence > 0.75)
      .sort((a, b) => (b.signal?.confidence || 0) - (a.signal?.confidence || 0)),
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

    // Subscribe to active positions
    this.positionTracker.getActivePositions().subscribe((positions) => {
      const symbols = new Set(Array.from(positions.keys()));
      this.activePositions.set(symbols);
    });

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
  }

  ngOnDestroy(): void {
    this.updateSub?.unsubscribe();
    this.signalSub?.unsubscribe();
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

    return totalMs > 0 ? totalMs : 30000; // Minimum 30 seconds
  }

  /**
   * Update all symbols with fresh data
   */
  private async updateAllSymbols(): Promise<void> {
    this.isUpdating.set(true);
    console.log('Updating watchlist at', new Date().toLocaleTimeString());

    for (const symbol of this.SYMBOLS) {
      await this.updateSymbol(symbol);
    }

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
          this.strategy.updateMLPrediction(symbol, probability);
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
    const items = this.watchlistItems();
    const updated = items.map((item) => (item.symbol === symbol ? { ...item, ...updates } : item));
    this.watchlistItems.set(updated);
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

  /**
   * Get CSS class for action type
   */
  getActionClass(action: string | undefined): string {
    if (!action) return '';

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
