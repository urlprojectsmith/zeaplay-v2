import type { Meta, StoryObj } from '@storybook/react';
import { Button } from './button';
import { EmptyState } from './empty-state';

const meta = { title: 'Primitives/EmptyState', component: EmptyState } satisfies Meta<
  typeof EmptyState
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {
    title: 'No modules enabled',
  },
  render: () => (
    <EmptyState
      title="No modules enabled"
      description="Feature visibility is ready for backend entitlements."
      action={<Button variant="outline">Review settings</Button>}
    />
  ),
};
