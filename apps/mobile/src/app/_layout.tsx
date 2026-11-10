import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from '@expo-google-fonts/ibm-plex-sans';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppTabs } from '@/components/app-tabs';
import { FONT_FAMILY, PALETTE } from '@/constants/theme';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // El splash nativo puede haberse ocultado al recargar; la UI puede continuar.
});

const LIGHT_NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: PALETTE.light.paper,
    card: PALETTE.light.surface,
    text: PALETTE.light.ink,
    border: PALETTE.light.line,
    primary: PALETTE.light.primary,
  },
};

const DARK_NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: PALETTE.dark.paper,
    card: PALETTE.dark.surface,
    text: PALETTE.dark.ink,
    border: PALETTE.dark.line,
    primary: PALETTE.dark.primary,
  },
};

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [loaded, error] = useFonts({
    [FONT_FAMILY.sans.regular]: IBMPlexSans_400Regular,
    [FONT_FAMILY.sans.medium]: IBMPlexSans_500Medium,
    [FONT_FAMILY.sans.semibold]: IBMPlexSans_600SemiBold,
    [FONT_FAMILY.sans.bold]: IBMPlexSans_700Bold,
    [FONT_FAMILY.mono.regular]: IBMPlexMono_400Regular,
    [FONT_FAMILY.mono.medium]: IBMPlexMono_500Medium,
    [FONT_FAMILY.mono.semibold]: IBMPlexMono_600SemiBold,
  });

  // Si las fuentes fallan, la app arranca con la tipografía del sistema en vez de quedar bloqueada.
  if (!loaded && !error) {
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DARK_NAV_THEME : LIGHT_NAV_THEME}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
