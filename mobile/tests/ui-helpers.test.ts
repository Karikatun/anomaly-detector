import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';

import {
  buildCalendarMonth,
  isDateInRange,
  selectCalendarDate,
} from '../src/components/ui/calendar-utils';
import { getControllableValue } from '../src/components/ui/controllable-state';
import { getOtpSlots, normalizeOtpValue } from '../src/components/ui/input-otp-utils';
import { clampSliderValue, normalizeSliderValues } from '../src/components/ui/slider-utils';
import { mapTextChildren } from '../src/components/ui/text-utils';
import { MIN_TOUCH_TARGET } from '../src/components/ui/touch-target';

test('controlled state prefers explicit values over defaults', () => {
  expect(getControllableValue('controlled', 'fallback')).toBe('controlled');
  expect(getControllableValue(undefined, 'fallback')).toBe('fallback');
});

test('text child renderer wraps mixed raw strings for native containers', () => {
  const rendered = React.Children.toArray(
    mapTextChildren(['Profile', React.createElement(React.Fragment, { key: 'shortcut' })], (child) =>
      React.createElement('Text', null, child),
    ),
  );

  expect(rendered).toHaveLength(2);
  expect(typeof rendered[0]).not.toBe('string');
  expect(React.isValidElement(rendered[0])).toBe(true);
});

test('minimum touch target follows mobile accessibility baseline', () => {
  expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
});

test('interactive primitives use the shared touch target constant', () => {
  const uiRoot = resolve(import.meta.dir, '../src/components/ui');
  const interactiveFiles = [
    'button.tsx',
    'calendar.tsx',
    'checkbox.tsx',
    'command.tsx',
    'menu-primitives.tsx',
    'navigation-menu.tsx',
    'radio-group.tsx',
    'select.tsx',
    'switch.tsx',
  ];

  for (const file of interactiveFiles) {
    expect(readFileSync(resolve(uiRoot, file), 'utf8')).toContain('MIN_TOUCH_TARGET');
  }
});

test('OTP helper normalizes whitespace and caps slot count', () => {
  expect(normalizeOtpValue('12 34 56', 4)).toBe('1234');
  expect(getOtpSlots('12', 4)).toEqual(['1', '2', '', '']);
});

test('slider helper clamps and snaps values to step', () => {
  expect(clampSliderValue(11.2, 0, 10, 0.5)).toBe(10);
  expect(clampSliderValue(4.3, 0, 10, 2)).toBe(4);
  expect(normalizeSliderValues([9, 2, 11], 0, 10, 1)).toEqual([2, 9, 10]);
});

test('calendar helper builds a six-week grid and selects ranges', () => {
  const month = buildCalendarMonth(new Date(2026, 4, 1));
  expect(month).toHaveLength(42);
  expect(month[0]?.date.getDay()).toBe(0);

  const first = new Date(2026, 4, 14);
  const second = new Date(2026, 4, 18);
  const partial = selectCalendarDate('range', undefined, first);
  const complete = selectCalendarDate('range', partial, second);

  expect(isDateInRange(new Date(2026, 4, 16), complete as { from: Date; to: Date })).toBe(true);
});
