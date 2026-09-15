import type { Meta, StoryObj } from '@storybook/react';
import { Input } from './input';

const meta = { title: 'Primitives/Input', component: Input } satisfies Meta<typeof Input>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="grid max-w-sm gap-4">
      <Input label="Name" placeholder="Agency name" />
      <Input label="Required" required />
      <Input label="Error" error="This field is required" />
      <Input label="Disabled" disabled value="Locked" />
    </div>
  ),
};
