import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { CashflowDashboard } from './pages/CashflowDashboard';
import { CreditDashboard } from './pages/CreditDashboard';
import { ComprasDashboard } from './pages/ComprasDashboard';
import { IngresosDashboard } from './pages/IngresosDashboard';
import { BoardPresentation } from './pages/BoardPresentation';
import { Chat } from './pages/Chat';
import { DataSources } from './pages/DataSources';
import { DataModelDashboard } from './pages/DataModelDashboard';
import { Projects } from './pages/Projects';
import { Admin } from './pages/Admin';
import { ensureStorageBuckets } from './lib/supabase';

function App() {
  useEffect(() => {
    ensureStorageBuckets();
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cashflow" element={<CashflowDashboard />} />
          <Route path="/credito" element={<CreditDashboard />} />
          <Route path="/compras" element={<ComprasDashboard />} />
          <Route path="/ingresos" element={<IngresosDashboard />} />
          <Route path="/board" element={<BoardPresentation />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/data" element={<DataSources />} />
          <Route path="/data-model" element={<DataModelDashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
