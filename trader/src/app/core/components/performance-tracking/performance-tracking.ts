import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subscription, timer, of, firstValueFrom } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import {
  PositionTrackerService,
  Position,
  PerformanceMetrics,
} from '../../services/position-tracker.service';
import { MarketDataService } from '../../services/market-data.service';
import { TradeEntryModalComponent } from '../../components/trade-entry-modal/trade-entry-modal';
import { ClosePositionModalComponent } from '../close-position-modal/close-position-modal';
import { EditRiskModalComponent } from '../edit-risk-modal/edit-risk-modal';

@Component({
  selector: 'app-performance-tracking',
  standalone: true,
  imports: [
    CommonModule,
    TradeEntryModalComponent,
    ClosePositionModalComponent,
    EditRiskModalComponent,
  ],
  templateUrl: './performance-tracking.html',
  styleUrl: './performance-tracking.scss',
})
export class PerformanceTrackingComponent implements OnDestroy {
  /** Modal state */
  showTradeModal = false;
  modalSymbol: string | null = null;
  // Close position modal
  showCloseModal = false;
  closeSymbol: string | null = null;

  // Edit risk modal (SL/TP)
  showRiskModal = false;
  riskSymbol: string | null = null;
  riskStopLoss?: number | null = null;
  riskTakeProfit?: number | null = null;

  openCloseModal(symbol: string) {
    this.closeSymbol = symbol;
    this.showCloseModal = true;
  }
  cancelCloseModal() {
    this.showCloseModal = false;
  }
  saveCloseModal(exitPrice: number) {
    if (!this.closeSymbol) return;
    this.positionTracker.closePosition(this.closeSymbol, exitPrice, 'manual');
    this.showCloseModal = false;
  }

  openRiskModal(p: { symbol: string; stopLoss?: number; takeProfit?: number }) {
    this.riskSymbol = p.symbol;
    this.riskStopLoss = p.stopLoss ?? null;
    this.riskTakeProfit = p.takeProfit ?? null;
    this.showRiskModal = true;
  }
  cancelRiskModal() {
    this.showRiskModal = false;
  }
  saveRiskModal(evt: { stopLoss?: number; takeProfit?: number }) {
    if (!this.riskSymbol) return;

    if (evt.stopLoss === undefined) {
      this.positionTracker.clearStopLoss(this.riskSymbol);
    } else {
      this.positionTracker.setStopLoss(this.riskSymbol, evt.stopLoss);
    }

    if (evt.takeProfit === undefined) {
      this.positionTracker.clearTakeProfit(this.riskSymbol);
    } else {
      this.positionTracker.setTakeProfit(this.riskSymbol, evt.takeProfit);
    }

    this.showRiskModal = false;
  }

  /** Active positions stream (array for *ngFor) */
  positions$!: Observable<Position[]>;
  /** Realized-performance metrics stream */
  metrics$!: Observable<PerformanceMetrics>;

  /** 15-minute price refresh subscription */
  private refreshSub?: Subscription;

  constructor(
    private positionTracker: PositionTrackerService,
    private marketData: MarketDataService,
  ) {
    // Metrics stream (realized performance)
    this.metrics$ = this.positionTracker.getPerformanceMetrics();

    // Initialize positions$ AFTER DI is available
    this.positions$ = this.positionTracker
      .getActivePositions()
      .pipe(map((mapObj) => Array.from(mapObj.values())));

    // Start a 15-minute refresh loop (immediate first tick)
    this.refreshSub = timer(0, 15 * 60 * 1000)
      .pipe(
        switchMap(() =>
          this.positionTracker.getActivePositions().pipe(map((m) => Array.from(m.keys()))),
        ),
        switchMap((symbols) =>
          symbols.length ? this.marketData.getMultipleQuotes(symbols) : of([]),
        ),
      )
      .subscribe((quotes) => {
        for (const q of quotes) {
          this.positionTracker.updatePositionPrice(q.symbol, q.price);
        }
      });
  }

  ngOnDestroy(): void {
    this.refreshSub?.unsubscribe();
  }

  /** UI actions */
  openManualTrade(symbol?: string) {
    this.modalSymbol = symbol ?? null;
    this.showTradeModal = true;
  }

  cancelManualTrade() {
    this.showTradeModal = false;
  }

  async saveManualTrade(evt: { symbol: string; quantity: number; price: number }) {
    const { symbol, quantity, price } = evt;

    // Create/open the position with the actual fill
    this.positionTracker.openPosition({
      symbol,
      entryPrice: price,
      entryTime: new Date(),
      quantity,
      side: 'long',
    });

    // Immediate quote so P/L is visible right away
    try {
      const q = await firstValueFrom(this.marketData.getQuote(symbol));
      this.positionTracker.updatePositionPrice(symbol, q.price);
    } catch {
      // ignore transient quote error; 15-minute loop will refresh later
    }

    this.showTradeModal = false;
  }

  /** Manual refresh button */
  async refreshNow() {
    const mapObj = await firstValueFrom(this.positionTracker.getActivePositions());
    const symbols = Array.from(mapObj.keys());
    if (!symbols.length) return;

    try {
      const quotes = await firstValueFrom(this.marketData.getMultipleQuotes(symbols));
      for (const q of quotes) {
        this.positionTracker.updatePositionPrice(q.symbol, q.price);
      }
    } catch {
      // ignore transient errors
    }
  }

  clearAll() {
    this.positionTracker.clearAllData();
  }
}
