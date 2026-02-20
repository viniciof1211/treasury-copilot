import { useState } from 'react';
import { Layout } from '../components/layout/Layout';
import { GitBranch, Activity, Radio, Server, Brain, PenTool } from 'lucide-react';
import { ERDiagramTab } from '../components/datamodel/ERDiagramTab';
import { CDCMonitorTab } from '../components/datamodel/CDCMonitorTab';
import { KafkaMonitorTab } from '../components/datamodel/KafkaMonitorTab';
import { ERPModelTab } from '../components/datamodel/ERPModelTab';
import { FAISSMonitorTab } from '../components/datamodel/FAISSMonitorTab';
import { DataCurationTab } from '../components/datamodel/DataCurationTab';

const TABS = [
  { id: 'er-diagram',   label: 'Modelo ER',       icon: GitBranch, color: 'text-indigo-600' },
  { id: 'cdc-monitor',  label: 'CDC Monitor',      icon: Activity,  color: 'text-emerald-600' },
  { id: 'kafka-monitor', label: 'Kafka Monitor',   icon: Radio,     color: 'text-orange-600' },
  { id: 'erp-model',    label: 'ERP PcGraf',       icon: Server,    color: 'text-blue-600' },
  { id: 'faiss-kb',     label: 'FAISS KB',         icon: Brain,     color: 'text-purple-600' },
  { id: 'curation',     label: 'Curación de Datos', icon: PenTool,  color: 'text-rose-600' },
] as const;

type TabId = typeof TABS[number]['id'];

export function DataModelDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('er-diagram');

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Modelo de Datos & Monitoreo</h1>
          <p className="text-gray-600 mt-1">
            ER Diagram completo, monitoreo CDC/Kafka, modelo ERP semántico, FAISS KB y curación de datos
          </p>
        </div>

        {/* Tab bar */}
        <div className="border-b border-gray-200 bg-white rounded-t-lg shadow-sm">
          <nav className="flex overflow-x-auto -mb-px" aria-label="Tabs">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all ${
                    isActive
                      ? `border-[#1A4A28] ${tab.color} bg-green-50/40`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? tab.color : ''}`} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab content */}
        <div className="min-h-[600px]">
          {activeTab === 'er-diagram'    && <ERDiagramTab />}
          {activeTab === 'cdc-monitor'   && <CDCMonitorTab />}
          {activeTab === 'kafka-monitor' && <KafkaMonitorTab />}
          {activeTab === 'erp-model'     && <ERPModelTab />}
          {activeTab === 'faiss-kb'      && <FAISSMonitorTab />}
          {activeTab === 'curation'      && <DataCurationTab />}
        </div>
      </div>
    </Layout>
  );
}
