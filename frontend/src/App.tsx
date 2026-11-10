import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAdmin, RequireAuth } from "./auth/guards";
import { Shell } from "./components/Shell";
import { AdminShifts } from "./pages/AdminShifts";
import { Categories } from "./pages/Categories";
import { Expenses } from "./pages/Expenses";
import { Home } from "./pages/Home";
import { Ingredients } from "./pages/Ingredients";
import { Inventory } from "./pages/Inventory";
import { Login } from "./pages/Login";
import { Modifiers } from "./pages/Modifiers";
import { Orders } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { Pos } from "./pages/Pos";
import { PurchaseEditor } from "./pages/PurchaseEditor";
import { Purchases } from "./pages/Purchases";
import { Reports } from "./pages/Reports";
import { ReceiptPage } from "./pages/ReceiptPage";
import { Products } from "./pages/Products";
import { SettingsPage } from "./pages/SettingsPage";
import { ShiftDetailPage } from "./pages/ShiftDetail";
import { ShiftPage } from "./pages/ShiftPage";
import { Suppliers } from "./pages/Suppliers";
import { Users } from "./pages/Users";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="pos" element={<Pos />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="shift" element={<ShiftPage />} />
          <Route path="shift/:id" element={<ShiftDetailPage />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="admin" element={<RequireAdmin />}>
            <Route path="categories" element={<Categories />} />
            <Route path="products" element={<Products />} />
            <Route path="modifiers" element={<Modifiers />} />
            <Route path="ingredients" element={<Ingredients />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="purchases/:id" element={<PurchaseEditor />} />
            <Route path="shifts" element={<AdminShifts />} />
            <Route path="reports" element={<Navigate to="/admin/reports/sales-summary" replace />} />
            <Route path="reports/:name" element={<Reports />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="orders/:id/receipt" element={<ReceiptPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
