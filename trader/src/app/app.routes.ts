import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./core/components/shell/shell').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

      {
        path: 'dashboard',
        loadComponent: () =>
          import('./core/components/dashboard/dashboard').then((m) => m.Dashboard),
        data: { title: 'Dashboard' },
      },
      {
        path: 'positions',
        loadComponent: () =>
          import('./core/components/positions/positions').then((m) => m.PositionsComponent),
        data: { title: 'Positions' },
      },
      {
        path: 'backtests',
        loadComponent: () =>
          import('./core/components/backtests/backtests').then((m) => m.BacktestsComponent),
        data: { title: 'Backtests' },
      },
      {
        path: 'signals',
        loadComponent: () =>
          import('./core/components/signals/signals').then((m) => m.SignalsComponent),
        data: { title: 'Signals' },
      },
      {
        path: 'tracker',
        loadComponent: () => import('./core/components/tracker/tracker').then((m) => m.Tracker),
      },
    ],
  },

  // Fallback
  { path: '**', redirectTo: 'dashboard' },
];
