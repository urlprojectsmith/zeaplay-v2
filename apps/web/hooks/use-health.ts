'use client';

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { StandardResponse } from '@zea-play/types';
import { apiClient } from '../services/api';

export function useHealth(): UseQueryResult<StandardResponse<{ status: string }>> {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.request<{ status: string }>('/health'),
  });
}
