/**
 * AG-UI Chat Hook — connects to the LangGraph agent via SSE streaming.
 * Supports: sessions, persistence, images, file upload, KB sync.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallInfo[];
  images?: string[];
  isStreaming?: boolean;
  createdAt: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface UseAgentChatOptions {
  agentUrl?: string;
}

const DEFAULT_AGENT_URL = import.meta.env.VITE_AGENT_URL ?? ''; // empty = relative URL (same origin)

// Extract base64 images from JSON tool results (fallback — primary path is IMAGE SSE event)
function extractImages(text: string): string[] {
  const images: string[] = [];
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.images)) {
      for (const img of parsed.images) {
        if (typeof img === 'string' && img.length > 100 && !img.startsWith('<')) {
          images.push(img);
        }
      }
    }
  } catch { /* not JSON — skip */ }
  return images;
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const { agentUrl = DEFAULT_AGENT_URL } = options;

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Session management
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // KB status
  const [kbSyncing, setKbSyncing] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // ------------------------------------------------------------------
  // Session CRUD
  // ------------------------------------------------------------------
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const resp = await fetch(`${agentUrl}/sessions`);
      if (resp.ok) {
        const data = await resp.json();
        setSessions(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    setSessionsLoading(false);
  }, [agentUrl]);

  const createSession = useCallback(async (title?: string) => {
    try {
      const resp = await fetch(`${agentUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || 'Nueva conversación' }),
      });
      if (resp.ok) {
        const session = await resp.json();
        setSessions((prev) => [session, ...prev]);
        setActiveSessionId(session.id);
        setMessages([]);
        setError(null);
        return session;
      }
    } catch { /* ignore */ }
    return null;
  }, [agentUrl]);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await fetch(`${agentUrl}/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch { /* ignore */ }
  }, [agentUrl, activeSessionId]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    try {
      await fetch(`${agentUrl}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title } : s));
    } catch { /* ignore */ }
  }, [agentUrl]);

  const loadSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setError(null);
    try {
      const resp = await fetch(`${agentUrl}/sessions/${sessionId}/messages`);
      if (resp.ok) {
        const data = await resp.json();
        const msgs: AgentMessage[] = (Array.isArray(data) ? data : []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          role: m.role as 'user' | 'assistant',
          content: m.content as string || '',
          toolCalls: m.tool_calls ? (typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls as string) : m.tool_calls) : [],
          images: m.images ? (typeof m.images === 'string' ? JSON.parse(m.images as string) : m.images) : [],
          createdAt: m.created_at as string || new Date().toISOString(),
        }));
        setMessages(msgs);
      }
    } catch { /* ignore */ }
  }, [agentUrl]);

  // Save a message to the active session
  const persistMessage = useCallback(async (msg: AgentMessage) => {
    if (!activeSessionId) return;
    try {
      await fetch(`${agentUrl}/sessions/${activeSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: msg.role,
          content: msg.content,
          tool_calls: msg.toolCalls || [],
          images: msg.images || [],
        }),
      });
    } catch { /* ignore */ }
  }, [agentUrl, activeSessionId]);

  // Load sessions on mount
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  // ------------------------------------------------------------------
  // Send message + SSE streaming
  // ------------------------------------------------------------------
  const sendMessage = useCallback(
    async (userContent: string) => {
      if (!userContent.trim() || isLoading) return;

      // Auto-create session if none active
      let sessionId = activeSessionId;
      if (!sessionId) {
        const firstWords = userContent.trim().split(/\s+/).slice(0, 5).join(' ');
        const session = await createSession(firstWords.length > 40 ? firstWords.slice(0, 40) + '…' : firstWords);
        if (session) sessionId = session.id;
      }

      setError(null);

      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userContent,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      // Persist user message
      if (sessionId) {
        persistMessage(userMsg);
      }

      // Build message history for the agent — limit to last 20 messages
      const allMsgs = [...messages, userMsg];
      const recentMsgs = allMsgs.slice(-20);
      const historyForAgent = recentMsgs.map((m) => ({
        role: m.role,
        content: m.content.length > 4000 ? m.content.slice(0, 4000) + '\n[...truncado...]' : m.content,
      }));

      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: AgentMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        images: [],
        isStreaming: true,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      let finalContent = '';
      const collectedImages: string[] = [];

      try {
        const response = await fetch(`${agentUrl}/agent/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: historyForAgent,
            threadId: sessionId || 'default',
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Agent error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              const dataStr = line.slice(6).trim();
              try {
                const data = JSON.parse(dataStr);

                switch (currentEvent) {
                  case 'TEXT_MESSAGE_CONTENT': {
                    const delta = (data.delta as string) || '';
                    finalContent += delta;
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, content: m.content + delta }
                          : m
                      )
                    );
                    break;
                  }

                  case 'TOOL_CALL_START': {
                    const toolCall: ToolCallInfo = {
                      id: (data.toolCallId as string) || crypto.randomUUID(),
                      name: (data.toolCallName as string) || 'unknown',
                      args: (data.args as Record<string, unknown>) || {},
                      status: 'running',
                    };
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMsgId
                          ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] }
                          : m
                      )
                    );
                    break;
                  }

                  case 'TOOL_CALL_END': {
                    const toolCallId = data.toolCallId as string;
                    const result = (data.result as string) || '';
                    // Extract images from tool results
                    const toolImgs = extractImages(result);
                    if (toolImgs.length) collectedImages.push(...toolImgs);
                    setMessages((prev) =>
                      prev.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              toolCalls: (m.toolCalls || []).map((tc) =>
                                tc.id === toolCallId
                                  ? { ...tc, result, status: 'done' as const }
                                  : tc
                              ),
                              images: [...(m.images || []), ...toolImgs],
                            }
                          : m
                      )
                    );
                    break;
                  }

                  case 'IMAGE': {
                    const imgBase64 = (data.base64 as string) || '';
                    if (imgBase64.length > 100) {
                      collectedImages.push(imgBase64);
                      setMessages((prev) =>
                        prev.map((m) =>
                          m.id === assistantMsgId
                            ? { ...m, images: [...(m.images || []), imgBase64] }
                            : m
                        )
                      );
                    }
                    break;
                  }

                  default:
                    break;
                }
              } catch { /* skip malformed JSON */ }
              currentEvent = '';
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User cancelled
        } else {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error';
          setError(errorMsg);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content || `⚠️ Error: ${errorMsg}`, isStreaming: false }
                : m
            )
          );
        }
      } finally {
        setIsLoading(false);
        abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, isStreaming: false } : m
          )
        );

        // Persist assistant message
        if (sessionId && finalContent) {
          persistMessage({
            id: assistantMsgId,
            role: 'assistant',
            content: finalContent,
            images: collectedImages,
            createdAt: new Date().toISOString(),
          });
        }
      }
    },
    [messages, isLoading, agentUrl, activeSessionId, createSession, persistMessage]
  );

  // ------------------------------------------------------------------
  // KB operations
  // ------------------------------------------------------------------
  const syncKB = useCallback(async () => {
    setKbSyncing(true);
    try {
      const resp = await fetch(`${agentUrl}/kb/sync`, { method: 'POST' });
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
    } catch { /* ignore */ }
    finally { setKbSyncing(false); }
    return null;
  }, [agentUrl]);

  const uploadFileToKB = useCallback(async (file: File) => {
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(`${agentUrl}/kb/upload`, {
        method: 'POST',
        body: formData,
      });
      if (resp.ok) {
        const data = await resp.json();
        return data;
      }
    } catch { /* ignore */ }
    finally { setUploadingFile(false); }
    return null;
  }, [agentUrl]);

  // ------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------
  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setActiveSessionId(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    stopGeneration,
    clearMessages,
    // Sessions
    sessions,
    sessionsLoading,
    activeSessionId,
    fetchSessions,
    createSession,
    deleteSession,
    renameSession,
    loadSession,
    // KB
    syncKB,
    kbSyncing,
    uploadFileToKB,
    uploadingFile,
  };
}
