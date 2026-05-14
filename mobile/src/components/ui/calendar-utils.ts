export type CalendarSelectionMode = 'single' | 'multiple' | 'range';

export type CalendarRange = {
  from?: Date;
  to?: Date;
};

export type CalendarSelection = Date | Date[] | CalendarRange | undefined;

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameCalendarDay(left?: Date, right?: Date) {
  if (!left || !right) return false;
  return startOfDay(left).getTime() === startOfDay(right).getTime();
}

export function isBeforeCalendarDay(left: Date, right: Date) {
  return startOfDay(left).getTime() < startOfDay(right).getTime();
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function buildCalendarMonth(month: Date, weekStartsOn = 0) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const firstWeekday = (firstDay.getDay() - weekStartsOn + 7) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      date,
      isOutside: date.getMonth() !== month.getMonth(),
      isToday: isSameCalendarDay(date, new Date()),
    };
  });
}

export function isDateInRange(date: Date, range?: CalendarRange) {
  if (!range?.from || !range.to) return false;

  const value = startOfDay(date).getTime();
  const from = startOfDay(range.from).getTime();
  const to = startOfDay(range.to).getTime();

  return value >= Math.min(from, to) && value <= Math.max(from, to);
}

export function selectCalendarDate(
  mode: CalendarSelectionMode,
  currentSelection: CalendarSelection,
  date: Date,
): CalendarSelection {
  const selectedDate = startOfDay(date);

  if (mode === 'single') {
    return selectedDate;
  }

  if (mode === 'multiple') {
    const currentDates = Array.isArray(currentSelection) ? currentSelection : [];
    const exists = currentDates.some((currentDate) => isSameCalendarDay(currentDate, selectedDate));
    return exists
      ? currentDates.filter((currentDate) => !isSameCalendarDay(currentDate, selectedDate))
      : [...currentDates, selectedDate];
  }

  const range = isRangeSelection(currentSelection) ? currentSelection : {};
  if (!range.from || range.to) {
    return { from: selectedDate, to: undefined };
  }

  if (isBeforeCalendarDay(selectedDate, range.from)) {
    return { from: selectedDate, to: range.from };
  }

  return { from: range.from, to: selectedDate };
}

export function isRangeSelection(selection: CalendarSelection): selection is CalendarRange {
  return Boolean(selection && !Array.isArray(selection) && !(selection instanceof Date));
}
