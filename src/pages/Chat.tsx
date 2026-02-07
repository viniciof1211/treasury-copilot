import { useState, useRef, useEffect, FormEvent } from 'react';
import { Send, AlertCircle } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { MessageBubble } from '../components/chat/MessageBubble';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import type { ChatMessage } from '../types';

const exampleQuestions = [
  'What is our current cash position and 30-day projection?',
  'Show me priority payables due this month',
  'Analyze receivables aging and overdue accounts',
  'Calculate ROI for our top 3 projects',
];

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversation_id: 'demo',
      role: 'user',
      content: input.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        conversation_id: 'demo',
        role: 'assistant',
        content: `Based on your question about "${input.trim()}", here's my analysis:\n\nThis is a demo response. Once the Edge Functions are deployed with Microsoft Foundry Agent and Google Gemini integrations, this will provide real AI-powered insights with generated visualizations.\n\nThe system will:\n• Analyze your cashflow data using Microsoft Foundry Agent\n• Generate consulting-style visualizations with Google Gemini\n• Display KPIs, tables, and actionable insights`,
        extracted_tables: [
          {
            title: 'Sample Data Analysis',
            columns: ['Metric', 'Current', 'Previous', 'Change'],
            rows: [
              ['Cash Position', '$3.5M', '$3.2M', '+9.4%'],
              ['Payables', '$400K', '$385K', '+3.9%'],
              ['Receivables', '$470K', '$450K', '+4.4%'],
            ],
          },
        ],
        kpis: {
          roi_usd: 125000,
          opex_avoided_usd: 85000,
          revenue_impact_usd: 200000,
          time_to_value_days: 45,
          confidence_0_1: 0.87,
        },
        created_at: new Date().toISOString(),
      };

      setTimeout(() => {
        setMessages((prev) => [...prev, assistantMessage]);
        setLoading(false);
      }, 1500);
    } catch (err) {
      setError('Failed to get AI response. Please try again.');
      setLoading(false);
      console.error('Chat error:', err);
    }
  };

  const handleExampleClick = (question: string) => {
    setInput(question);
  };

  return (
    <Layout>
      <div className="h-[calc(100vh-12rem)] flex flex-col">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">AI Treasury Agent</h1>
          <p className="text-gray-600 mt-1">Ask questions about your cashflow, payables, receivables, and financial projections</p>
        </div>

        {messages.length === 0 && (
          <Card className="p-8 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Try asking:</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {exampleQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => handleExampleClick(question)}
                  className="text-left p-4 rounded-lg border-2 border-gray-200 hover:border-[#1A4A28] hover:bg-green-50 transition-colors"
                >
                  <p className="text-sm text-gray-700">{question}</p>
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {loading && (
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#1A4A28] flex items-center justify-center">
                  <LoadingSpinner size="sm" className="border-white border-t-transparent" />
                </div>
                <div className="flex-1 max-w-3xl">
                  <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4">
                    <p className="text-gray-600">Analyzing your request...</p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <AlertCircle className="w-5 h-5" />
                <p>{error}</p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-gray-200 p-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your treasury data..."
                rows={2}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <Button
                type="submit"
                disabled={!input.trim() || loading}
                className="self-end"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
