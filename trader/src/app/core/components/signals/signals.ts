import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Signal, SignalAction } from '../../shared/models/signal.models';

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
})
export class SignalsComponent {
  private http = inject(HttpClient);

  loading = signal(true);
  query = signal(''); // symbol search
  action = signal<SignalAction | ''>(''); // action filter
  rows = signal<Signal[]>([]);

  ngOnInit() {
    this.http.get<{ signals: Signal[] }>('/assets/mock/signals.json').subscribe({
      next: (res) => this.rows.set(res.signals),
      error: () => this.rows.set([]),
      complete: () => this.loading.set(false),
    });
  }

  filtered = computed(() => {
    const q = this.query().trim().toUpperCase();
    const a = this.action();
    return this.rows().filter((s) => {
      const matchSymbol = q ? s.symbol.toUpperCase().includes(q) : true;
      const matchAction = a ? s.action === a : true;
      return matchSymbol && matchAction;
    });
  });
}
