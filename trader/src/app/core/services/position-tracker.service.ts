// src/app/services/position-tracker.service.ts
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Position {
  symbol: string;
  entryPrice: number;
  entryTime: Date;
  quantity: number;
  side: 'long' | 'short';
  stopLoss?: number;
  takeProfit?: number;
  currentPrice?: number;
  unrealizedPnL?: number;
  unrealizedPnLPercent?: number;
}

export interface ClosedPosition extends Position {
  exitPrice: number;
  exitTime: Date;
  realizedPnL: number;
  realizedPnLPercent: number;
  holdingPeriod: number; // in minutes
  exitReason: 'stop_loss' | 'take_profit' | 'signal' | 'manual';
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
  totalPnL: number;
  sharpeRatio: number;
  maxDrawdown: number;
  bestTrade: ClosedPosition | null;
  worstTrade: ClosedPosition | null;
}

@Injectable({ providedIn: 'root' })
export class PositionTrackerService {
  private readonly STORAGE_KEY = 'trading_positions';
  private readonly HISTORY_KEY = 'trading_history';
  private readonly METRICS_KEY = 'performance_metrics';

  private activePositions = new BehaviorSubject<Map<string, Position>>(new Map());
  private positionHistory = new BehaviorSubject<ClosedPosition[]>([]);
  private performanceMetrics = new BehaviorSubject<PerformanceMetrics>(this.getEmptyMetrics());

  constructor() {
    this.loadFromStorage();
    this.startAutoSave();
  }

  // Position Management
  openPosition(position: Omit<Position, 'unrealizedPnL' | 'unrealizedPnLPercent'>): void {
    const positions = this.activePositions.value;
    const fullPosition: Position = {
      ...position,
      entryTime: new Date(position.entryTime),
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,
    };

    positions.set(position.symbol, fullPosition);
    this.activePositions.next(positions);
    this.saveToStorage();

    console.log(`Position opened: ${position.symbol} at ${position.entryPrice}`);
  }

  closePosition(
    symbol: string,
    exitPrice: number,
    exitReason: ClosedPosition['exitReason'] = 'manual',
  ): void {
    const positions = this.activePositions.value;
    const position = positions.get(symbol);

    if (!position) {
      console.warn(`No position found for ${symbol}`);
      return;
    }

    const exitTime = new Date();
    const realizedPnL = (exitPrice - position.entryPrice) * position.quantity;
    const realizedPnLPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdingPeriod = Math.floor((exitTime.getTime() - position.entryTime.getTime()) / 60000);

    const closedPosition: ClosedPosition = {
      ...position,
      exitPrice,
      exitTime,
      realizedPnL,
      realizedPnLPercent,
      holdingPeriod,
      exitReason,
    };

    // Remove from active
    positions.delete(symbol);
    this.activePositions.next(positions);

    // Add to history
    const history = this.positionHistory.value;
    history.push(closedPosition);
    this.positionHistory.next(history);

    // Update metrics
    this.updateMetrics();
    this.saveToStorage();

    console.log(`Position closed: ${symbol} at ${exitPrice}, PnL: ${realizedPnL.toFixed(2)}`);
  }

  updatePositionPrice(symbol: string, currentPrice: number): void {
    const positions = this.activePositions.value;
    const position = positions.get(symbol);

    if (!position) return;

    const unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
    const unrealizedPnLPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    position.currentPrice = currentPrice;
    position.unrealizedPnL = unrealizedPnL;
    position.unrealizedPnLPercent = unrealizedPnLPercent;

    // Check stop loss
    if (position.stopLoss && currentPrice <= position.stopLoss) {
      this.closePosition(symbol, currentPrice, 'stop_loss');
      return;
    }

    // Check take profit
    if (position.takeProfit && currentPrice >= position.takeProfit) {
      this.closePosition(symbol, currentPrice, 'take_profit');
      return;
    }

    positions.set(symbol, position);
    this.activePositions.next(positions);
  }

  setStopLoss(symbol: string, stopLoss: number): void {
    const positions = this.activePositions.value;
    const position = positions.get(symbol);

    if (position) {
      position.stopLoss = stopLoss;
      positions.set(symbol, position);
      this.activePositions.next(positions);
      this.saveToStorage();
    }
  }

  setTakeProfit(symbol: string, takeProfit: number): void {
    const positions = this.activePositions.value;
    const position = positions.get(symbol);

    if (position) {
      position.takeProfit = takeProfit;
      positions.set(symbol, position);
      this.activePositions.next(positions);
      this.saveToStorage();
    }
  }

  // Observables
  getActivePositions(): Observable<Map<string, Position>> {
    return this.activePositions.asObservable();
  }

  getPositionHistory(): Observable<ClosedPosition[]> {
    return this.positionHistory.asObservable();
  }

  getPerformanceMetrics(): Observable<PerformanceMetrics> {
    return this.performanceMetrics.asObservable();
  }

  hasPosition(symbol: string): boolean {
    return this.activePositions.value.has(symbol);
  }

  // Performance Metrics
  private updateMetrics(): void {
    const history = this.positionHistory.value;

    if (history.length === 0) {
      this.performanceMetrics.next(this.getEmptyMetrics());
      return;
    }

    const winningTrades = history.filter((p) => p.realizedPnL > 0);
    const losingTrades = history.filter((p) => p.realizedPnL < 0);

    const totalPnL = history.reduce((sum, p) => sum + p.realizedPnL, 0);
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, p) => sum + p.realizedPnL, 0) / winningTrades.length
        : 0;
    const avgLoss =
      losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, p) => sum + p.realizedPnL, 0) / losingTrades.length)
        : 0;

    const profitFactor = avgLoss !== 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumPnL = 0;

    for (const trade of history) {
      cumPnL += trade.realizedPnL;
      peak = Math.max(peak, cumPnL);
      const drawdown = peak - cumPnL;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    // Find best and worst trades
    const sortedByPnL = [...history].sort((a, b) => b.realizedPnL - a.realizedPnL);

    const metrics: PerformanceMetrics = {
      totalTrades: history.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: history.length > 0 ? (winningTrades.length / history.length) * 100 : 0,
      averageWin: avgWin,
      averageLoss: avgLoss,
      profitFactor,
      totalPnL,
      sharpeRatio: this.calculateSharpeRatio(history),
      maxDrawdown,
      bestTrade: sortedByPnL[0] || null,
      worstTrade: sortedByPnL[sortedByPnL.length - 1] || null,
    };

    this.performanceMetrics.next(metrics);
  }

  private calculateSharpeRatio(history: ClosedPosition[]): number {
    if (history.length < 2) return 0;

    const returns = history.map((p) => p.realizedPnLPercent);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev !== 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
  }

  private getEmptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      averageWin: 0,
      averageLoss: 0,
      profitFactor: 0,
      totalPnL: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }

  // Storage Management
  private saveToStorage(): void {
    try {
      // Save active positions
      const positionsArray = Array.from(this.activePositions.value.entries());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(positionsArray));

      // Save history
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.positionHistory.value));

      // Save metrics
      localStorage.setItem(this.METRICS_KEY, JSON.stringify(this.performanceMetrics.value));
    } catch (error) {
      console.error('Failed to save positions to storage:', error);
    }
  }

  private loadFromStorage(): void {
    try {
      // Load active positions
      const positionsData = localStorage.getItem(this.STORAGE_KEY);
      if (positionsData) {
        const positionsArray = JSON.parse(positionsData);
        const positionsMap = new Map<string, Position>(
          positionsArray.map(([key, value]: [string, any]) => [
            key,
            { ...value, entryTime: new Date(value.entryTime) },
          ]),
        );
        this.activePositions.next(positionsMap);
      }

      // Load history
      const historyData = localStorage.getItem(this.HISTORY_KEY);
      if (historyData) {
        const history = JSON.parse(historyData).map((p: any) => ({
          ...p,
          entryTime: new Date(p.entryTime),
          exitTime: new Date(p.exitTime),
        }));
        this.positionHistory.next(history);
      }

      // Load metrics
      const metricsData = localStorage.getItem(this.METRICS_KEY);
      if (metricsData) {
        this.performanceMetrics.next(JSON.parse(metricsData));
      }
    } catch (error) {
      console.error('Failed to load positions from storage:', error);
    }
  }

  private startAutoSave(): void {
    // Auto-save every 30 seconds
    setInterval(() => this.saveToStorage(), 30000);
  }

  // Clear all data
  clearAllData(): void {
    if (confirm('Are you sure you want to clear all position data and history?')) {
      this.activePositions.next(new Map());
      this.positionHistory.next([]);
      this.performanceMetrics.next(this.getEmptyMetrics());
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem(this.HISTORY_KEY);
      localStorage.removeItem(this.METRICS_KEY);
      console.log('All position data cleared');
    }
  }
}
