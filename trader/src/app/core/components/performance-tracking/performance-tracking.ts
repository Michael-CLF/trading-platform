// src/app/components/performance-dashboard/performance-dashboard.ts
import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PositionTrackerService,
  Position,
  ClosedPosition,
  PerformanceMetrics,
} from '../../services/position-tracker.service';
import { AlertSystemService, Alert } from '../../services/alert-system.service';

@Component({
  selector: 'app-performance-tracking',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './performance-tracking.html',
  styleUrls: ['./performance-tracking.scss'],
})
export class PerformanceTrackingComponent implements OnInit {
  private positionTracker = inject(PositionTrackerService);
  private alertSystem = inject(AlertSystemService);

  // State
  activePositions = signal<Position[]>([]);
  closedPositions = signal<ClosedPosition[]>([]);
  metrics = signal<PerformanceMetrics | null>(null);
  recentAlerts = signal<Alert[]>([]);

  // View toggles
  showPositions = signal(true);
  showHistory = signal(false);
  showMetrics = signal(true);
  showAlerts = signal(true);

  // Computed values
  totalUnrealizedPnL = computed(() => {
    return this.activePositions().reduce((sum, p) => sum + (p.unrealizedPnL || 0), 0);
  });

  totalRealizedPnL = computed(() => {
    return this.closedPositions().reduce((sum, p) => sum + p.realizedPnL, 0);
  });

  todaysPnL = computed(() => {
    const today = new Date().toDateString();
    const todaysClosed = this.closedPositions().filter((p) => p.exitTime.toDateString() === today);
    return todaysClosed.reduce((sum, p) => sum + p.realizedPnL, 0);
  });

  bestPerformers = computed(() => {
    return [...this.closedPositions()]
      .sort((a, b) => b.realizedPnLPercent - a.realizedPnLPercent)
      .slice(0, 5);
  });

  worstPerformers = computed(() => {
    return [...this.closedPositions()]
      .sort((a, b) => a.realizedPnLPercent - b.realizedPnLPercent)
      .slice(0, 5);
  });

  ngOnInit(): void {
    // Subscribe to position data
    this.positionTracker.getActivePositions().subscribe((positions) => {
      this.activePositions.set(Array.from(positions.values()));
    });

    this.positionTracker.getPositionHistory().subscribe((history) => {
      this.closedPositions.set(history);
    });

    this.positionTracker.getPerformanceMetrics().subscribe((metrics) => {
      this.metrics.set(metrics);
    });

    // Subscribe to alerts
    this.alertSystem.getAlerts().subscribe((alerts) => {
      this.recentAlerts.set(alerts.slice(0, 10));
    });
  }

  // Position management
  closePosition(position: Position): void {
    if (confirm(`Close position for ${position.symbol}?`)) {
      this.positionTracker.closePosition(
        position.symbol,
        position.currentPrice || position.entryPrice,
        'manual',
      );
    }
  }

  updateStopLoss(position: Position, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newStopLoss = parseFloat(input.value);
    if (!isNaN(newStopLoss) && newStopLoss > 0) {
      this.positionTracker.setStopLoss(position.symbol, newStopLoss);
    }
  }

  updateTakeProfit(position: Position, event: Event): void {
    const input = event.target as HTMLInputElement;
    const newTakeProfit = parseFloat(input.value);
    if (!isNaN(newTakeProfit) && newTakeProfit > 0) {
      this.positionTracker.setTakeProfit(position.symbol, newTakeProfit);
    }
  }

  // Alert management
  markAlertAsRead(alertId: string): void {
    this.alertSystem.markAsRead(alertId);
  }

  clearAllAlerts(): void {
    if (confirm('Clear all alerts?')) {
      this.alertSystem.clearAlerts();
    }
  }

  // Data management
  exportData(): void {
    const data = {
      activePositions: this.activePositions(),
      closedPositions: this.closedPositions(),
      metrics: this.metrics(),
      exportDate: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trading-data-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  clearAllData(): void {
    this.positionTracker.clearAllData();
  }

  // Utility methods
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  }

  formatPercent(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  getPositionDuration(position: ClosedPosition): string {
    const hours = Math.floor(position.holdingPeriod / 60);
    const minutes = position.holdingPeriod % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  getPnLClass(value: number): string {
    if (value > 0) return 'positive';
    if (value < 0) return 'negative';
    return 'neutral';
  }

  getAlertIcon(type: string): string {
    switch (type) {
      case 'signal':
        return '📊';
      case 'position':
        return '💼';
      case 'price':
        return '💰';
      case 'system':
        return '⚙️';
      default:
        return '📌';
    }
  }
}
