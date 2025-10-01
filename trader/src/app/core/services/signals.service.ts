import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SignalResponse } from '../shared/models/signal.models';

@Injectable({ providedIn: 'root' })
export class SignalsService {
  private http = inject(HttpClient);

  /** GET /signals/today */
  getToday(): Observable<SignalResponse> {
    return this.http.get<SignalResponse>('/signals/today');
  }

  /** POST /signals/run  { universe: string[] } */
  runNow(universe: string[]) {
    return this.http.post<{ status: string }>('/signals/run', { universe });
  }
}
