import type { Metadata } from 'next';
import { PublicFormPage } from '../../../../components/workspace/forms/PublicFormPage';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicFormRoute({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <PublicFormPage publicId={publicId} />;
}
