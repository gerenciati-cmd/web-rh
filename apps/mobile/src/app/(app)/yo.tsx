import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { Tile } from '@/components/ui/tile';
import { useSession } from '@/features/identity/session/session-provider';
import { useDockClearance, usePalette } from '@/hooks/use-palette';

export default function MeScreen() {
  const palette = usePalette();
  const dockClearance = useDockClearance();
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <ShellHeader eyebrow="Mi cuenta" title="Yo" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: dockClearance }]}
      >
        <Tile>
          <AppText variant="label">Correo</AppText>
          <AppText variant="bodyStrong">{user?.email}</AppText>
          {user?.employeeId === null ? (
            <AppText variant="caption" tone="ink2">
              Tu cuenta no está vinculada a un colaborador.
            </AppText>
          ) : null}
        </Tile>
        <Button
          variant="secondary"
          title="Cerrar sesión"
          loading={signingOut}
          onPress={() => void handleSignOut()}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 10, gap: 8 },
});
