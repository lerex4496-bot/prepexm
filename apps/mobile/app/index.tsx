import { Redirect } from 'expo-router';

import { useProfile } from '@/store/profile';

/** Entry gate: straight to Today if she has onboarded, otherwise onboarding. */
export default function Index() {
  const onboarded = useProfile((s) => s.profile.onboarded);
  return <Redirect href={onboarded ? '/(tabs)/today' : '/onboarding/welcome'} />;
}
