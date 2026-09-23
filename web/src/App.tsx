import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ConfirmProvider } from "./components/ConfirmDialog";
import Shell from "./components/Shell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Floorplan from "./pages/Floorplan";
import Inbound from "./pages/Inbound";
import Outbound from "./pages/Outbound";
import Transfer from "./pages/Transfer";
import Damage from "./pages/Damage";
import Stocktake from "./pages/Stocktake";
import Movements from "./pages/Movements";
import Settings from "./pages/Settings";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ConfirmProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Shell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/floorplan" element={<Floorplan />} />
              <Route path="/inbound" element={<Inbound />} />
              <Route path="/outbound" element={<Outbound />} />
              <Route path="/transfer" element={<Transfer />} />
              <Route path="/damage" element={<Damage />} />
              <Route path="/stocktake" element={<Stocktake />} />
              <Route path="/movements" element={<Movements />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </ConfirmProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
