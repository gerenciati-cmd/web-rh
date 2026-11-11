import type { MyTodayDto } from '@rrhh/contracts';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { Tile } from '@/components/ui/tile';
import { formatLocalDay, formatLocalTime, formatMinutes } from '@/features/attendance/format';
import { useMyToday } from '@/features/attendance/hooks/use-my-today';
import { useDockClearance, usePalette } from '@/hooks/use-palette';

export default function HomeScreen() {
  const palette = usePalette();
  const dockClearance = useDockClearance();
  const { state, reload } = useMyToday();

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <ShellHeader eyebrow="RRHH APS" title="Hoy" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: dockClearance }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {state.status === 'loading' ? (
          <AppText variant="caption" tone="ink2">
            Cargando tu día…
          </AppText>
        ) : null}

        {state.status === 'error' ? (
          <>
            <Tile>
              <AppText variant="body" tone="danger">
                {state.message}
              </AppText>
            </Tile>
            <Button variant="secondary" title="Reintentar" onPress={reload} />
          </>
        ) : null}

        {state.status === 'success' ? <TodayContent today={state.data} /> : null}
      </ScrollView>
    </View>
  );
}

function TodayContent({ today }: { today: MyTodayDto }) {
  const tz = today.timeZone;
  const { shift, punches } = today;

  return (
    <>
      <Tile>
        <AppText variant="label">Turno · {formatLocalDay(today.date)}</AppText>
        {shift === null ? (
          <AppText variant="caption" tone="ink2">
            No tienes turno asignado hoy.
          </AppText>
        ) : shift.day.type === 'WORK' ? (
          <>
            <AppText variant="figure">
              {formatLocalTime(shift.day.scheduledStartAt, tz)}–
              {formatLocalTime(shift.day.scheduledEndAt, tz)}
            </AppText>
            <AppText variant="caption" tone="ink2">
              {shift.name} · {formatMinutes(shift.day.scheduledMinutes)} · comida{' '}
              {shift.day.mealBreakMinutes} min · tolerancia {shift.day.toleranceMinutes} min
            </AppText>
          </>
        ) : (
          <>
            <View style={styles.chipRow}>
              <Chip label="Descanso" tone="sand" />
            </View>
            <AppText variant="caption" tone="ink2">
              Hoy no tienes turno de trabajo.
            </AppText>
          </>
        )}
      </Tile>

      <Tile>
        <AppText variant="label">Marcaciones de hoy</AppText>
        {punches.length === 0 ? (
          <AppText variant="caption" tone="ink2">
            Sin marcaciones en la ventana de hoy.
          </AppText>
        ) : (
          <>
            <AppText variant="figure">Entrada {formatLocalTime(punches[0] ?? '', tz)}</AppText>
            {punches.length > 1 ? (
              <AppText variant="figure">
                Última {formatLocalTime(punches[punches.length - 1] ?? '', tz)}
              </AppText>
            ) : null}
            {punches.length > 1 ? (
              <AppText variant="caption" tone="ink2">
                {punches.length} marcaciones
              </AppText>
            ) : null}
          </>
        )}
        <AppText variant="caption" tone="ink2">
          El retardo y las horas extra se calculan al cerrar el día.
        </AppText>
      </Tile>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 10, gap: 8 },
  chipRow: { flexDirection: 'row' },
});
