// src/app/services/alert-system.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type AlertType = 'signal' | 'price' | 'position' | 'system' | 'error';
export type AlertPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Alert {
  id: string;
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  symbol?: string;
  timestamp: Date;
  read: boolean;
  actionable: boolean;
  action?: {
    label: string;
    callback: () => void;
  };
  metadata?: any;
}

export interface AlertPreferences {
  enableBrowserNotifications: boolean;
  enableSoundAlerts: boolean;
  enableEmailAlerts: boolean;

  // Alert type toggles
  signalAlerts: boolean;
  priceAlerts: boolean;
  positionAlerts: boolean;
  systemAlerts: boolean;

  // Thresholds
  minConfidenceForAlert: number; // 0-1
  strongSignalThreshold: number; // 0-1

  // Quiet hours
  enableQuietHours: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "08:00"
}

@Injectable({ providedIn: 'root' })
export class AlertSystemService {
  private readonly ALERTS_KEY = 'trading_alerts';
  private readonly PREFS_KEY = 'alert_preferences';
  private readonly MAX_ALERTS = 100;

  private alerts = new BehaviorSubject<Alert[]>([]);
  private unreadCount = new BehaviorSubject<number>(0);
  private preferences = new BehaviorSubject<AlertPreferences>(this.getDefaultPreferences());

  // Sound files
  private audioContext?: AudioContext;
  private sounds = {
    signal: '/assets/sounds/signal.mp3',
    critical: '/assets/sounds/critical.mp3',
    success: '/assets/sounds/success.mp3',
  };

  // Flag to track localStorage availability
  private storageAvailable: boolean = false;

  constructor() {
    this.checkStorageAvailability();
    this.loadFromStorage();
    this.initializeBrowserNotifications();
    this.initializeAudioContext();
  }

  // Alert Creation
  createAlert(
    type: AlertType,
    priority: AlertPriority,
    title: string,
    message: string,
    options?: {
      symbol?: string;
      actionable?: boolean;
      action?: { label: string; callback: () => void };
      metadata?: any;
    },
  ): void {
    const alert: Alert = {
      id: this.generateId(),
      type,
      priority,
      title,
      message,
      symbol: options?.symbol,
      timestamp: new Date(),
      read: false,
      actionable: options?.actionable || false,
      action: options?.action,
      metadata: options?.metadata,
    };

    // Check preferences
    if (!this.shouldShowAlert(alert)) {
      return;
    }

    // Add to alerts
    const currentAlerts = this.alerts.value;
    currentAlerts.unshift(alert);

    // Limit total alerts
    if (currentAlerts.length > this.MAX_ALERTS) {
      currentAlerts.splice(this.MAX_ALERTS);
    }

    this.alerts.next(currentAlerts);
    this.updateUnreadCount();
    this.saveToStorage();

    // Trigger notifications
    this.triggerNotifications(alert);
  }

  // Signal-specific alerts
  createSignalAlert(
    symbol: string,
    action: 'buy' | 'sell' | 'strong_buy' | 'strong_sell',
    confidence: number,
    price: number,
  ): void {
    const prefs = this.preferences.value;

    if (!prefs.signalAlerts || confidence < prefs.minConfidenceForAlert) {
      return;
    }

    const priority = confidence >= prefs.strongSignalThreshold ? 'high' : 'medium';
    const emoji = action.includes('buy') ? '🟢' : '🔴';

    this.createAlert(
      'signal',
      priority,
      `${emoji} ${action.toUpperCase().replace('_', ' ')} Signal: ${symbol}`,
      `Confidence: ${(confidence * 100).toFixed(1)}% at $${price.toFixed(2)}`,
      {
        symbol,
        actionable: true,
        metadata: { action, confidence, price },
      },
    );
  }

  createPositionAlert(
    symbol: string,
    event: 'opened' | 'closed' | 'stop_loss' | 'take_profit',
    pnl?: number,
  ): void {
    if (!this.preferences.value.positionAlerts) return;

    let title = '';
    let message = '';
    let priority: AlertPriority = 'medium';

    switch (event) {
      case 'opened':
        title = `📈 Position Opened: ${symbol}`;
        message = 'New position entered';
        priority = 'low';
        break;
      case 'closed':
        title = `📊 Position Closed: ${symbol}`;
        message = pnl
          ? `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
          : 'Position manually closed';
        priority = 'medium';
        break;
      case 'stop_loss':
        title = `🛑 Stop Loss Hit: ${symbol}`;
        message = pnl ? `Loss: -$${Math.abs(pnl).toFixed(2)}` : 'Stop loss triggered';
        priority = 'high';
        break;
      case 'take_profit':
        title = `🎯 Take Profit Hit: ${symbol}`;
        message = pnl ? `Profit: +$${pnl.toFixed(2)}` : 'Take profit triggered';
        priority = 'high';
        break;
    }

    this.createAlert('position', priority, title, message, { symbol });
  }

  createPriceAlert(symbol: string, currentPrice: number, condition: string): void {
    if (!this.preferences.value.priceAlerts) return;

    this.createAlert(
      'price',
      'medium',
      `💰 Price Alert: ${symbol}`,
      `${condition} at $${currentPrice.toFixed(2)}`,
      { symbol },
    );
  }

  // Alert Management
  markAsRead(alertId: string): void {
    const alerts = this.alerts.value;
    const alert = alerts.find((a) => a.id === alertId);

    if (alert && !alert.read) {
      alert.read = true;
      this.alerts.next(alerts);
      this.updateUnreadCount();
      this.saveToStorage();
    }
  }

  markAllAsRead(): void {
    const alerts = this.alerts.value;
    alerts.forEach((a) => (a.read = true));
    this.alerts.next(alerts);
    this.updateUnreadCount();
    this.saveToStorage();
  }

  deleteAlert(alertId: string): void {
    const alerts = this.alerts.value.filter((a) => a.id !== alertId);
    this.alerts.next(alerts);
    this.updateUnreadCount();
    this.saveToStorage();
  }

  clearAlerts(): void {
    this.alerts.next([]);
    this.updateUnreadCount();
    this.saveToStorage();
  }

  // Observables
  getAlerts(): Observable<Alert[]> {
    return this.alerts.asObservable();
  }

  getUnreadCount(): Observable<number> {
    return this.unreadCount.asObservable();
  }

  getPreferences(): Observable<AlertPreferences> {
    return this.preferences.asObservable();
  }

  // Preferences
  updatePreferences(prefs: Partial<AlertPreferences>): void {
    const current = this.preferences.value;
    const updated = { ...current, ...prefs };
    this.preferences.next(updated);
    this.safeSetItem(this.PREFS_KEY, JSON.stringify(updated));

    // Re-request notification permission if needed
    if (updated.enableBrowserNotifications && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // Private Methods
  private shouldShowAlert(alert: Alert): boolean {
    const prefs = this.preferences.value;

    // Check type preferences
    switch (alert.type) {
      case 'signal':
        if (!prefs.signalAlerts) return false;
        break;
      case 'price':
        if (!prefs.priceAlerts) return false;
        break;
      case 'position':
        if (!prefs.positionAlerts) return false;
        break;
      case 'system':
        if (!prefs.systemAlerts) return false;
        break;
    }

    // Check quiet hours
    if (prefs.enableQuietHours && alert.priority !== 'critical') {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      if (prefs.quietHoursStart <= prefs.quietHoursEnd) {
        // Normal case: quiet hours don't cross midnight
        if (currentTime >= prefs.quietHoursStart && currentTime <= prefs.quietHoursEnd) {
          return false;
        }
      } else {
        // Quiet hours cross midnight
        if (currentTime >= prefs.quietHoursStart || currentTime <= prefs.quietHoursEnd) {
          return false;
        }
      }
    }

    return true;
  }

  private triggerNotifications(alert: Alert): void {
    const prefs = this.preferences.value;

    // Browser notification
    if (prefs.enableBrowserNotifications) {
      this.showBrowserNotification(alert);
    }

    // Sound alert
    if (prefs.enableSoundAlerts) {
      this.playSound(alert.priority);
    }
  }

  private showBrowserNotification(alert: Alert): void {
    if (Notification.permission !== 'granted') return;

    try {
      const notification = new Notification(alert.title, {
        body: alert.message,
        icon: '/assets/icons/icon-192x192.png',
        badge: '/assets/icons/badge-72x72.png',
        tag: alert.id,
        requireInteraction: alert.priority === 'high' || alert.priority === 'critical',
      });

      notification.onclick = () => {
        window.focus();
        this.markAsRead(alert.id);

        if (alert.action) {
          alert.action.callback();
        }
      };

      // Auto-close after 10 seconds for non-critical
      if (alert.priority !== 'critical') {
        setTimeout(() => notification.close(), 10000);
      }
    } catch (error) {
      console.warn('Failed to show browser notification:', error);
    }
  }

  private playSound(priority: AlertPriority): void {
    if (!this.audioContext) return;

    try {
      const soundFile = priority === 'critical' ? this.sounds.critical : this.sounds.signal;

      // Simple beep for now - you can add actual sound files later
      const oscillator = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.audioContext.destination);

      oscillator.frequency.value = priority === 'critical' ? 800 : 600;
      gainNode.gain.value = 0.1;

      oscillator.start();
      oscillator.stop(this.audioContext.currentTime + 0.2);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  private initializeBrowserNotifications(): void {
    if ('Notification' in window && Notification.permission === 'default') {
      // We'll request permission when user enables notifications in preferences
    }
  }

  private initializeAudioContext(): void {
    try {
      if ('AudioContext' in window) {
        this.audioContext = new AudioContext();
      }
    } catch (error) {
      console.warn('Failed to initialize audio context:', error);
    }
  }

  private updateUnreadCount(): void {
    const count = this.alerts.value.filter((a) => !a.read).length;
    this.unreadCount.next(count);
  }

  private generateId(): string {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultPreferences(): AlertPreferences {
    return {
      enableBrowserNotifications: false,
      enableSoundAlerts: true,
      enableEmailAlerts: false,
      signalAlerts: true,
      priceAlerts: true,
      positionAlerts: true,
      systemAlerts: true,
      minConfidenceForAlert: 0.65,
      strongSignalThreshold: 0.75,
      enableQuietHours: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
    };
  }

  // Enhanced storage methods with better error handling
  private checkStorageAvailability(): void {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      this.storageAvailable = true;
    } catch {
      this.storageAvailable = false;
      console.warn('localStorage is not available. Using in-memory storage only.');
    }
  }

  private safeGetItem(key: string): string | null {
    if (!this.storageAvailable) return null;

    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Failed to get item from localStorage: ${key}`, error);
      return null;
    }
  }

  private safeSetItem(key: string, value: string): void {
    if (!this.storageAvailable) return;

    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`Failed to set item in localStorage: ${key}`, error);
      // If quota exceeded, try to clear old data
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        this.handleQuotaExceeded();
      }
    }
  }

  private handleQuotaExceeded(): void {
    try {
      // Keep only the last 50 alerts when quota is exceeded
      const alerts = this.alerts.value.slice(0, 50);
      this.alerts.next(alerts);
      localStorage.setItem(this.ALERTS_KEY, JSON.stringify(alerts));
    } catch {
      // If still failing, clear localStorage for this app
      console.warn('Clearing localStorage due to quota exceeded');
      this.clearLocalStorage();
    }
  }

  private clearLocalStorage(): void {
    try {
      localStorage.removeItem(this.ALERTS_KEY);
      localStorage.removeItem(this.PREFS_KEY);
    } catch {
      // Silent fail - we're already in fallback mode
    }
  }

  private loadFromStorage(): void {
    try {
      const alertsData = this.safeGetItem(this.ALERTS_KEY);
      if (alertsData) {
        const alerts = JSON.parse(alertsData).map((a: any) => ({
          ...a,
          timestamp: new Date(a.timestamp),
        }));
        this.alerts.next(alerts);
        this.updateUnreadCount();
      }

      const prefsData = this.safeGetItem(this.PREFS_KEY);
      if (prefsData) {
        this.preferences.next(JSON.parse(prefsData));
      }
    } catch (error) {
      console.error('Failed to load from storage:', error);
      // Continue with default/empty state
    }
  }

  private saveToStorage(): void {
    try {
      const alertsJson = JSON.stringify(this.alerts.value);
      this.safeSetItem(this.ALERTS_KEY, alertsJson);
    } catch (error) {
      console.error('Failed to save alerts to storage:', error);
      // Continue without persistence - alerts will still work in memory
    }
  }
}
