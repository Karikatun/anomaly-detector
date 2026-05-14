import { useMemo, useState } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Button } from './button';
import {
  buildCalendarMonth,
  isDateInRange,
  isRangeSelection,
  isSameCalendarDay,
  selectCalendarDate,
  type CalendarSelection,
  type CalendarSelectionMode,
} from './calendar-utils';
import { useControllableState } from './controllable-state';
import { UiPressable, UiText } from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

export function Calendar({
  month,
  defaultMonth = new Date(),
  selected,
  mode = 'single',
  onSelect,
  disabled,
  showOutsideDays = true,
  style,
  ...props
}: ViewProps & {
  month?: Date;
  defaultMonth?: Date;
  selected?: CalendarSelection;
  mode?: CalendarSelectionMode;
  onSelect?: (selection: CalendarSelection) => void;
  disabled?: (date: Date) => boolean;
  showOutsideDays?: boolean;
}) {
  const theme = useUiTheme();
  const [visibleMonth, setVisibleMonth] = useState(month ?? defaultMonth);
  const [selection, setSelection] = useControllableState<CalendarSelection>({
    value: selected,
    defaultValue: undefined,
    onChange: onSelect,
  });
  const dates = useMemo(() => buildCalendarMonth(visibleMonth), [visibleMonth]);
  const monthLabel = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <View {...props} style={[styles.calendar, { gap: theme.spacing.md }, style]}>
      <View style={styles.header}>
        <Button size="icon-sm" variant="ghost" onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          {'<'}
        </Button>
        <UiText variant="sm" weight="700">
          {monthLabel}
        </UiText>
        <Button size="icon-sm" variant="ghost" onPress={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
          {'>'}
        </Button>
      </View>
      <View style={styles.weekdays}>
        {WEEKDAYS.map((day) => (
          <UiText key={day} variant="xs" muted style={styles.weekday}>
            {day}
          </UiText>
        ))}
      </View>
      <View style={styles.grid}>
        {dates.map(({ date, isOutside, isToday }) => {
          const isDisabled = disabled?.(date) || (!showOutsideDays && isOutside);
          const isSelected = isDateSelected(date, selection);
          const inRange = isRangeSelection(selection) && isDateInRange(date, selection);

          return (
            <CalendarDayButton
              key={date.toISOString()}
              date={date}
              disabled={isDisabled}
              outside={isOutside}
              selected={isSelected}
              today={isToday}
              inRange={inRange}
              onPress={() => {
                if (!isDisabled) {
                  setSelection(selectCalendarDate(mode, selection, date));
                }
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

export function CalendarDayButton({
  date,
  selected,
  today,
  outside,
  inRange,
  disabled,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  date: Date;
  selected?: boolean;
  today?: boolean;
  outside?: boolean;
  inRange?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useUiTheme();
  const isDisabled = disabled === true;
  const isSelected = selected === true;

  return (
    <UiPressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
      disabled={disabled}
      style={[
        styles.day,
        {
          backgroundColor: isSelected
            ? theme.colors.primary
            : inRange || today
              ? theme.colors.muted
              : theme.colors.transparent,
          borderColor: today ? theme.colors.border : theme.colors.transparent,
          borderRadius: theme.radius.full,
          opacity: isDisabled || outside ? theme.opacity.muted : 1,
        },
        style,
      ]}>
      <UiText
        variant="sm"
        weight={isSelected ? '700' : '500'}
        style={{ color: isSelected ? theme.colors.primaryForeground : theme.colors.foreground }}>
        {date.getDate()}
      </UiText>
    </UiPressable>
  );
}

function isDateSelected(date: Date, selection: CalendarSelection) {
  if (selection instanceof Date) return isSameCalendarDay(date, selection);
  if (Array.isArray(selection)) return selection.some((selectedDate) => isSameCalendarDay(date, selectedDate));
  if (isRangeSelection(selection)) {
    return isSameCalendarDay(date, selection.from) || isSameCalendarDay(date, selection.to);
  }
  return false;
}

const styles = StyleSheet.create({
  calendar: {
    width: 320,
  },
  day: {
    alignItems: 'center',
    borderWidth: 1,
    height: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    width: `${100 / 7}%`,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekday: {
    textAlign: 'center',
    width: `${100 / 7}%`,
  },
  weekdays: {
    flexDirection: 'row',
  },
});
