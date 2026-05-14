import { Screen } from '@/components/screen';
import { Spinner } from '@/components/ui/spinner';

export function ScreenLoader() {
  return (
    <Screen centered padded={false}>
      <Spinner />
    </Screen>
  );
}
