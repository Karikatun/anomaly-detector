import { KeyValueCard } from '@/components/key-value-card';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export default function ProfileScreen() {
  const auth = useAuth();

  if (!auth.user) return null;

  return (
    <Screen centered>
      <PageHeader
        eyebrow="Account"
        title={auth.user.displayName ?? 'Profile'}
        description={auth.user.email}
      />

      <KeyValueCard label="User ID" value={auth.user.id} />

      <Button variant="outline" onPress={() => void auth.logout()}>
        Logout
      </Button>
    </Screen>
  );
}
