import React, { type ReactNode } from 'react';

export function mapTextChildren(
  children: ReactNode,
  wrapText: (child: string | number, index: number) => ReactNode,
) {
  let textIndex = 0;

  return React.Children.map(children, (child) => {
    if (typeof child !== 'string' && typeof child !== 'number') {
      return child;
    }

    const wrapped = wrapText(child, textIndex);
    textIndex += 1;
    return wrapped;
  });
}
