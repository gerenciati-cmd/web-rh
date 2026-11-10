import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { FONT_FAMILY, RADIUS } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

import { AppText } from './text';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Acepta además las props que inyecta `Link asChild` (href, role, onPress…), que se reenvían
 * al `Pressable`.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  ...rest
}: ButtonProps) {
  const palette = usePalette();
  const inactive = disabled || loading;
  const textTone = variant === 'primary' ? 'onPrimary' : 'ink';

  return (
    <Pressable
      {...rest}
      disabled={inactive}
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      aria-busy={loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: variant === 'primary' ? palette.primary : palette.sunk },
        pressed && !inactive && { transform: [{ scale: 0.97 }] },
        inactive && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette[textTone]} />
      ) : (
        <AppText tone={textTone} style={styles.text}>
          {title}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: FONT_FAMILY.sans.semibold, fontSize: 15, lineHeight: 20 },
});
