import { StyleSheet, View } from 'react-native';

import { FONT_FAMILY, RADIUS, type PaletteKey } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

import { AppText } from './text';

export type ChipTone = 'success' | 'warning' | 'danger' | 'sand' | 'neutral';

const TONES: Record<ChipTone, { bg: PaletteKey; fg: PaletteKey }> = {
  success: { bg: 'successBg', fg: 'success' },
  warning: { bg: 'warningBg', fg: 'warning' },
  danger: { bg: 'dangerBg', fg: 'danger' },
  sand: { bg: 'sandSoft', fg: 'sandText' },
  neutral: { bg: 'sunk', fg: 'ink2' },
};

export interface ChipProps {
  label: string;
  tone?: ChipTone;
}

export function Chip({ label, tone = 'neutral' }: ChipProps) {
  const palette = usePalette();
  const { bg, fg } = TONES[tone];

  return (
    <View style={[styles.chip, { backgroundColor: palette[bg] }]}>
      <AppText tone={fg} style={styles.text}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: RADIUS.pill, paddingVertical: 2, paddingHorizontal: 8 },
  text: { fontFamily: FONT_FAMILY.sans.semibold, fontSize: 11, lineHeight: 14 },
});
