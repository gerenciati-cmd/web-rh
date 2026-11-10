import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePalette } from '@/hooks/use-palette';

import { AppText } from './text';

export interface ShellHeaderProps {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
}

export function ShellHeader({ eyebrow, title, right }: ShellHeaderProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { backgroundColor: palette.shell, paddingTop: insets.top + 12 }]}>
      {eyebrow ? (
        <AppText variant="caption" tone="onShell2">
          {eyebrow}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <AppText variant="display" tone="onShell">
          {title}
        </AppText>
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', paddingHorizontal: 16, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
