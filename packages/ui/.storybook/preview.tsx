import type { Preview } from '@storybook/react';
import React from 'react';
import '../src/storybook.css';

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
  },
  decorators: [
    (Story) => (
      <div className="sb-themes">
        {(['light', 'dark', 'colorful'] as const).map((theme) => (
          <section key={theme} data-theme={theme}>
            <p className="sb-label">{theme}</p>
            <Story />
          </section>
        ))}
      </div>
    ),
  ],
};

export default preview;
