import {
  TabList,
  Tabs,
  TabSlot,
  TabTrigger,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/text';
import { DOCK, FONT_FAMILY, RADIUS } from '@/constants/theme';
import { usePalette } from '@/hooks/use-palette';

const HOME_ICON: SymbolViewProps['name'] = { ios: 'house', android: 'home', web: 'home' };
const ME_ICON: SymbolViewProps['name'] = {
  ios: 'person.crop.circle',
  android: 'person',
  web: 'person',
};

export function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <Dock>
          <TabTrigger name="index" href="/" asChild>
            <DockButton icon={HOME_ICON} label="Inicio" />
          </TabTrigger>
          <TabTrigger name="yo" href="/yo" asChild>
            <DockButton icon={ME_ICON} label="Yo" />
          </TabTrigger>
        </Dock>
      </TabList>
    </Tabs>
  );
}

function Dock(props: TabListProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View
      {...props}
      style={[
        styles.dock,
        {
          backgroundColor: palette.shell,
          left: DOCK.sideInset,
          right: DOCK.sideInset,
          bottom: insets.bottom + DOCK.bottomGap,
        },
      ]}
    />
  );
}

type DockButtonProps = TabTriggerSlotProps & {
  icon: SymbolViewProps['name'];
  label: string;
};

function DockButton({ icon, label, isFocused, children: _children, ...props }: DockButtonProps) {
  const palette = usePalette();

  return (
    <Pressable
      {...props}
      accessibilityRole="tab"
      aria-selected={Boolean(isFocused)}
      style={({ pressed }) => [
        styles.button,
        isFocused && { backgroundColor: palette.dockActive },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <SymbolView name={icon} size={20} tintColor={isFocused ? palette.accent : palette.onShell2} />
      <AppText
        tone={isFocused ? 'onShell' : 'onShell2'}
        style={styles.label}
        // El rótulo escala con la fuente del sistema, pero el dock no debe crecer sin límite.
        maxFontSizeMultiplier={1.3}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    flexDirection: 'row',
    height: DOCK.height,
    padding: 6,
    borderRadius: RADIUS.lg,
    borderCurve: 'continuous',
  },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: { fontFamily: FONT_FAMILY.sans.medium, fontSize: 10.5, lineHeight: 13 },
});
