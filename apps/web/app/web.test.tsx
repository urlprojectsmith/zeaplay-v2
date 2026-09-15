import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LoginPage from './(public)/login/page';

describe('web smoke', () => {
  it('renders the login foundation route', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
