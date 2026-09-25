import { PublicDocSharePage } from '../../../../../components/workspace/docs/PublicDocSharePage';

export const metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function PublicShareRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicDocSharePage token={token} />;
}
