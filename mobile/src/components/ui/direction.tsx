import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';

type DirectionValue = 'ltr' | 'rtl';
const DirectionContext = createContext<DirectionValue>('ltr');

export function DirectionProvider({ dir = 'ltr', children }: { dir?: DirectionValue; children?: ReactNode }) {
  return <DirectionContext.Provider value={dir}>{children}</DirectionContext.Provider>;
}

export function useDirection() {
  return useContext(DirectionContext);
}
