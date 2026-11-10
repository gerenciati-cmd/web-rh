import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { Button } from '@/components/ui/button';
import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { Tile } from '@/components/ui/tile';
import { loginErrorMessage } from '@/features/identity/login-error-message';
import { useSession } from '@/features/identity/session/session-provider';
import { usePalette } from '@/hooks/use-palette';

export default function LoginScreen() {
  const palette = usePalette();
  const { notice, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0;

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await signIn(email, password, remember);
    } catch (error) {
      setErrorMessage(loginErrorMessage(error));
      setPassword('');
      setSubmitting(false);
    }
    // En éxito el guard redirige y esta pantalla se desmonta.
  }

  // RNW solo trata Enter como pulsación en un role "switch"; Space lo agregamos aquí (patrón
  // ARIA) y evitamos que la página haga scroll. Enter sigue por el camino de onPress.
  function handleRememberKeyDown(event: { key?: string; preventDefault?: () => void }) {
    if (Platform.OS !== 'web') return;
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault?.();
      setRemember((current) => !current);
    }
  }

  // Los tipos de RN no declaran `onKeyDown` en Pressable, pero RNW lo reenvía al DOM.
  const rememberWebProps = Platform.OS === 'web' ? { onKeyDown: handleRememberKeyDown } : {};

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: palette.paper }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ShellHeader eyebrow="RRHH APS" title="Inicia sesión" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notice === 'expired' ? (
          <Tile tone="sunk">
            <AppText variant="bodyStrong">Tu sesión terminó</AppText>
            <AppText variant="caption" tone="ink2">
              Vuelve a iniciar sesión para continuar.
            </AppText>
          </Tile>
        ) : null}
        <TextField
          label="Correo"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
        />
        <TextField
          label="Contraseña"
          value={password}
          onChangeText={setPassword}
          secureToggle
          autoComplete="password"
          textContentType="password"
        />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: remember }}
          aria-checked={remember}
          onPress={() => {
            setRemember((current) => !current);
          }}
          {...rememberWebProps}
          style={styles.rememberRow}
        >
          {/* El interruptor es solo visual: la fila es la única que alterna. En web el `Switch`
              de RN es un checkbox real (segundo control con el mismo nombre), por eso allí se
              dibuja con Views. */}
          {Platform.OS === 'web' ? (
            <View
              aria-hidden
              style={[
                styles.track,
                { backgroundColor: remember ? palette.primary : palette.line },
                remember ? styles.trackOn : null,
              ]}
            >
              <View style={[styles.thumb, { backgroundColor: palette.surface }]} />
            </View>
          ) : (
            <View
              style={styles.noPointer}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Switch value={remember} trackColor={{ true: palette.primary }} />
            </View>
          )}
          <AppText>Recordarme</AppText>
        </Pressable>
        <View accessibilityLiveRegion="polite" aria-live="polite">
          {errorMessage ? <AppText tone="danger">{errorMessage}</AppText> : null}
        </View>
        <Button
          title="Entrar"
          loading={submitting}
          disabled={!canSubmit}
          onPress={() => void handleSubmit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 12 },
  noPointer: { pointerEvents: 'none' },
  track: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  trackOn: { alignItems: 'flex-end' },
  thumb: { width: 20, height: 20, borderRadius: 10 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
});
