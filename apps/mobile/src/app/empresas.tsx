import { FlatList, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BOTTOM_TAB_INSET, MAX_CONTENT_WIDTH, SPACING } from '@/constants/theme';
import { useCompanies } from '@/features/organization/hooks/use-companies';

export default function CompaniesScreen() {
  const { state, reload } = useCompanies();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Empresas</ThemedText>

        {state.status === 'loading' && <ThemedText>Cargando…</ThemedText>}

        {state.status === 'error' && (
          <Pressable onPress={() => void reload()}>
            <ThemedText>Error: {state.message}. Toca para reintentar.</ThemedText>
          </Pressable>
        )}

        {state.status === 'success' && (
          <FlatList
            data={state.companies}
            keyExtractor={(company) => company.id}
            ListEmptyComponent={<ThemedText>Aún no hay empresas registradas.</ThemedText>}
            renderItem={({ item }) => (
              <ThemedView style={styles.row}>
                <ThemedText type="subtitle">{item.legalName}</ThemedText>
                <ThemedText type="small">
                  {item.taxId} · {item.country} · {item.active ? 'Activa' : 'Inactiva'}
                </ThemedText>
              </ThemedView>
            )}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    gap: SPACING.three,
    paddingHorizontal: SPACING.four,
    paddingBottom: BOTTOM_TAB_INSET + SPACING.three,
  },
  row: { paddingVertical: SPACING.two, gap: SPACING.one },
});
