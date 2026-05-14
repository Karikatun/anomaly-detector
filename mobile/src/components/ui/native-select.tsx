import type { ReactNode } from 'react';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import {
  createOptionRegistrationId,
  createOptionRegistryController,
  getRegisteredOptions,
  type RegisteredOption,
  type RegisteredOptionEntry,
} from './option-registry';
import { OverlayFrame, UiPressable, Typography } from './primitives';
import { Separator } from './separator';

type NativeSelectOptionValue = RegisteredOption;

type NativeSelectContextValue = {
  value?: string;
  setValue: (value: string) => void;
  options: NativeSelectOptionValue[];
  registerOption: (id: string, option: NativeSelectOptionValue) => void;
  unregisterOption: (id: string) => void;
};

const NativeSelectContext = createContext<NativeSelectContextValue | null>(null);

export function NativeSelect({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Select',
  children,
  style,
  ...props
}: ViewProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });
  const [open, setOpen] = useState(false);
  const [optionEntries, setOptionEntries] = useState<RegisteredOptionEntry[]>([]);
  const currentValueRef = useRef(currentValue);
  const setValueRef = useRef(setValue);
  const registryRef = useRef<ReturnType<typeof createOptionRegistryController> | null>(null);
  currentValueRef.current = currentValue;
  setValueRef.current = setValue;

  const options = useMemo(() => getRegisteredOptions(optionEntries), [optionEntries]);
  const selected = options.find((option) => option.value === currentValue);

  if (!registryRef.current) {
    registryRef.current = createOptionRegistryController({
      getCurrentValue: () => currentValueRef.current,
      onEntriesChange: setOptionEntries,
      setValue: (nextValue) => setValueRef.current(nextValue),
    });
  }

  const registerOption = useCallback((id: string, option: NativeSelectOptionValue) => {
    registryRef.current?.register(id, option);
  }, []);
  const unregisterOption = useCallback((id: string) => {
    registryRef.current?.unregister(id);
  }, []);

  useEffect(() => {
    return () => registryRef.current?.dispose();
  }, []);

  const context = useMemo<NativeSelectContextValue>(
    () => ({
      value: currentValue,
      setValue: (nextValue: string) => setValue(nextValue),
      options,
      registerOption,
      unregisterOption,
    }),
    [currentValue, options, registerOption, setValue, unregisterOption],
  );

  return (
    <NativeSelectContext.Provider value={context}>
      <View {...props} style={style}>
        <Button variant="outline" onPress={() => setOpen(true)}>
          {selected?.label ?? placeholder}
          {' v'}
        </Button>
        <View style={styles.hidden}>{children}</View>
        <OverlayFrame visible={open} onRequestClose={() => setOpen(false)} scrollable>
          <View style={styles.menu}>
            {options.map((option) => (
              <UiPressable
                key={option.value}
                disabled={option.disabled}
                style={styles.option}
                onPress={() => {
                  setValue(option.value);
                  setOpen(false);
                }}>
                <Typography weight={option.value === currentValue ? '700' : '500'}>{option.label}</Typography>
              </UiPressable>
            ))}
          </View>
        </OverlayFrame>
      </View>
    </NativeSelectContext.Provider>
  );
}

export function NativeSelectOptGroup({ children, label, style, ...props }: ViewProps & { label?: ReactNode; children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {label ? <Typography variant="caption" muted weight="700">{label}</Typography> : null}
      {children}
      <Separator />
    </View>
  );
}

export function NativeSelectOption({
  value,
  children,
  disabled,
}: PressableProps & { value: string; children?: ReactNode }) {
  const context = useContext(NativeSelectContext);
  const optionIdRef = useRef(createOptionRegistrationId());
  const registerOption = context?.registerOption;
  const unregisterOption = context?.unregisterOption;

  useEffect(() => {
    registerOption?.(optionIdRef.current, { value, label: children ?? value, disabled: disabled === true });
  }, [children, disabled, registerOption, value]);

  useEffect(() => {
    const optionId = optionIdRef.current;
    return () => unregisterOption?.(optionId);
  }, [unregisterOption]);

  return null;
}

const styles = StyleSheet.create({
  group: {
    gap: 6,
  },
  hidden: {
    display: 'none',
  },
  menu: {
    gap: 4,
  },
  option: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
