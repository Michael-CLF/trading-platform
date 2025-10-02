import {
  ApplicationConfig,
  provideZoneChangeDetection,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors, withFetch } from '@angular/common/http';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

// your interceptors (adjust the import paths if different)
import { authInterceptor } from './core/http/interceptors/auth.interceptor';
import { baseUrlInterceptor } from './core/http/interceptors/base-url.interceptor';
import { marketErrorInterceptor } from './core/http/interceptors/market-error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),

    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),

    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, baseUrlInterceptor, marketErrorInterceptor]),
    ),
  ],
};
