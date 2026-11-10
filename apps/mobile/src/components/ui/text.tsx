import { StyleSheet, Text, type TextProps } from 'react-native';

import { FONT_FAMILY, type PaletteKey } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

export type AppTextVariant =
  'display' | 'title' | 'body' | 'bodyStrong' | 'caption' | 'label' | 'figure';

export type AppTextProps = TextProps & {
  variant?: AppTextVariant;
  tone?: PaletteKey;
};

export function AppText({ variant = 'body', tone, style, ...rest }: AppTextProps) {
  const palette = usePalette();
  const color = palette[tone ?? (variant === 'label' ? 'ink3' : 'ink')];

  return <Text {...rest} style={[styles[variant], { color }, style]} />;
}

const styles = StyleSheet.create({
  display: {
    fontFamily: FONT_FAMILY.sans.semibold,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  title: { fontFamily: FONT_FAMILY.sans.semibold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: FONT_FAMILY.sans.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: FONT_FAMILY.sans.medium, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: FONT_FAMILY.sans.regular, fontSize: 12.5, lineHeight: 17 },
  label: {
    fontFamily: FONT_FAMILY.mono.medium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  figure: {
    fontFamily: FONT_FAMILY.mono.medium,
    fontSize: 24,
    lineHeight: 28,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.6,
  },
});
