import type { MyWorkdaysDto } from '@rrhh/contracts';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ShellHeader } from '@/components/ui/shell-header';
import { AppText } from '@/components/ui/text';
import { Tile } from '@/components/ui/tile';
import { FONT_FAMILY, RADIUS } from '@/constants/theme';
import {
  formatLocalDay,
  formatLocalTime,
  formatMinutes,
  formatMonthTitle,
  monthSummary,
  previousMonth,
  workdayStatusView,
} from '@/features/attendance/format';
import { useMyToday } from '@/features/attendance/hooks/use-my-today';
import { useMyWorkdays } from '@/features/attendance/hooks/use-my-workdays';
import { useDockClearance, usePalette } from '@/hooks/use-palette';

type Choice = 'current' | 'previous';

export default function AttendanceScreen() {
  const palette = usePalette();
  const dockClearance = useDockClearance();
  const [choice, setChoice] = useState<Choice>('current');
  const today = useMyToday();

  // El mes actual sale de la fecha de hoy en la zona de la sede, no de la del teléfono.
  const current = today.state.status === 'success' ? today.state.data.date.slice(0, 7) : null;
  const selected =
    current === null ? null : choice === 'current' ? current : previousMonth(current);
  const workdays = useMyWorkdays(selected);

  function reload() {
    today.reload();
    workdays.reload();
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <ShellHeader
        eyebrow="Mi asistencia"
        title={selected === null ? 'Asistencia' : formatMonthTitle(selected)}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: dockClearance }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {today.state.status === 'error' ? (
          <>
            <Tile>
              <AppText variant="body" tone="danger">
                {today.state.message}
              </AppText>
            </Tile>
            <Button variant="secondary" title="Reintentar" onPress={today.reload} />
          </>
        ) : null}

        {today.state.status === 'loading' ? (
          <AppText variant="caption" tone="ink2">
            Cargando tu asistencia…
          </AppText>
        ) : null}

        {today.state.status === 'success' ? (
          <>
            <MonthSwitch value={choice} onChange={setChoice} />

            {workdays.state.status === 'loading' ? (
              <AppText variant="caption" tone="ink2">
                Cargando tu asistencia…
              </AppText>
            ) : null}

            {workdays.state.status === 'error' ? (
              <>
                <Tile>
                  <AppText variant="body" tone="danger">
                    {workdays.state.message}
                  </AppText>
                </Tile>
                <Button variant="secondary" title="Reintentar" onPress={workdays.reload} />
              </>
            ) : null}

            {workdays.state.status === 'success' ? (
              <MonthContent data={workdays.state.data} timeZone={today.state.data.timeZone} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MonthSwitch({ value, onChange }: { value: Choice; onChange: (value: Choice) => void }) {
  const palette = usePalette();
  const options: { value: Choice; label: string }[] = [
    { value: 'current', label: 'Este mes' },
    { value: 'previous', label: 'Mes anterior' },
  ];

  return (
    <View style={[styles.switch, { backgroundColor: palette.sunk }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => {
              onChange(option.value);
            }}
            style={[styles.switchOption, selected && { backgroundColor: palette.surface }]}
          >
            <AppText
              tone={selected ? 'ink' : 'ink2'}
              style={{ fontFamily: FONT_FAMILY.sans.semibold, fontSize: 14 }}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthContent({ data, timeZone }: { data: MyWorkdaysDto; timeZone: string }) {
  const summary = monthSummary(data.items);
  // La API los entrega ascendentes; la lista va del más reciente al más antiguo.
  const days = [...data.items].reverse();

  return (
    <>
      <View style={styles.grid}>
        <SummaryTile label="Asistencias" value={String(summary.attended)} />
        <SummaryTile label="Retardos" value={String(summary.late)} tone="warning" />
        <SummaryTile label="Faltas" value={String(summary.absences)} tone="danger" />
        <SummaryTile
          label="Horas extra"
          value={formatMinutes(summary.overtimeMinutes)}
          caption="Medidas, sin autorizar"
        />
      </View>
      {summary.restWorked > 0 ? (
        <Tile>
          <AppText variant="label">Descansos trabajados</AppText>
          <AppText variant="figure">{summary.restWorked}</AppText>
        </Tile>
      ) : null}

      {days.length === 0 ? (
        <AppText variant="caption" tone="ink2">
          No hay jornadas registradas este mes. Las jornadas aparecen cuando cierra cada día.
        </AppText>
      ) : (
        days.map((day) => {
          const view = workdayStatusView(day);
          return (
            <Tile key={day.date}>
              <View style={styles.dayHeader}>
                <AppText variant="bodyStrong">{formatLocalDay(day.date)}</AppText>
                <Chip label={view.label} tone={view.tone} />
              </View>
              {view.detail ? (
                <AppText variant="caption" tone="ink2">
                  {view.detail}
                </AppText>
              ) : null}
              {day.firstPunchAt !== null && day.lastPunchAt !== null ? (
                <AppText variant="bodyStrong" style={styles.mono}>
                  {formatLocalTime(day.firstPunchAt, timeZone)}
                  {day.punchCount > 1 ? `–${formatLocalTime(day.lastPunchAt, timeZone)}` : ''}
                </AppText>
              ) : null}
              <AppText variant="caption" tone="ink2">
                Trabajado {formatMinutes(day.workedMinutes)}
                {day.overtimeMinutes > 0 ? ` · extra ${formatMinutes(day.overtimeMinutes)}` : ''}
              </AppText>
            </Tile>
          );
        })
      )}
    </>
  );
}

function SummaryTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: 'warning' | 'danger';
}) {
  return (
    <Tile style={styles.summaryTile}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="figure" {...(tone ? { tone } : {})}>
        {value}
      </AppText>
      {caption ? (
        <AppText variant="caption" tone="ink2">
          {caption}
        </AppText>
      ) : null}
    </Tile>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 10, gap: 8 },
  switch: { flexDirection: 'row', padding: 4, borderRadius: RADIUS.md, gap: 4 },
  switchOption: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryTile: { flexBasis: '47%', flexGrow: 1 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mono: { fontFamily: FONT_FAMILY.mono.medium },
});
