import type { Meta, StoryObj } from '@storybook/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';

const meta = { title: 'Primitives/Card', component: Card } satisfies Meta<typeof Card>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Dashboard foundation</CardTitle>
        <CardDescription>Reusable shell and theme-ready surface.</CardDescription>
      </CardHeader>
      <CardContent>Content inherits semantic tokens.</CardContent>
    </Card>
  ),
};
