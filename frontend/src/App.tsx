import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAdmin, RequireAuth } from "./auth/guards";
import { Shell } from "./components/Shell";
import { Categories } from "./pages/Categories";
import { Home } from "./pages/Home";
import { Ingredients } from "./pages/Ingredients";
import { Inventory } from "./pages/Inventory";
import { Login } from "./pages/Login";
import { Modifiers } from "./pages/Modifiers";
import { Orders } from "./pages/Orders";
import { OrderDetailPage } from "./pages/OrderDetail";
import { Pos } from "./pages/Pos";
import { ReceiptPage } from "./pages/ReceiptPage";
import { Products } from "./pages/Products";
import { SettingsPage } from "./pages/SettingsPage";
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
          <Route path="admin" element={<RequireAdmin />}>
            <Route path="categories" element={<Categories />} />
            <Route path="products" element={<Products />} />
            <Route path="modifiers" element={<Modifiers />} />
            <Route path="ingredients" element={<Ingredients />} />
            <Route path="inventory" element={<Inventory />} />
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
