import { FlatList, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { Tile } from '@/components/ui/tile';
import { useCompanies } from '@/features/organization/hooks/use-companies';
import { useDockClearance, usePalette } from '@/hooks/use-palette';

export default function CompaniesScreen() {
  const { state, reload } = useCompanies();
  const palette = usePalette();
  const dockClearance = useDockClearance();

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <ShellHeader eyebrow="Holding" title="Empresas" />

      {state.status === 'loading' && (
        <AppText variant="caption" tone="ink2" style={styles.padded}>
          Cargando empresas…
        </AppText>
      )}

      {state.status === 'error' && (
        <View style={styles.errorWrap}>
          <Tile>
            <AppText tone="danger">No se pudo cargar el listado: {state.message}.</AppText>
            <Button variant="primary" title="Reintentar" onPress={() => void reload()} />
          </Tile>
        </View>
      )}

      {state.status === 'success' && (
        <FlatList
          data={state.companies}
          keyExtractor={(company) => company.id}
          contentContainerStyle={[styles.list, { paddingBottom: dockClearance }]}
          ListEmptyComponent={
            <AppText variant="caption" tone="ink2">
              Aún no hay empresas registradas.
            </AppText>
          }
          renderItem={({ item }) => (
            <Tile>
              <AppText variant="bodyStrong">{item.legalName}</AppText>
              <View style={styles.metaRow}>
                <AppText variant="label">
                  {item.taxId} · {item.country}
                </AppText>
                <Chip
                  label={item.active ? 'Activa' : 'Inactiva'}
                  tone={item.active ? 'success' : 'neutral'}
                />
              </View>
            </Tile>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  padded: { padding: 16 },
  errorWrap: { padding: 10 },
  list: { padding: 10, gap: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
