import { ScrollView, StyleSheet, View } from 'react-native';

import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { Tile } from '@/components/ui/tile';
import { useDockClearance, usePalette } from '@/hooks/use-palette';

export default function HomeScreen() {
  const palette = usePalette();
  const dockClearance = useDockClearance();

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <ShellHeader eyebrow="RRHH APS" title="Inicio" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: dockClearance }]}
      >
        <Tile>
          <AppText variant="label">Próximamente</AppText>
          <AppText variant="bodyStrong">Tu jornada, tus vacaciones y tus solicitudes</AppText>
          <AppText variant="caption" tone="ink2">
            Aparecerán aquí muy pronto.
          </AppText>
        </Tile>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 10, gap: 8 },
});
