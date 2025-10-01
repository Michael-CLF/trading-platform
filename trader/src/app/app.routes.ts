import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./core/components/shell/shell').then((m) => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./core/components/stub/stub').then((m) => m.StubComponent),
        data: { title: 'Dashboard' },
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./core/components/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {
        path: 'backtests',
        loadComponent: () =>
          import('./core/components/backtests/backtests').then((m) => m.BacktestsComponent),
        data: { title: 'Backtests' },
      },
      {
        path: 'positions',
        loadComponent: () =>
          import('./core/components/positions/positions').then((m) => m.PositionsComponent),
        data: { title: 'Positions' },
      },

      {
        path: 'signals',
        loadComponent: () => import('./core/components/stub/stub').then((m) => m.StubComponent),
        data: { title: 'Signals' },
      },
      {
        path: 'backtests',
        loadComponent: () => import('./core/components/stub/stub').then((m) => m.StubComponent),
        data: { title: 'Backtests' },
      },
      {
        path: 'positions',
        loadComponent: () => import('./core/components/stub/stub').then((m) => m.StubComponent),
        data: { title: 'Positions' },
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: '**', redirectTo: 'dashboard' },
    ],
  },
];
