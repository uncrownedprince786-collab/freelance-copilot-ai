'use client';

import React, { useEffect, useState } from 'react';
import { IconSun, IconMoon } from '@/components/icons';

const THEME_KEY = 'lh_theme';

export function getStoredTheme(): 'light' | 'dark' | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  return 'light';
}

export function setTheme(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* storage unavailable */ }
}

interface ThemeToggleProps {
  size?: number;
}

export function ThemeToggle({ size = 16 }: ThemeToggleProps) {
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    setThemeState(currentTheme());

    // When the user has not chosen a theme explicitly, keep in sync with the
    // system preference (light/dark) so the toggle reflects the live setting.
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (!getStoredTheme()) {
        const next = e.matches ? 'dark' : 'light';
        setTheme(next);
        setThemeState(next);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="lh-theme-toggle"
    >
      {isDark ? <IconSun size={size} /> : <IconMoon size={size} />}
    </button>
  );
}
