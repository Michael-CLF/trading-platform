import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Signal } from '../../shared/models/signal.models';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class DashboardComponent {
  private http = inject(HttpClient);
  loading = signal<boolean>(true);
  rows = signal<Signal[]>([]);

  ngOnInit() {
    // TEMP: load mock signals from assets
    this.http.get<{ signals: Signal[] }>('/assets/mock/signals.json').subscribe({
      next: (res) => this.rows.set(res.signals),
      error: () => this.rows.set([]),
      complete: () => this.loading.set(false),
    });
  }
}
