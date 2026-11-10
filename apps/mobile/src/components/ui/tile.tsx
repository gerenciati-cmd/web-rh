import { Pressable, View, type ViewProps } from 'react-native';

import { RADIUS } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

export type TileProps = ViewProps & {
  tone?: 'surface' | 'sunk';
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function Tile({ tone = 'surface', onPress, accessibilityLabel, style, ...rest }: TileProps) {
  const palette = usePalette();
  const base = {
    backgroundColor: palette[tone],
    borderWidth: tone === 'sunk' ? 0 : 1,
    borderColor: palette.line,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous' as const,
    padding: 12,
    gap: 6,
  };

  if (!onPress) {
    return <View {...rest} accessibilityLabel={accessibilityLabel} style={[base, style]} />;
  }

  return (
    <Pressable
      {...rest}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [base, pressed && { transform: [{ scale: 0.97 }] }, style]}
    />
  );
}
