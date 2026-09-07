import Studio from '@/components/studio';
import { requireUser } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  await requireUser();
  return <Studio />;
}
