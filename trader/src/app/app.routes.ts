import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./core/components/shell/shell').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },

      {
        path: 'dashboard',
        // ⬇️ was m.DashboardComponent — must be m.Dashboard
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
        path: 'signals',
        loadComponent: () =>
          import('./core/components/signals/signals').then((m) => m.SignalsComponent),
        data: { title: 'Signals' },
      },

      {
        path: 'backtests',
        loadComponent: () =>
          import('./core/components/backtests/backtests').then((m) => m.BacktestsComponent),
        data: { title: 'Backtests' },
      },
    ],
  },

  { path: '**', redirectTo: 'dashboard' },
];
