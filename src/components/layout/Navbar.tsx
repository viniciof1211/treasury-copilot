import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, MessageSquare, Database, Briefcase, Settings, Landmark, Target, ShoppingCart, Receipt, Presentation, GitBranch, FileText, Shield } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const navigation = [
  { name: 'Panel Ejecutivo', href: '/', icon: LayoutDashboard },
  { name: 'Cashflow', href: '/cashflow', icon: Target },
  { name: 'Ingresos / CxC', href: '/ingresos', icon: Receipt },
  { name: 'Crédito', href: '/credito', icon: Landmark },
  { name: 'Compras', href: '/compras', icon: ShoppingCart },
  { name: 'Junta Directiva', href: '/board', icon: Presentation },
  { name: 'AI Chat', href: '/chat', icon: MessageSquare },
  { name: 'Fuentes de Datos', href: '/data', icon: Database },
  { name: 'Modelo de Datos', href: '/data-model', icon: GitBranch },
  { name: 'Proyectos', href: '/projects', icon: Briefcase },
  { name: 'ERP Módulos', href: '/erp', icon: FileText },
  { name: 'TMS', href: '/tms', icon: Shield },
  { name: 'Admin', href: '/admin', icon: Settings },
];

export function Navbar() {
  const location = useLocation();
  const { user } = useAuth();

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[#1A4A28] rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-lg">ARA</span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Treasury AI</h1>
                  <p className="text-xs text-gray-500">Cashflow Management</p>
                </div>
              </div>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                      isActive
                        ? 'text-[#1A4A28] bg-green-50'
                        : 'text-gray-700 hover:text-[#1A4A28] hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
              <p className="text-xs text-gray-500 capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
