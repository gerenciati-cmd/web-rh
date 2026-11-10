import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { FONT_FAMILY, RADIUS } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

import { AppText } from './text';

export type TextFieldProps = TextInputProps & {
  label: string;
  error?: string | null;
  secureToggle?: boolean;
};

export function TextField({
  label,
  error,
  secureToggle = false,
  style,
  secureTextEntry,
  ...rest
}: TextFieldProps) {
  const palette = usePalette();
  const [hidden, setHidden] = useState(true);

  return (
    <View style={styles.root}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.row}>
        <TextInput
          {...rest}
          accessibilityLabel={label}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          placeholderTextColor={palette.ink3}
          style={[
            styles.input,
            {
              backgroundColor: palette.surface,
              color: palette.ink,
              borderColor: error ? palette.danger : palette.line,
            },
            secureToggle && styles.inputWithToggle,
            style,
          ]}
        />
        {secureToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Mostrar contraseña' : 'Ocultar contraseña'}
            onPress={() => {
              setHidden((current) => !current);
            }}
            style={styles.toggle}
          >
            <AppText variant="bodyStrong" tone="primary">
              {hidden ? 'Mostrar' : 'Ocultar'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  row: { justifyContent: 'center' },
  input: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    paddingHorizontal: 12,
    fontFamily: FONT_FAMILY.sans.regular,
    // 16 evita el zoom automático de iOS en web.
    fontSize: 16,
  },
  inputWithToggle: { paddingRight: 92 },
  toggle: {
    position: 'absolute',
    right: 0,
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
