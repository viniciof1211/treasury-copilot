import { User, Bot, Download, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../lib/utils';
import type { ChatMessage } from '../../types';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-600' : 'bg-[#1A4A28]'
      }`}>
        {isUser ? <User className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
      </div>

      <div className={`flex-1 max-w-3xl ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`rounded-2xl px-6 py-4 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-white border border-gray-200 text-gray-900'
        }`}>
          <div className="prose prose-sm max-w-none">
            {message.content.split('\n').map((line, idx) => (
              <p key={idx} className={`${isUser ? 'text-white' : 'text-gray-900'} mb-2 last:mb-0`}>
                {line}
              </p>
            ))}
          </div>

          {message.extracted_tables && message.extracted_tables.length > 0 && (
            <div className="mt-4 space-y-4">
              {message.extracted_tables.map((table, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-4 overflow-x-auto">
                  {table.title && (
                    <h4 className="font-semibold text-gray-900 mb-3">{table.title}</h4>
                  )}
                  <table className="min-w-full divide-y divide-gray-300">
                    <thead>
                      <tr>
                        {table.columns.map((col, colIdx) => (
                          <th
                            key={colIdx}
                            className="px-3 py-2 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {table.rows.map((row, rowIdx) => (
                        <tr key={rowIdx}>
                          {row.map((cell, cellIdx) => (
                            <td key={cellIdx} className="px-3 py-2 text-sm text-gray-700">
                              {typeof cell === 'number' ? cell.toLocaleString() : cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {message.kpis && (
            <div className="mt-4 flex flex-wrap gap-2">
              {message.kpis.roi_usd !== undefined && (
                <Badge variant="success">
                  ROI: {formatCurrency(message.kpis.roi_usd)}
                </Badge>
              )}
              {message.kpis.opex_avoided_usd !== undefined && (
                <Badge variant="info">
                  OpEx Saved: {formatCurrency(message.kpis.opex_avoided_usd)}
                </Badge>
              )}
              {message.kpis.revenue_impact_usd !== undefined && (
                <Badge variant="success">
                  Revenue Impact: {formatCurrency(message.kpis.revenue_impact_usd)}
                </Badge>
              )}
              {message.kpis.time_to_value_days !== undefined && (
                <Badge variant="warning">
                  Time to Value: {message.kpis.time_to_value_days}d
                </Badge>
              )}
              {message.kpis.confidence_0_1 !== undefined && (
                <Badge variant="default">
                  Confidence: {(message.kpis.confidence_0_1 * 100).toFixed(0)}%
                </Badge>
              )}
            </div>
          )}

          {message.image_url && (
            <div className="mt-4 space-y-3">
              <div className="bg-gray-50 rounded-lg p-4">
                <img
                  src={message.image_url}
                  alt={message.image_alt_text || 'AI-generated insight visualization'}
                  className="w-full rounded-lg"
                />
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(message.image_url, '_blank')}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = message.image_url!;
                      link.download = 'treasury-insight.png';
                      link.click();
                    }}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>

              {message.image_prompt && (
                <div className="bg-gray-50 rounded-lg">
                  <button
                    onClick={() => setShowPrompt(!showPrompt)}
                    className="w-full px-4 py-2 flex items-center justify-between text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <span className="font-medium">Image Generation Prompt</span>
                    {showPrompt ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {showPrompt && (
                    <div className="px-4 pb-3 pt-1">
                      <p className="text-sm text-gray-600 italic">{message.image_prompt}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <span className="text-xs text-gray-500 mt-1 px-2">
          {new Date(message.created_at).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
