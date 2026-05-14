import type { ReactNode } from 'react';

export type RegisteredOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type RegisteredOptionEntry = RegisteredOption & {
  id: string;
};

let optionRegistrationId = 0;

export function createOptionRegistrationId() {
  optionRegistrationId += 1;
  return `option-${optionRegistrationId}`;
}

export function upsertRegisteredOption<TOption extends RegisteredOption>(
  options: TOption[],
  option: TOption,
) {
  const index = options.findIndex((currentOption) => currentOption.value === option.value);

  if (index === -1) {
    return [...options, option];
  }

  const currentOption = options[index];
  if (currentOption?.label === option.label && currentOption.disabled === option.disabled) {
    return options;
  }

  const nextOptions = [...options];
  nextOptions[index] = option;
  return nextOptions;
}

export function unregisterRegisteredOption<TOption extends RegisteredOption>(
  options: TOption[],
  value: string,
) {
  return options.filter((option) => option.value !== value);
}

export function hasRegisteredOption(options: RegisteredOption[], value?: string) {
  return Boolean(value && options.some((option) => option.value === value));
}

export function getValueAfterOptionUnregister(currentValue: string, removedValue: string) {
  return currentValue === removedValue ? '' : currentValue;
}

export function upsertRegisteredOptionEntry(
  entries: RegisteredOptionEntry[],
  id: string,
  option: RegisteredOption,
) {
  const entry = { id, ...option };
  const index = entries.findIndex((currentEntry) => currentEntry.id === id);

  if (index === -1) {
    return [...entries, entry];
  }

  const currentEntry = entries[index];
  if (
    currentEntry?.value === option.value &&
    currentEntry.label === option.label &&
    currentEntry.disabled === option.disabled
  ) {
    return entries;
  }

  const nextEntries = [...entries];
  nextEntries[index] = entry;
  return nextEntries;
}

export function unregisterRegisteredOptionEntry(entries: RegisteredOptionEntry[], id: string) {
  return entries.filter((entry) => entry.id !== id);
}

export function getRegisteredOptions(entries: RegisteredOptionEntry[]) {
  const optionsByValue = new Map<string, RegisteredOption>();

  for (const entry of entries) {
    optionsByValue.set(entry.value, {
      value: entry.value,
      label: entry.label,
      disabled: entry.disabled,
    });
  }

  return Array.from(optionsByValue.values());
}

export function getValueAfterOptionRegistrySettles(
  currentValue: string,
  entries: RegisteredOptionEntry[],
) {
  return entries.some((entry) => entry.value === currentValue) ? currentValue : '';
}

export function createOptionRegistryController({
  getCurrentValue,
  onEntriesChange,
  setValue,
}: {
  getCurrentValue: () => string;
  onEntriesChange: (entries: RegisteredOptionEntry[]) => void;
  setValue: (value: string) => void;
}) {
  let entries: RegisteredOptionEntry[] = [];
  let isDisposed = false;
  let validationTimeout: ReturnType<typeof setTimeout> | null = null;

  function setEntries(updater: (currentEntries: RegisteredOptionEntry[]) => RegisteredOptionEntry[]) {
    if (isDisposed) return;

    entries = updater(entries);
    onEntriesChange(entries);
  }

  function validateAfterEffects() {
    if (isDisposed) return;

    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }

    validationTimeout = setTimeout(() => {
      if (isDisposed) return;

      validationTimeout = null;
      const currentValue = getCurrentValue();
      const nextValue = getValueAfterOptionRegistrySettles(currentValue, entries);

      if (nextValue !== currentValue) {
        setValue(nextValue);
      }
    }, 0);
  }

  return {
    dispose() {
      isDisposed = true;
      if (validationTimeout) {
        clearTimeout(validationTimeout);
        validationTimeout = null;
      }
    },
    getEntries() {
      return entries;
    },
    register(id: string, option: RegisteredOption) {
      setEntries((currentEntries) => upsertRegisteredOptionEntry(currentEntries, id, option));
      validateAfterEffects();
    },
    unregister(id: string) {
      setEntries((currentEntries) => unregisterRegisteredOptionEntry(currentEntries, id));
      validateAfterEffects();
    },
  };
}
