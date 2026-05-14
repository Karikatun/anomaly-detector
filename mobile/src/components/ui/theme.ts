import { useColorScheme, type TextStyle } from 'react-native';

import { Fonts } from '@/constants/theme';

export type UiScheme = 'light' | 'dark';
export type UiTypographyVariant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'bodyXl'
  | 'bodyLg'
  | 'body'
  | 'bodySm'
  | 'bodyXs'
  | 'caption'
  | 'label'
  | 'button'
  | 'link'
  | 'code';

export type UiTypographyStyle = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'fontWeight' | 'letterSpacing' | 'lineHeight'
>;

export type UiTheme = {
  scheme: UiScheme;
  colors: {
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    destructiveForeground: string;
    border: string;
    input: string;
    ring: string;
    transparent: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    full: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  typography: Record<UiTypographyVariant, UiTypographyStyle>;
  opacity: {
    pressed: number;
    disabled: number;
    muted: number;
  };
};

export const uiThemes: Record<UiScheme, UiTheme> = {
  light: {
    scheme: 'light',
    colors: {
      background: '#ffffff',
      foreground: '#252525',
      card: '#ffffff',
      cardForeground: '#252525',
      popover: '#ffffff',
      popoverForeground: '#252525',
      primary: '#343434',
      primaryForeground: '#fafafa',
      secondary: '#f7f7f7',
      secondaryForeground: '#343434',
      muted: '#f7f7f7',
      mutedForeground: '#666666',
      accent: '#f7f7f7',
      accentForeground: '#343434',
      destructive: '#d92d20',
      destructiveForeground: '#ffffff',
      border: '#e5e5e5',
      input: '#e5e5e5',
      ring: '#a1a1a1',
      transparent: 'transparent',
    },
    radius: {
      sm: 6,
      md: 8,
      lg: 10,
      xl: 14,
      xxl: 18,
      full: 999,
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      xxl: 32,
    },
    typography: createTypographyScale(),
    opacity: {
      pressed: 0.72,
      disabled: 0.5,
      muted: 0.65,
    },
  },
  dark: {
    scheme: 'dark',
    colors: {
      background: '#252525',
      foreground: '#fafafa',
      card: '#343434',
      cardForeground: '#fafafa',
      popover: '#343434',
      popoverForeground: '#fafafa',
      primary: '#e5e5e5',
      primaryForeground: '#343434',
      secondary: '#444444',
      secondaryForeground: '#fafafa',
      muted: '#444444',
      mutedForeground: '#a1a1a1',
      accent: '#444444',
      accentForeground: '#fafafa',
      destructive: '#f97066',
      destructiveForeground: '#250806',
      border: '#464646',
      input: '#525252',
      ring: '#8a8a8a',
      transparent: 'transparent',
    },
    radius: {
      sm: 6,
      md: 8,
      lg: 10,
      xl: 14,
      xxl: 18,
      full: 999,
    },
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      xxl: 32,
    },
    typography: createTypographyScale(),
    opacity: {
      pressed: 0.72,
      disabled: 0.5,
      muted: 0.65,
    },
  },
};

function createTypographyScale(): Record<UiTypographyVariant, UiTypographyStyle> {
  return {
    h1: { fontSize: 40, lineHeight: 48, fontWeight: '700', letterSpacing: 0 },
    h2: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: 0 },
    h3: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: 0 },
    h4: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0 },
    h5: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: 0 },
    h6: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: 0 },
    bodyXl: { fontSize: 20, lineHeight: 30, fontWeight: '500', letterSpacing: 0 },
    bodyLg: { fontSize: 18, lineHeight: 26, fontWeight: '500', letterSpacing: 0 },
    body: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0 },
    bodySm: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0 },
    bodyXs: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0 },
    label: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
    button: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
    link: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0 },
    code: {
      fontFamily: Fonts.mono,
      fontSize: 12,
      fontWeight: '500',
      letterSpacing: 0,
      lineHeight: 16,
    },
  };
}

export function getUiTheme(scheme: UiScheme = 'light') {
  return uiThemes[scheme];
}

export function useUiTheme() {
  const colorScheme = useColorScheme();
  return getUiTheme(colorScheme === 'dark' ? 'dark' : 'light');
}

export function withAlpha(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;

  const clampedAlpha = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${normalized}${clampedAlpha}`;
}
