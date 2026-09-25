import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { WA_WINDOW } from '@ng-web-apis/common';
import { BehaviorSubject, Observable } from 'rxjs';

export type ThemeChoice = 'dark' | 'light' | 'system';
const ThemeChoices: ThemeChoice[] = ['dark', 'light', 'system'];

// Stored per browser, so it also works without logging in. assets/theme.js
// reads the same key to apply it before the page is drawn.
const StorageKey = 'theme';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly choiceSubject: BehaviorSubject<ThemeChoice>;
  private readonly systemLight: MediaQueryList | null;

  constructor(
    @Inject(WA_WINDOW) private readonly window: Window,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {
    this.systemLight =
      this.window.matchMedia?.('(prefers-color-scheme: light)') ?? null;
    this.systemLight?.addEventListener('change', () => this.apply());

    this.choiceSubject = new BehaviorSubject(this.load());
    this.apply();
  }

  public get live(): Observable<ThemeChoice> {
    return this.choiceSubject.asObservable();
  }

  public get choice(): ThemeChoice {
    return this.choiceSubject.getValue();
  }

  public set(choice: ThemeChoice) {
    try {
      this.window.localStorage.setItem(StorageKey, choice);
    } catch {
      // Still applies until the page is reloaded
    }
    this.choiceSubject.next(choice);
    this.apply();
  }

  private load(): ThemeChoice {
    try {
      const stored = this.window.localStorage.getItem(StorageKey);
      if (ThemeChoices.includes(stored as ThemeChoice)) {
        return stored as ThemeChoice;
      }
    } catch {
      // Storage can be blocked
    }
    return 'dark';
  }

  private apply() {
    const light =
      this.choice === 'light' ||
      (this.choice === 'system' && !!this.systemLight?.matches);
    this.document.documentElement.classList.toggle('theme-light', light);
  }
}
