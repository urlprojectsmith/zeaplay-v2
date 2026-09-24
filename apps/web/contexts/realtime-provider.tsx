'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../stores/session';
import {
  getSharedRealtimeSocket,
  invalidateRealtimeQueries,
  REALTIME_CLIENT_EVENT,
  resetSharedRealtimeSocket,
  subscribeWorkspace,
  unsubscribeWorkspace,
  type RealtimeEventEnvelope,
  type RealtimeStatus,
} from '../services/realtime';

const RealtimeContext = createContext<{ status: RealtimeStatus }>({ status: 'offline' });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((state) => state.accessToken);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const membershipId = useSessionStore(
    (state) =>
      state.agencies
        .flatMap((agency) => agency.workspaces)
        .find((workspace) => workspace.id === state.selectedWorkspaceId)?.membershipId ?? null,
  );
  const [status, setStatus] = useState<RealtimeStatus>('offline');
  const seenEvents = useRef<Map<string, number>>(new Map());
  const workspaceIdRef = useRef(workspaceId);
  const membershipIdRef = useRef(membershipId);
  const disableNetworkRealtime = process.env.NODE_ENV === 'test';

  useEffect(() => {
    workspaceIdRef.current = workspaceId;
    membershipIdRef.current = membershipId;
  }, [membershipId, workspaceId]);

  useEffect(() => {
    if (disableNetworkRealtime) return;
    if (!accessToken) {
      resetSharedRealtimeSocket();
      setStatus('offline');
      return;
    }
    const socket = getSharedRealtimeSocket(accessToken);
    setStatus(socket.connected ? 'connected' : 'connecting');
    const onConnect = () => {
      setStatus('connected');
      const currentWorkspaceId = workspaceIdRef.current;
      if (currentWorkspaceId) {
        subscribeWorkspace(socket, currentWorkspaceId);
        void queryClient.invalidateQueries({ queryKey: ['workspace', currentWorkspaceId] });
      }
    };
    const onDisconnect = () => setStatus('offline');
    const onReconnectAttempt = () => setStatus('reconnecting');
    const onEvent = (event: RealtimeEventEnvelope) => {
      const currentWorkspaceId = workspaceIdRef.current;
      if (!currentWorkspaceId || event.workspaceId !== currentWorkspaceId) return;
      if (isDuplicate(seenEvents.current, event.eventId)) return;
      invalidateRealtimeQueries(queryClient, event, membershipIdRef.current);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on(REALTIME_CLIENT_EVENT, onEvent);
    if (!socket.connected) socket.connect();
    else setStatus('connected');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off(REALTIME_CLIENT_EVENT, onEvent);
    };
  }, [accessToken, disableNetworkRealtime, queryClient]);

  useEffect(() => {
    if (disableNetworkRealtime) return;
    if (!accessToken || !workspaceId) return;
    const socket = getSharedRealtimeSocket(accessToken);
    if (socket.connected) {
      subscribeWorkspace(socket, workspaceId);
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    }
    return () => {
      if (socket.connected) unsubscribeWorkspace(socket);
    };
  }, [accessToken, disableNetworkRealtime, queryClient, workspaceId]);

  const value = useMemo(() => ({ status }), [status]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export const useWorkspaceRealtime = useRealtime;

function isDuplicate(events: Map<string, number>, eventId: string) {
  const now = Date.now();
  for (const [id, seenAt] of events) {
    if (now - seenAt > 5 * 60_000) events.delete(id);
  }
  if (events.has(eventId)) return true;
  events.set(eventId, now);
  return false;
}
