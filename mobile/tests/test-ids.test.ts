import { expect, test } from 'bun:test';

import { TEST_IDS } from '../src/constants/testIds';

test('navigation test IDs cover tab and details flows', () => {
  expect(TEST_IDS.tabs.componentsTab).toBe('tabs.components');
  expect(TEST_IDS.tabs.profileTab).toBe('tabs.profile');
  expect(TEST_IDS.details.openButton).toBe('details.open-button');
  expect(TEST_IDS.details.backButton).toBe('details.back-button');
  expect(TEST_IDS.details.screen).toBe('details.screen');
  expect(TEST_IDS.screen.backButton).toBe('screen.back-button');
});
