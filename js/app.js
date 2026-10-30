/* ==========================================================================
   DRIP CAFÉ ERP — APPLICATION CONTROLLER & VIEW RENDERERS
   Production-grade operational workflows & touch-optimized interface
   ========================================================================== */

import { store } from './store.js';

class DripApp {
  constructor() {
    this.currentView = 'overview';
    this.selectedCat = 'all';
    this.selectedInvoiceId = 'INV-0042';
    this.selectedReceiptId = 'RCV-0028';
    this.selectedProductId = 'french-coffee';
    this.selectedRole = 'Barista';
    this.selectedModifierItem = null;
    this.activeSettingsTab = 'branch';
    this.posMobileTab = 'menu';

    this.init();
  }

  init() {
    // Subscribe to store updates for reactive re-rendering
    store.subscribe(() => {
      this.render();
    });

    this.bindGlobalEvents();

    const validViews = [
      'overview', 'pos', 'events', 'cashier-signin', 'session-open',
      'session-close', 'inventory', 'recipes', 'suppliers', 'invoices',
      'team', 'settings'
    ];
    const initialHash = window.location.hash.replace('#', '').trim();
    if (initialHash && validViews.includes(initialHash)) {
      this.navigateTo(initialHash);
    } else {
      this.render();
    }

    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '').trim();
      if (hash && hash !== this.currentView && validViews.includes(hash)) {
        this.navigateTo(hash);
      }
    });
  }

  bindGlobalEvents() {
    // Navigation items
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetView = link.getAttribute('data-view');
        this.navigateTo(targetView);
      });
    });

    // Reset Demo Button
    document.getElementById('btn-reset-demo').addEventListener('click', () => {
      if (confirm('Restore sample branch data back to default records?')) {
        store.resetToDefaults();
        this.showToast('Sample records restored to defaults.');
      }
    });

    // Brand logo returns to overview
    document.getElementById('nav-brand').addEventListener('click', () => {
      this.navigateTo('overview');
    });

    // Sidebar drawer toggling for mobile & tablets
    const appEl = document.getElementById('app');
    document.getElementById('btn-toggle-sidebar')?.addEventListener('click', () => {
      appEl?.classList.toggle('sidebar-open');
    });

    document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
      appEl?.classList.remove('sidebar-open');
    });

    document.getElementById('btn-close-sidebar')?.addEventListener('click', () => {
      appEl?.classList.remove('sidebar-open');
    });

    // Branch selector opens settings
    document.getElementById('branch-selector').addEventListener('click', () => {
      this.navigateTo('settings');
    });

    // Setup guide trigger
    document.getElementById('btn-open-setup-guide').addEventListener('click', (e) => {
      e.preventDefault();
      this.showSetupGuideModal();
    });

    // User profile badge
    document.getElementById('current-user-card').addEventListener('click', () => {
      this.navigateTo('team');
    });

    // Header buttons
    document.getElementById('btn-header-help').addEventListener('click', () => {
      this.showSetupGuideModal();
    });

    document.getElementById('btn-header-notifications').addEventListener('click', () => {
      this.showToast('1 pending delivery (RCV-0028) and 3 low stock alerts.');
    });
  }

  navigateTo(viewName) {
    this.currentView = viewName;
    document.getElementById('app')?.classList.remove('sidebar-open');

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
      if (link.getAttribute('data-view') === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update breadcrumb
    const breadcrumbEl = document.getElementById('app-breadcrumbs');
    const viewTitles = {
      overview: 'Operations overview',
      pos: 'Barista POS',
      events: 'Outside events & catering',
      'cashier-signin': 'POS · Cashier sign-in',
      'session-open': 'Register sessions · Open session',
      'session-close': 'Register sessions · Session summary & close',
      inventory: 'Inventory & warehouses',
      recipes: 'Products & recipes',
      suppliers: 'Suppliers & receiving',
      invoices: 'Sales invoices & payments',
      team: 'Team & permissions',
      settings: 'Admin settings'
    };
    breadcrumbEl.innerHTML = `<span>Workspace</span><span>/</span><span class="current">${viewTitles[viewName] || viewName}</span>`;

    if (window.location.hash !== '#' + viewName) {
      history.replaceState(null, '', '#' + viewName);
    }

    this.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  render() {
    const container = document.getElementById('view-content');
    const state = store.getState();

    switch (this.currentView) {
      case 'overview':
        container.innerHTML = this.renderOverviewView(state);
        this.bindOverviewEvents();
        break;
      case 'pos':
        container.innerHTML = this.renderPosView(state);
        this.bindPosEvents();
        break;
      case 'events':
        container.innerHTML = this.renderEventsView(state);
        this.bindEventsViewEvents();
        break;
      case 'cashier-signin':
        container.innerHTML = this.renderCashierSignInView(state);
        this.bindCashierSignInEvents();
        break;
      case 'session-open':
        container.innerHTML = this.renderSessionOpenView(state);
        this.bindSessionOpenEvents();
        break;
      case 'session-close':
        container.innerHTML = this.renderSessionCloseView(state);
        this.bindSessionCloseEvents();
        break;
      case 'inventory':
        container.innerHTML = this.renderInventoryView(state);
        this.bindInventoryEvents();
        break;
      case 'recipes':
        container.innerHTML = this.renderRecipesView(state);
        this.bindRecipesEvents();
        break;
      case 'suppliers':
        container.innerHTML = this.renderSuppliersView(state);
        this.bindSuppliersEvents();
        break;
      case 'invoices':
        container.innerHTML = this.renderInvoicesView(state);
        this.bindInvoicesEvents();
        break;
      case 'team':
        container.innerHTML = this.renderTeamView(state);
        this.bindTeamEvents();
        break;
      case 'settings':
        container.innerHTML = this.renderSettingsView(state);
        this.bindSettingsEvents();
        break;
      default:
        container.innerHTML = this.renderOverviewView(state);
        this.bindOverviewEvents();
    }
  }

  /* ==========================================================================
     1. OPERATIONS OVERVIEW VIEW
     ========================================================================== */
  renderOverviewView(state) {
    const totalSales = state.invoices.filter(i => i.status === 'Paid').reduce((a, b) => a + b.total, 0);
    const lowStockItems = state.inventory.filter(i => i.barStock <= i.barMinimum);

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>A good day starts here.</h2>
          <p>Main café · Your sales, stock and team in one place.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-open-pos-from-overview">
            <span>Open barista POS</span>
            <span>↗</span>
          </button>
        </div>
      </div>

      <!-- Date & Subheader Filter -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; font-size: 13px; color: var(--text-muted);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-weight: 600; color: var(--text-heading); background: #eee8de; padding: 4px 10px; border-radius: 4px;">Today · 26 October</span>
          <span>As of 14:32</span>
        </div>
        <div>
          <span style="font-size: 12px;">Preview · Example data</span>
        </div>
      </div>

      <!-- 4 Top KPI Cards -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Net sales</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg></span>
          </div>
          <div class="metric-value">EGP 8,450</div>
          <div class="metric-meta">42 completed orders</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Payments recorded</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg></span>
          </div>
          <div class="metric-value">EGP 8,200</div>
          <div class="metric-meta">EGP 250 outstanding</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Average order</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg></span>
          </div>
          <div class="metric-value">EGP 201.19</div>
          <div class="metric-meta">Across today's completed sales</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Stock attention</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg></span>
          </div>
          <div class="metric-value" style="color: var(--brand-terracotta);">${lowStockItems.length} items</div>
          <div class="metric-meta alert">Bar stock needs replenishment</div>
        </div>
      </div>

      <!-- Main Two Column Grid -->
      <div class="two-col-grid">
        <!-- Left Column: Sales & Activity -->
        <div>
          <!-- Sales & Payments Card -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Sales & payments</span>
              <a href="#" class="card-link" id="link-view-all-invoices">View invoices ↗</a>
            </div>

            <table class="erp-table">
              <thead>
                <tr>
                  <th>SALE / INVOICE</th>
                  <th>TIME</th>
                  <th>TOTAL · EGP</th>
                  <th>PAYMENT</th>
                </tr>
              </thead>
              <tbody>
                ${state.invoices.slice(0, 4).map(inv => `
                  <tr>
                    <td><strong>#${inv.saleId} · ${inv.id}</strong></td>
                    <td>${inv.time}</td>
                    <td>${inv.total.toFixed(2)}</td>
                    <td>
                      <span class="badge ${inv.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">
                        ${inv.status}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="margin-top: 14px; font-size: 12px; color: var(--text-muted); display: flex; gap: 16px;">
              <span>Cash EGP 4,900</span>
              <span>·</span>
              <span>Card EGP 3,300</span>
              <span style="margin-left: auto; font-style: italic;">Illustrative methods</span>
            </div>
          </div>

          <!-- Connected Activity Feed -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Connected activity</span>
              <a href="#" class="card-link" id="link-view-inventory-activity">All activity ↗</a>
            </div>

            <div style="display: flex; flex-direction: column; gap: 14px;">
              ${state.connectedActivity.map(act => `
                <div style="display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 1px solid var(--border-light); padding-bottom: 12px;">
                  <div style="display: flex; gap: 12px; align-items: flex-start;">
                    <div style="background: #f5eee8; color: var(--brand-terracotta); width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                      ${act.type === 'sale' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' : (act.type === 'transfer' ? '⇄' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>')}
                    </div>
                    <div>
                      <div style="font-size: 13.5px; font-weight: 600; color: var(--text-heading);">${act.title}</div>
                      <div style="font-size: 11.5px; color: var(--text-muted);">${act.detail}</div>
                    </div>
                  </div>
                  <div style="font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">${act.time}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Right Column: Replenish Bar, Expected Today, Upcoming Event -->
        <div>
          <!-- Replenish the Bar Card -->
          <div class="card" style="border-left: 3px solid var(--brand-terracotta);">
            <div class="card-header">
              <span class="card-title">Replenish the bar</span>
              <a href="#" class="card-link" id="link-to-inventory">Inventory ↗</a>
            </div>

            <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
              ${lowStockItems.map(item => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: #faf7f2; border-radius: 6px;">
                  <div>
                    <div style="font-size: 13px; font-weight: 600;">${item.name}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">Min. ${item.barMinimum} ${item.unit} · Bar stock</div>
                  </div>
                  <div style="font-size: 12px; font-weight: 700; color: #b45309; background: #fef3c7; padding: 2px 8px; border-radius: 4px;">
                    ${item.barStock} ${item.unit}
                  </div>
                </div>
              `).join('')}
            </div>

            <button class="btn btn-outline" style="width: 100%; font-size: 12.5px;" id="btn-quick-transfer">
              <span>⇄</span>
              <span>Create warehouse transfer</span>
            </button>
          </div>

          <!-- Expected Today -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Expected today</span>
              <a href="#" class="card-link" id="link-to-receiving">Receiving ↗</a>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 13.5px; font-weight: 700;">RCV-0028</span>
              <span class="badge badge-pending">Pending</span>
            </div>
            <div style="font-size: 13px; font-weight: 600; color: var(--text-heading);">Nile Roasters</div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin: 4px 0 10px;">10 kg House blend beans → Dry store</div>
            <div style="font-size: 11.5px; color: var(--brand-terracotta);">Due 15:00–16:00 · <a href="#" id="link-review-receipt" style="text-decoration: underline; font-weight: 600;">Review receipt ↗</a></div>
          </div>

          <!-- Upcoming Event Card (Dynamic from Outside Events state) -->
          ${(() => {
            const upEvt = (state.events && state.events.length > 0) ? state.events[0] : null;
            if (!upEvt) return '';
            return `
              <div class="card" style="background: #faf3ee; border-color: #edd9cc;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--brand-terracotta);">
                    ${upEvt.type.toUpperCase()}
                  </span>
                  <span class="badge ${upEvt.status === 'Active' ? 'badge-paid' : 'badge-pending'}" style="font-size: 10.5px;">${upEvt.status}</span>
                </div>
                <h3 style="font-family: var(--font-serif); font-size: 20px; font-weight: 600; color: var(--text-heading); margin-bottom: 6px;">
                  ${upEvt.title}
                </h3>
                <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">
                  ${upEvt.date} · ${upEvt.time} · ${upEvt.venue}
                </p>
                <p style="font-size: 11.5px; color: var(--text-body); margin-bottom: 12px;">
                  ${upEvt.guests} guests planned. ${upEvt.allocatedStock ? `Allocated: ${upEvt.allocatedStock}.` : 'Reserve stock kit allocated.'}
                </p>
                <div style="display: flex; gap: 12px; align-items: center;">
                  <a href="#" id="link-review-event-prep" style="font-size: 12px; font-weight: 600; color: var(--brand-terracotta); display: flex; align-items: center; gap: 4px;">
                    Review event preparation ↗
                  </a>
                  <span style="color: var(--border-medium);">·</span>
                  <a href="#" id="link-plan-outside-event" style="font-size: 12px; font-weight: 600; color: var(--text-heading);">
                    + Plan event
                  </a>
                </div>
              </div>
            `;
          })()}
        </div>
      </div>
    `;
  }

  bindOverviewEvents() {
    document.getElementById('btn-open-pos-from-overview')?.addEventListener('click', () => {
      this.navigateTo('pos');
    });

    document.getElementById('link-view-all-invoices')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('invoices');
    });

    document.getElementById('link-view-inventory-activity')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('inventory');
    });

    document.getElementById('link-to-inventory')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('inventory');
    });

    document.getElementById('link-to-receiving')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('suppliers');
    });

    document.getElementById('link-review-receipt')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('suppliers');
    });

    document.getElementById('link-review-event-prep')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('events');
    });

    document.getElementById('link-plan-outside-event')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showCreateEventModal();
    });

    document.getElementById('btn-quick-transfer')?.addEventListener('click', () => {
      this.showTransferModal();
    });
  }

  /* ==========================================================================
     2. BARISTA POS VIEW
     ========================================================================== */
  renderPosView(state) {
    const session = state.session;
    const order = state.openOrder;

    // Filter products
    const filteredProducts = this.selectedCat === 'all'
      ? state.products
      : state.products.filter(p => p.category.toLowerCase().replace(/[^a-z]/g, '') === this.selectedCat);

    return `
      <!-- Active Session Header Bar -->
      <div class="pos-active-header">
        <div class="pos-active-top">
          <div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <h2>Active session summary</h2>
              <span class="badge badge-draft">Active session</span>
            </div>
            <p>Cashier ${session.cashier} · Session ${session.id} · Opened ${session.openedAt}</p>
          </div>
          <div>
            <button class="btn btn-outline" id="btn-to-session-summary">
              <span>Session summary / close</span>
              <span>↗</span>
            </button>
          </div>
        </div>

        <div class="pos-metrics-bar">
          <div>
            <div class="pos-metric-sub">NET SALES · EGP</div>
            <div class="pos-metric-val">${session.netSales.toFixed(2)}</div>
            <div class="pos-metric-desc">${session.completedSales} completed sales · ${session.cashier}</div>
          </div>
          <div>
            <div class="pos-metric-sub">COMPLETED SALES</div>
            <div class="pos-metric-val">${session.completedSales}</div>
            <div class="pos-metric-desc">Unpaid orders excluded</div>
          </div>
          <div>
            <div class="pos-metric-sub">CASH SALES · EGP</div>
            <div class="pos-metric-val">${session.cashSales.toFixed(2)}</div>
            <div class="pos-metric-desc">Sales only · Float excluded</div>
          </div>
          <div>
            <div class="pos-metric-sub">CARD SALES · EGP</div>
            <div class="pos-metric-val">${session.cardSales.toFixed(2)}</div>
            <div class="pos-metric-desc">Not included in cash drawer</div>
          </div>
        </div>
      </div>

      <!-- Warning Alert Banner for Open Order -->
      ${order && order.status === 'unpaid' ? `
        <div class="alert-banner alert-warning">
          <div style="display: flex; align-items: center; gap: 10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            <div>
              <strong>Order #${order.id} is still open · EGP ${order.total.toFixed(2)} unpaid</strong>
              <div style="font-size: 11.5px; opacity: 0.9;">
                2 Flat whites × EGP 90 + 1 Butter croissant × EGP 70. Not part of the 24 completed sales or totals. Resolve or hold this order before closing.
              </div>
            </div>
          </div>
          <button class="btn btn-sm btn-outline" id="btn-resolve-open-order">Resolve / hold #${order.id}</button>
        </div>
      ` : ''}

      <!-- Operational Policy Pill -->
      <div class="alert-banner alert-success" style="padding: 8px 14px; margin-bottom: 20px;">
        <span style="font-size: 12px;">On completion: record payment → create invoice → deduct recipe stock from Bar stock.</span>
      </div>

      <!-- Mobile Catalog vs Order Toggle -->
      <div class="pos-mobile-nav-tabs">
        <button class="pos-tab-btn ${this.posMobileTab !== 'cart' ? 'active' : ''}" id="btn-tab-menu">
          Menu catalog
        </button>
        <button class="pos-tab-btn ${this.posMobileTab === 'cart' ? 'active' : ''}" id="btn-tab-cart">
          Current order (${order.items.length}) · EGP ${order.total.toFixed(2)}
        </button>
      </div>

      <!-- POS Main Grid (Catalog + Cart) -->
      <div class="pos-layout ${this.posMobileTab === 'cart' ? 'pos-mobile-cart-active' : 'pos-mobile-menu-active'}">
        <!-- Left: Product Catalog -->
        <div class="pos-menu-section">
          <div class="pos-catalog-header">
            <div>
              <h3>Make something good.</h3>
              <p>Select an item to add it to the order.</p>
            </div>
            <button class="btn btn-sm btn-outline" id="btn-held-orders">
              <span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Held orders · 2</span>
            </button>
          </div>

          <!-- Search Input -->
          <div style="margin: 16px 0 12px; position: relative;">
            <input type="text" class="form-input" id="pos-search-input" placeholder="Search menu or enter item code..." style="padding-left: 12px;">
          </div>

          <!-- Category Pills -->
          <div class="pos-category-pills">
            <button class="cat-pill ${this.selectedCat === 'all' ? 'active' : ''}" data-cat="all">All items</button>
            <button class="cat-pill ${this.selectedCat === 'coffee' ? 'active' : ''}" data-cat="coffee">Coffee</button>
            <button class="cat-pill ${this.selectedCat === 'iceddrinks' ? 'active' : ''}" data-cat="iceddrinks">Iced drinks</button>
            <button class="cat-pill ${this.selectedCat === 'noncoffee' ? 'active' : ''}" data-cat="noncoffee">Non-coffee</button>
            <button class="cat-pill ${this.selectedCat === 'bakery' ? 'active' : ''}" data-cat="bakery">Bakery</button>
          </div>

          <!-- Product Cards Grid -->
          <div class="pos-grid">
            ${filteredProducts.map(p => `
              <div class="pos-product-card" data-product-id="${p.id}">
                <div>
                  <div class="product-card-top">
                    <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; background: rgba(184,88,52,0.08); color: var(--brand-terracotta);">${p.category === 'Coffee' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>' : (p.category === 'Bakery' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 9 9"></path></svg>' : (p.category === 'Iced drinks' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 21h10a2 2 0 0 0 2-2L21 8H3l2 11a2 2 0 0 0 2 2z"></path><line x1="3" y1="8" x2="21" y2="8"></line><line x1="12" y1="3" x2="12" y2="8"></line></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'))}</span>
                    <span class="product-cat-tag">${p.category}</span>
                  </div>
                  <div class="product-title">${p.name}</div>
                  <div class="product-recipe-hint">${p.recipeSummary}</div>
                </div>
                <div class="product-card-bottom">
                  <span class="product-price">EGP ${p.price.toFixed(2)}</span>
                  <div class="add-plus-btn">+</div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Customizer Preview Box -->
          <div class="modifier-box" id="modifier-customizer-box">
            <div class="mod-header">
              <span>Flat white · Customize</span>
              <span class="badge badge-draft" style="font-size: 10.5px;">Selected in order</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 8px 0;">
              <div>
                <div class="mod-group-title">MILK</div>
                <div class="mod-pills">
                  <div class="mod-pill selected" id="mod-whole-milk">Whole milk</div>
                  <div class="mod-pill" id="mod-oat-milk">Oat + EGP 20</div>
                </div>
              </div>
              <div>
                <div class="mod-group-title">ESPRESSO</div>
                <div class="mod-pills">
                  <div class="mod-pill selected" id="mod-double-shot">Double shot</div>
                  <div class="mod-pill" id="mod-extra-shot">Extra + EGP 20</div>
                </div>
              </div>
            </div>

            <div class="mod-recipe-preview">
              <span>Per cup: 18 g House blend beans + 160 ml Whole milk</span>
              <span style="margin-left: auto; color: var(--brand-terracotta); font-weight: 600;">Bar stock · Available ↗</span>
            </div>
          </div>

          ${order.items.length > 0 ? `
            <div class="pos-mobile-switch-row" style="margin-top: 16px;">
              <button class="btn btn-primary" id="btn-switch-to-cart" style="width: 100%; padding: 12px; justify-content: center; font-size: 13.5px;">
                Review order & pay (${order.items.length} items · EGP ${order.total.toFixed(2)}) →
              </button>
            </div>
          ` : ''}
        </div>

        <!-- Right: Current Order Cart -->
        <div class="pos-cart-panel" id="pos-cart-panel">
          <button class="btn btn-outline btn-sm mobile-back-menu-btn" id="btn-switch-to-menu" style="width: 100%; margin-bottom: 14px; justify-content: center;">
            ← Return to menu items
          </button>
          <div class="cart-header">
            <div>
              <div class="cart-order-title">${order.code}</div>
              <div class="cart-order-sub">Opened ${order.openedTime} · ${order.cashier}</div>
            </div>
            <button class="icon-btn" title="Order options">•••</button>
          </div>

          <!-- Dine-in / Takeaway / Event Tabs -->
          <div class="order-type-tabs">
            <div class="type-tab ${order.type === 'Dine-in' ? 'active' : ''}" data-type="Dine-in">Dine-in</div>
            <div class="type-tab ${order.type === 'Takeaway' ? 'active' : ''}" data-type="Takeaway">Takeaway</div>
            <div class="type-tab ${order.type === 'Event' ? 'active' : ''}" data-type="Event">Event</div>
          </div>

          <div class="table-selector-row">
            ${order.type === 'Event' ? `
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px;">
                <span style="font-size: 11.5px; font-weight: 700; color: var(--brand-terracotta); display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg> OUTSIDE EVENT:</span>
                <select id="pos-event-select" class="form-select" style="padding: 2px 6px; font-size: 11.5px; flex: 1; max-width: 175px;">
                  ${(state.events || []).map(ev => `
                    <option value="${ev.title}" ${(order.eventLinked === ev.title || (order.table && order.table.includes(ev.title))) ? 'selected' : ''}>
                      ${ev.title}
                    </option>
                  `).join('')}
                </select>
              </div>
            ` : `
              <span>${order.table}</span>
              <a href="#" style="color: var(--brand-terracotta); font-weight: 600; font-size: 11.5px;" id="btn-edit-table">Edit</a>
            `}
          </div>

          <!-- Cart Items -->
          <div class="cart-items-list">
            ${order.items.length === 0 ? `
              <div style="text-align: center; padding: 30px 10px; color: var(--text-muted); font-size: 13px;">
                Cart is empty. Tap any beverage or bakery item from the menu to add.
              </div>
            ` : order.items.map((item, idx) => `
              <div class="cart-item-row">
                <div class="item-left">
                  <div class="name">${item.name}</div>
                  <div class="mod">${item.modifiers || 'Standard'}</div>
                </div>
                <div class="item-right">
                  <div class="item-price">EGP ${item.total.toFixed(2)}</div>
                  <div class="qty-stepper">
                    <button class="qty-btn btn-qty-minus" data-index="${idx}">−</button>
                    <span class="qty-val">${item.quantity}</span>
                    <button class="qty-btn btn-qty-plus" data-index="${idx}">+</button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Note Button -->
          <button class="btn btn-outline btn-sm" style="width: 100%; margin-bottom: 12px; font-size: 12px;" id="btn-add-order-note">
            Add order note
          </button>

          <!-- Totals -->
          <div class="cart-totals">
            <div class="totals-row">
              <span>Subtotal</span>
              <span>EGP ${order.subtotal.toFixed(2)}</span>
            </div>
            <div class="totals-row">
              <span>Tax / service</span>
              <span>0.00</span>
            </div>
            <div class="total-main">
              <span>Total</span>
              <span>EGP ${order.total.toFixed(2)}</span>
            </div>
          </div>

          <!-- Payment Method Toggle -->
          <div style="font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">
            PAYMENT METHOD · ILLUSTRATIVE
          </div>
          <div class="payment-method-toggle">
            <button class="pay-btn active" id="btn-pay-cash">
              <span style="display: inline-flex; align-items: center; gap: 5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg> Cash</span>
            </button>
            <button class="pay-btn" id="btn-pay-card">
              <span style="display: inline-flex; align-items: center; gap: 5px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg> Card</span>
            </button>
          </div>
          <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 12px; text-align: center;">
            Manual recording only. No payment terminal connected.
          </div>

          <!-- Charge Button -->
          <button class="btn btn-primary btn-charge" id="btn-charge-order" ${order.items.length === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            → Charge EGP ${order.total.toFixed(2)}
          </button>

          <!-- Policy Note -->
          <div style="margin-top: 14px; font-size: 11px; color: #166534; background: #f0fdf4; padding: 8px 10px; border-radius: 6px; border: 1px solid #bbf7d0;">
            On completion: record payment → create invoice → deduct recipe stock from Bar stock.
          </div>

          <div style="display: flex; justify-content: space-between; margin-top: 14px; font-size: 11.5px; color: var(--text-muted);">
            <a href="#" id="link-hold-order">Hold order</a>
            <a href="#" id="link-cancel-order" style="color: #b91c1c;">Cancel order</a>
          </div>
        </div>
      </div>
    `;
  }

  bindPosEvents() {
    // Mobile tab switches (clean in-page transitions, zero floating bars)
    document.getElementById('btn-tab-menu')?.addEventListener('click', () => {
      this.posMobileTab = 'menu';
      this.render();
    });
    document.getElementById('btn-tab-cart')?.addEventListener('click', () => {
      this.posMobileTab = 'cart';
      this.render();
    });
    document.getElementById('btn-switch-to-cart')?.addEventListener('click', () => {
      this.posMobileTab = 'cart';
      this.render();
    });
    document.getElementById('btn-switch-to-menu')?.addEventListener('click', () => {
      this.posMobileTab = 'menu';
      this.render();
    });
    // Session summary close button
    document.getElementById('btn-to-session-summary')?.addEventListener('click', () => {
      this.navigateTo('session-close');
    });

    // Category pills
    document.querySelectorAll('.cat-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        this.selectedCat = pill.getAttribute('data-cat');
        this.render();
      });
    });

    // Add product to cart
    document.querySelectorAll('.pos-product-card').forEach(card => {
      card.addEventListener('click', () => {
        const prodId = card.getAttribute('data-product-id');
        const state = store.getState();
        const product = state.products.find(p => p.id === prodId);
        if (product) {
          store.addItemToCart(product);
          this.showToast(`Added ${product.name} to order.`);
        }
      });
    });

    // Quantity steppers
    document.querySelectorAll('.btn-qty-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        store.updateItemQuantity(idx, -1);
      });
    });

    document.querySelectorAll('.btn-qty-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        store.updateItemQuantity(idx, 1);
      });
    });

    // Order type tabs
    document.querySelectorAll('.type-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const type = tab.getAttribute('data-type');
        const state = store.getState();
        const defaultEvtTitle = (state.events && state.events.length > 0) ? state.events[0].title : null;
        store.setOrderType(type, type === 'Event' ? defaultEvtTitle : null);
      });
    });

    // Outside Event selector in POS cart
    document.getElementById('pos-event-select')?.addEventListener('change', (e) => {
      const selectedEvt = e.target.value;
      store.setOrderType('Event', selectedEvt);
      this.showToast(`Order assigned to event: "${selectedEvt}".`);
    });

    // Payment method buttons
    const payCashBtn = document.getElementById('btn-pay-cash');
    const payCardBtn = document.getElementById('btn-pay-card');
    let chosenMethod = 'cash';

    payCashBtn?.addEventListener('click', () => {
      chosenMethod = 'cash';
      payCashBtn.classList.add('active');
      payCardBtn.classList.remove('active');
    });

    payCardBtn?.addEventListener('click', () => {
      chosenMethod = 'card';
      payCardBtn.classList.add('active');
      payCashBtn.classList.remove('active');
    });

    // Charge Order Button
    document.getElementById('btn-charge-order')?.addEventListener('click', () => {
      const invoice = store.chargeCurrentOrder(chosenMethod);
      if (invoice) {
        this.showToast(`Order complete! ${invoice.id} created · Stock deducted.`);
        // Show printable invoice modal simulation
        this.showInvoiceModal(invoice);
      }
    });

    // Resolve / hold button
    document.getElementById('btn-resolve-open-order')?.addEventListener('click', () => {
      this.showToast('Order #1042 loaded for immediate resolution.');
    });

    // Modifiers preview pills toggle
    document.getElementById('mod-oat-milk')?.addEventListener('click', function() {
      this.classList.toggle('selected');
      document.getElementById('mod-whole-milk').classList.toggle('selected');
    });

    document.getElementById('mod-extra-shot')?.addEventListener('click', function() {
      this.classList.toggle('selected');
      document.getElementById('mod-double-shot').classList.toggle('selected');
    });
  }

  /* ==========================================================================
     OUTSIDE EVENTS VIEW (Dedicated Client Outside Events Screen)
     ========================================================================== */
  renderEventsView(state) {
    const events = state.events || [];
    const activeCount = events.filter(e => e.status !== 'Completed').length;
    const totalGuests = events.reduce((acc, e) => acc + (parseInt(e.guests) || 0), 0);

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Outside events & catering</h2>
          <p>Outside pop-ups, mobile espresso bars, corporate catering, and tasting cuppings.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-create-event">
            <span>+ Plan outside event</span>
          </button>
        </div>
      </div>

      <!-- 4 Top Metric Cards -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Active outside events</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg></span>
          </div>
          <div class="metric-value">${activeCount} events</div>
          <div class="metric-meta">Catering & Pop-up units</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Planned guests</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span>
          </div>
          <div class="metric-value">${totalGuests}</div>
          <div class="metric-meta">Total expected attendance</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Mobile stock kits</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg></span>
          </div>
          <div class="metric-value">${events.length} kits</div>
          <div class="metric-meta">Dedicated mobile bar stock</div>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-title">POS Integration</span>
            <span class="metric-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg></span>
          </div>
          <div class="metric-value" style="color: #166534;">Connected</div>
          <div class="metric-meta">Sales attributed to outside event</div>
        </div>
      </div>

      <!-- Event Filter Tabs -->
      <div style="display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid var(--border-light); padding-bottom: 12px; font-size: 13px;">
        <button class="btn btn-ghost btn-sm" style="font-weight: 700; border-bottom: 2px solid var(--brand-terracotta);">
          All outside events (${events.length})
        </button>
        <button class="btn btn-ghost btn-sm">Upcoming · ${events.filter(e => e.status === 'Planned').length}</button>
        <button class="btn btn-ghost btn-sm">Active today · ${events.filter(e => e.status === 'Active').length}</button>
      </div>

      <!-- Events Grid -->
      <div class="events-grid">
        ${events.map(ev => `
          <div class="event-card ${ev.status === 'Active' ? 'featured' : ''}">
            <div>
              <div class="event-header">
                <span class="event-type-tag">${ev.type}</span>
                <span class="badge ${ev.status === 'Active' ? 'badge-paid' : (ev.status === 'Planned' ? 'badge-pending' : 'badge-neutral')}">
                  ${ev.status}
                </span>
              </div>
              <h3 class="event-title">${ev.title}</h3>
              
              <div class="event-meta-row">
                <span style="display: inline-flex; align-items: center; gap: 5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${ev.date} · ${ev.time}</span>
              </div>
              <div class="event-meta-row">
                <span style="display: inline-flex; align-items: center; gap: 5px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> ${ev.venue}</span>
              </div>
              <div class="event-meta-row">
                <span style="display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> Lead Barista: <strong>${ev.assignedStaff}</strong> · <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg> <strong>${ev.guests}</strong> guests</span>
              </div>

              <div class="event-stock-box">
                <div style="font-weight: 700; font-size: 10.5px; text-transform: uppercase; color: var(--brand-terracotta); margin-bottom: 4px;">
                  <span style="display: inline-flex; align-items: center; gap: 5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg> Allocated Stock Kit</span>
                </div>
                <div>${ev.allocatedStock || 'Standard event stock kit reserved from central storage'}</div>
              </div>
            </div>

            <div style="display: flex; gap: 10px; border-top: 1px solid var(--border-light); padding-top: 14px; margin-top: 10px;">
              <button class="btn btn-primary btn-sm btn-open-event-pos" data-event-title="${ev.title}" style="flex: 1;">
                <span>Open Event POS ↗</span>
              </button>
              <button class="btn btn-outline btn-sm btn-event-details" data-event-id="${ev.id}">
                <span>Kit details</span>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  bindEventsViewEvents() {
    document.getElementById('btn-create-event')?.addEventListener('click', () => {
      this.showCreateEventModal();
    });

    document.querySelectorAll('.btn-open-event-pos').forEach(btn => {
      btn.addEventListener('click', () => {
        const title = btn.getAttribute('data-event-title');
        store.setOrderType('Event', title);
        this.navigateTo('pos');
        this.showToast(`Switched POS to Event mode: "${title}"`);
      });
    });

    document.querySelectorAll('.btn-event-details').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-event-id');
        const state = store.getState();
        const ev = state.events.find(e => e.id === id);
        if (ev) {
          alert(`Outside Event: ${ev.title}\nVenue: ${ev.venue}\nDate & Time: ${ev.date} · ${ev.time}\nLead: ${ev.assignedStaff}\nGuests: ${ev.guests}\n\nAllocated Stock Kit:\n${ev.allocatedStock}`);
        }
      });
    });
  }

  /* ==========================================================================
     3. CASHIER SIGN-IN VIEW
     ========================================================================== */
  renderCashierSignInView(state) {
    return `
      <div style="max-width: 520px; margin: 30px auto;">
        <!-- 3-Step Wizard Indicator -->
        <div style="display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 28px; font-size: 13px;">
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--brand-terracotta);">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: var(--brand-terracotta); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px;">1</div>
            <span>Sign in</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted);">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #e5e0d8; color: #555; display: flex; align-items: center; justify-content: center; font-size: 11px;">2</div>
            <span>Open session</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted);">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #e5e0d8; color: #555; display: flex; align-items: center; justify-content: center; font-size: 11px;">3</div>
            <span>Start selling</span>
          </div>
        </div>

        <div class="card" style="padding: 36px 32px;">
          <div style="width: 44px; height: 44px; border-radius: 10px; background: #fdf2ec; color: var(--brand-terracotta); display: flex; align-items: center; justify-content: center; margin-bottom: 16px;">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>
          </div>

          <h2 style="font-family: var(--font-serif); font-size: 28px; font-weight: 500; margin-bottom: 8px;">
            Ready for a good shift?
          </h2>
          <p style="font-size: 13.5px; color: var(--text-muted); margin-bottom: 20px;">
            Sign in to your cashier account. Then open your register session to start selling.
          </p>

          <div style="background: #f4ede3; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            <div>
              <div style="font-size: 13px; font-weight: 700;">Main café · POS-01</div>
              <div style="font-size: 11px; color: var(--text-muted);">Café operating warehouse · Bar stock</div>
            </div>
          </div>

          <form id="form-cashier-signin">
            <div class="form-group">
              <label class="form-label">Email address</label>
              <input type="email" class="form-input" id="signin-email" value="omar@drip.example" required>
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" class="form-input" id="signin-password" value="••••••••••••" required>
              <div style="display: flex; justify-content: space-between; font-size: 11.5px; margin-top: 6px;">
                <span style="color: var(--text-muted);">Use your own staff account.</span>
                <a href="#" style="color: var(--brand-terracotta); font-weight: 600;">Forgot password?</a>
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px; margin-top: 10px;">
              → Sign in & continue
            </button>
          </form>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); font-size: 11.5px; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
            <span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></span>
            <span>Your completed sales are recorded under your name and active session. Signing in alone does not open the register.</span>
          </div>
        </div>

        <div style="text-align: center; font-size: 12px; color: var(--text-muted); margin-top: 16px;">
          Need access? Contact your workspace administrator.<br>
          <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> POS stays locked until a register session is open.</span>
        </div>
      </div>
    `;
  }

  bindCashierSignInEvents() {
    document.getElementById('form-cashier-signin')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.navigateTo('session-open');
    });
  }

  /* ==========================================================================
     4. OPEN REGISTER SESSION VIEW
     ========================================================================== */
  renderSessionOpenView(state) {
    const session = state.session;

    return `
      <div style="max-width: 820px; margin: 20px auto;">
        <!-- 3-Step Wizard Indicator -->
        <div style="display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 24px; font-size: 13px;">
          <div style="display: flex; align-items: center; gap: 8px; color: #166534; font-weight: 600;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>Sign in</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--brand-terracotta);">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: var(--brand-terracotta); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px;">2</div>
            <span>Open session</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted);">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: #e5e0d8; color: #555; display: flex; align-items: center; justify-content: center; font-size: 11px;">3</div>
            <span>Start selling</span>
          </div>
        </div>

        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="font-family: var(--font-serif); font-size: 32px; font-weight: 500;">
            A fresh session. A clear starting point.
          </h2>
          <p style="font-size: 14px; color: var(--text-muted);">
            Confirm your register and count the opening cash before taking your first order.
          </p>
        </div>

        <div class="card session-card-grid" style="display: grid; grid-template-columns: 280px 1fr; gap: 24px; padding: 28px;">
          <!-- Left Column: Signed In Profile -->
          <div style="border-right: 1px solid var(--border-light); padding-right: 20px;">
            <div style="font-size: 11px; color: #166534; font-weight: 600; margin-bottom: 8px; display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Signed in</div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <div class="avatar-circle" style="background: #3c322b;">ON</div>
              <div>
                <div style="font-size: 14px; font-weight: 700;">Omar Nabil</div>
                <div style="font-size: 11.5px; color: var(--text-muted);">Barista · POS operator</div>
              </div>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 20px;">omar@drip.example</div>

            <div style="font-size: 12.5px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-light); padding-top: 14px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Branch</span>
                <strong>Main café</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Register</span>
                <strong>POS-01</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">New session</span>
                <strong style="color: var(--brand-terracotta);">S-0028</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Opening date</span>
                <span>26 Oct 2026</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: var(--text-muted);">Opening time</span>
                <span>09:00 · Cairo</span>
              </div>
            </div>

            <div style="margin-top: 20px; padding: 12px; background: #faf8f5; border-radius: 6px;">
              <div style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">CAFÉ OPERATING WAREHOUSE</div>
              <div style="font-size: 12.5px; font-weight: 700; margin-top: 2px;">Bar stock</div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Completed sales deduct recipe ingredients from Bar stock only, never reserve storage.</div>
            </div>

            <div style="margin-top: 16px;">
              <a href="#" id="link-signout-omar" style="font-size: 11.5px; color: var(--brand-terracotta); font-weight: 600;">Not Omar? Sign out</a>
            </div>
          </div>

          <!-- Right Column: Opening Float Form -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <h3 style="font-family: var(--font-serif); font-size: 22px;">Open register session</h3>
              <span class="badge badge-unpaid">Not open yet · Selling locked</span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 20px;">
              Count the cash already in the drawer. This is your opening float, not sales revenue.
            </p>

            <form id="form-open-session">
              <div class="form-group">
                <label class="form-label">Opening cash float</label>
                <input type="number" step="0.01" class="form-input" id="input-open-float" value="500.00" required>
                <div class="form-hint">Enter the actual amount counted in the drawer.</div>
              </div>

              <div class="form-group">
                <label class="form-label">Opening note (optional)</label>
                <input type="text" class="form-input" id="input-open-note" value="Morning shift · Float counted">
              </div>

              <div style="padding: 12px 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; font-size: 12px; color: #166534; margin: 20px 0;">
                All completed sales in S-0028 will be attributed to Omar Nabil. The session starts when you select Open session.
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px;">
                → Open session
              </button>
              <div style="font-size: 11px; color: var(--text-muted); text-align: center; margin-top: 8px;">
                Next: enter Barista POS. No sales can be completed before this session is active.
              </div>
            </form>
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); margin-top: 14px;">
          <a href="#" id="link-back-to-workspace">← Back to workspace</a>
          <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> One active session per register</span>
        </div>
      </div>
    `;
  }

  bindSessionOpenEvents() {
    document.getElementById('form-open-session')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const floatVal = document.getElementById('input-open-float').value;
      const noteVal = document.getElementById('input-open-note').value;
      store.openRegisterSession('Omar Nabil', 'omar@drip.example', floatVal, noteVal);
      this.showToast('Register session S-0028 opened! Selling unlocked.');
      this.navigateTo('pos');
    });

    document.getElementById('link-signout-omar')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('cashier-signin');
    });

    document.getElementById('link-back-to-workspace')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('overview');
    });
  }

  /* ==========================================================================
     5. REGISTER SESSION SUMMARY & CLOSE VIEW
     ========================================================================== */
  renderSessionCloseView(state) {
    const session = state.session;
    const order = state.openOrder;
    const expectedDrawer = session.openingFloat + session.cashSales;

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Register session summary & close</h2>
          <p>Review Omar's sales, reconcile the drawer and finish the shift.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-outline" id="btn-back-to-pos">← Back to POS</button>
        </div>
      </div>

      <!-- Cashier Session Pill Card -->
      <div class="card session-pill-card" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div class="avatar-circle">ON</div>
          <div>
            <div style="font-size: 14px; font-weight: 700;">Omar Nabil</div>
            <div style="font-size: 11.5px; color: var(--text-muted);">${session.role}</div>
          </div>
        </div>
        <div>
          <div style="font-size: 13.5px; font-weight: 700;">${session.id} · ${session.register}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">Main café · Bar stock</div>
        </div>
        <div>
          <div style="font-size: 12px; color: var(--text-muted);">Opened ${session.openedAt}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">Closed at: Not closed · Review at 14:30</div>
        </div>
        <div>
          <span class="badge badge-draft">Active · Draft close</span>
        </div>
      </div>

      <!-- 4 Metric Cards -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-title">NET SALES · EGP</div>
          <div class="metric-value">${session.netSales.toFixed(2)}</div>
          <div class="metric-meta">Attributed to ${session.cashier}</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">COMPLETED SALES</div>
          <div class="metric-value">${session.completedSales}</div>
          <div class="metric-meta">Unpaid orders excluded</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">CASH SALES · EGP</div>
          <div class="metric-value">${session.cashSales.toFixed(2)}</div>
          <div class="metric-meta">Sales only · Float excluded</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">CARD SALES · EGP</div>
          <div class="metric-value">${session.cardSales.toFixed(2)}</div>
          <div class="metric-meta">Not included in cash drawer</div>
        </div>
      </div>

      <!-- Unresolved Order Warning -->
      ${order && order.status === 'unpaid' ? `
        <div class="alert-banner alert-warning">
          <div style="display: flex; align-items: center; gap: 10px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #b45309; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <div>
              <strong>Order #${order.id} is still open · EGP ${order.total.toFixed(2)} unpaid</strong>
              <div style="font-size: 11.5px;">
                2 Flat whites × EGP 90 + 1 Butter croissant × EGP 70. Not part of the 24 completed sales or totals. Resolve or hold this order before closing.
              </div>
            </div>
          </div>
          <button class="btn btn-sm btn-outline" id="btn-resolve-order-close">Resolve / hold #${order.id}</button>
        </div>
      ` : ''}

      <!-- Main Two Column Grid: Completed Sales & Reconciliation Calculator -->
      <div class="two-col-grid">
        <!-- Left: Completed Sales & Sales Summary -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Completed sales</span>
              <a href="#" class="card-link" id="link-view-all-24">View all ${session.completedSales} ↗</a>
            </div>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 12px;">
              Only completed orders · Cashier ${session.cashier} · Session ${session.id}
            </div>

            <table class="erp-table">
              <thead>
                <tr>
                  <th>ORDER / TIME</th>
                  <th>CASHIER</th>
                  <th>METHOD</th>
                  <th>TOTAL · EGP</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${state.invoices.slice(0, 5).map(inv => `
                  <tr>
                    <td><strong>#${inv.saleId}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${inv.time}</span></td>
                    <td>${inv.cashier}</td>
                    <td>${inv.paymentMethod}</td>
                    <td>${inv.total.toFixed(2)}</td>
                    <td><span class="badge badge-completed">Completed</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Sales & payment summary</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
              <span>Gross sales</span>
              <strong>EGP ${session.netSales.toFixed(2)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--text-muted); margin-bottom: 10px;">
              <span>Discounts / refunds</span>
              <span>EGP 0.00 / 0.00</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; border-top: 1px solid var(--border-light); padding-top: 8px; margin-bottom: 14px;">
              <span>Net sales</span>
              <span>EGP ${session.netSales.toFixed(2)}</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; background: #faf8f5; padding: 12px; border-radius: 6px;">
              <div>
                <div style="font-size: 11px; color: var(--text-muted);">Cash · 16 sales</div>
                <div style="font-size: 16px; font-weight: 700;">EGP ${session.cashSales.toFixed(2)}</div>
              </div>
              <div>
                <div style="font-size: 11px; color: var(--text-muted);">Card · 8 sales</div>
                <div style="font-size: 16px; font-weight: 700;">EGP ${session.cardSales.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Closing Cash Reconciliation -->
        <div>
          <div class="card">
            <h3 style="font-family: var(--font-serif); font-size: 20px; font-weight: 600; margin-bottom: 8px;">
              Closing cash reconciliation
            </h3>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
              Count all cash in POS-01, including the opening float. Amounts in EGP.
            </p>

            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px; border-bottom: 1px solid var(--border-light); padding-bottom: 14px; margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between;">
                <span>Opening float · not revenue</span>
                <span>${session.openingFloat.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>+ Completed cash sales</span>
                <span>${session.cashSales.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Cash in / cash out</span>
                <span>0.00 / 0.00</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;">
              <span style="font-size: 14px; font-weight: 700;">Expected drawer</span>
              <span style="font-family: var(--font-serif); font-size: 24px; font-weight: 700;">EGP ${expectedDrawer.toFixed(2)}</span>
            </div>

            <div class="form-group">
              <label class="form-label">Counted cash</label>
              <input type="number" step="0.01" class="form-input" id="input-counted-cash" value="${expectedDrawer.toFixed(2)}">
            </div>

            <!-- Difference Box -->
            <div style="background: #eaf5ea; border: 1px solid #c3e6c5; border-radius: 6px; padding: 12px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <div>
                <div style="font-size: 10px; font-weight: 700; color: #166534; text-transform: uppercase;">DIFFERENCE</div>
                <div style="font-size: 18px; font-weight: 700; color: #166534;" id="label-diff-amount">EGP 0.00</div>
              </div>
              <span class="badge badge-balanced" id="badge-diff-status">Balanced</span>
            </div>

            <div class="form-group">
              <label class="form-label">Closing note (optional)</label>
              <input type="text" class="form-input" id="input-close-note" value="Drawer counted and balanced.">
            </div>

            <div style="font-size: 12px; color: #166534; margin-bottom: 12px;">
              Cash counted and reconciled
            </div>

            ${order && order.status === 'unpaid' ? `
              <div style="font-size: 12px; color: #b91c1c; font-weight: 600; margin-bottom: 10px;">
                ! Resolve or hold #${order.id} to continue
              </div>
            ` : ''}

            <button class="btn btn-outline" style="width: 100%; padding: 12px;" id="btn-confirm-close-session" ${order && order.status === 'unpaid' ? 'disabled style="opacity: 0.6; cursor: not-allowed;"' : ''}>
              Close session ${session.id}
            </button>

            <div style="font-size: 11px; color: var(--text-muted); margin-top: 10px; text-align: center;">
              Closing is blocked while an order remains open. Once closed, the end timestamp is recorded and selling is locked until a new session opens.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindSessionCloseEvents() {
    document.getElementById('btn-back-to-pos')?.addEventListener('click', () => {
      this.navigateTo('pos');
    });

    document.getElementById('btn-resolve-order-close')?.addEventListener('click', () => {
      this.navigateTo('pos');
    });

    document.getElementById('input-counted-cash')?.addEventListener('input', (e) => {
      const state = store.getState();
      const expected = state.session.openingFloat + state.session.cashSales;
      const counted = parseFloat(e.target.value) || 0;
      const diff = counted - expected;

      const diffLabel = document.getElementById('label-diff-amount');
      const badge = document.getElementById('badge-diff-status');

      if (diff === 0) {
        diffLabel.textContent = 'EGP 0.00';
        diffLabel.style.color = '#166534';
        badge.textContent = 'Balanced';
        badge.className = 'badge badge-balanced';
      } else {
        diffLabel.textContent = `EGP ${diff > 0 ? '+' : ''}${diff.toFixed(2)}`;
        diffLabel.style.color = '#b91c1c';
        badge.textContent = diff > 0 ? 'Surplus' : 'Shortage';
        badge.className = 'badge badge-unpaid';
      }
    });

    document.getElementById('btn-confirm-close-session')?.addEventListener('click', () => {
      const counted = document.getElementById('input-counted-cash').value;
      const note = document.getElementById('input-close-note').value;
      store.closeRegisterSession(counted, note);
      this.showToast('Session S-0028 closed and reconciled. Drawer sealed.');
      this.navigateTo('session-signin');
    });
  }

  /* ==========================================================================
     6. INVENTORY & WAREHOUSES VIEW
     ========================================================================== */
  renderInventoryView(state) {
    const warehouses = state.warehouses || [];

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Inventory & warehouses</h2>
          <p>Manage each location independently. Keep every movement connected.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-outline" id="btn-add-warehouse">
            <span>+ New warehouse</span>
          </button>
          <button class="btn btn-outline" id="btn-stock-count">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Stock count</span>
          </button>
          <button class="btn btn-primary" id="btn-trigger-transfer-modal">
            <span>⇄ New transfer</span>
          </button>
        </div>
      </div>

      <!-- Dynamic Warehouse Cards (Bar Stock, Dry Store, Cold Store, and unlimited client warehouses) -->
      <div class="three-warehouse-grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
        ${warehouses.map(wh => {
          const isOperating = wh.id === 'bar_stock' || wh.type === 'operating';
          return `
            <div class="card" style="${isOperating ? 'border: 2px solid var(--brand-terracotta); background: #fdfaf8;' : ''} margin-bottom: 0;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 18px;">
                    ${wh.id === 'bar_stock' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>' : (wh.id === 'cold_store' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"></line></svg>' : (wh.type === 'mobile_cart' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 19 21 12 17 5 21 12 2"></polygon></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>'))}
                  </span>
                  <span style="font-size: 16px; font-weight: 700;">${wh.name}</span>
                </div>
                ${isOperating ? '<span style="color: var(--brand-terracotta); display: inline-flex; align-items: center;" title="Active POS Source"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' : `<span class="badge ${wh.type === 'mobile_cart' ? 'badge-pending' : 'badge-neutral'}" style="font-size: 10px;">${wh.type || 'reserve'}</span>`}
              </div>
              <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px; min-height: 32px;">
                ${wh.description}
              </p>
              <div style="display: flex; justify-content: space-between; font-size: 12.5px; border-top: 1px solid ${isOperating ? '#f2ded4' : 'var(--border-light)'}; padding-top: 10px;">
                <span style="font-weight: 600;">${wh.itemCount ? `${wh.itemCount} stock items` : (wh.leadItem || 'Storage unit')}</span>
                <span style="${isOperating ? 'color: #b45309; font-weight: 700;' : 'color: var(--text-muted);'}">
                  ${isOperating ? `${state.inventory.filter(i => i.barStock <= i.barMinimum).length} low-stock alerts` : (wh.leadItem || 'Active location')}
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Main Two-Column Layout (Bar Stock Table + Create Transfer Panel) -->
      <div class="two-col-grid" style="margin-top: 20px;">
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Bar stock</span>
              <a href="#" class="card-link">Manage location ↗</a>
            </div>

            <!-- Filters -->
            <div style="display: flex; gap: 10px; margin-bottom: 16px;">
              <input type="text" class="form-input" placeholder="Search items or SKU" style="flex: 1;" id="inv-search-input">
              <button class="btn btn-outline btn-sm">All items</button>
              <button class="btn btn-outline btn-sm" style="color: #b45309; border-color: #fed7aa; background: #fffcf5;">3 low stock</button>
            </div>

            <table class="erp-table">
              <thead>
                <tr>
                  <th>ITEM / SKU</th>
                  <th>ON HAND</th>
                  <th>MINIMUM</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${state.inventory.map(item => `
                  <tr>
                    <td>
                      <strong>${item.name}</strong><br>
                      <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">${item.sku}</span>
                    </td>
                    <td><strong style="font-size: 13.5px;">${item.barStock} ${item.unit}</strong></td>
                    <td>${item.barMinimum} ${item.unit}</td>
                    <td>
                      <span class="badge ${item.status === 'low' ? 'badge-lowstock' : 'badge-instock'}">
                        ${item.status === 'low' ? 'Low stock' : 'In stock'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="margin-top: 14px; font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between;">
              <span>Showing ${state.inventory.length} stock items</span>
              <span>1 / 2 →</span>
            </div>
          </div>

          <!-- Policy banner -->
          <div class="alert-banner alert-success" style="padding: 10px 14px;">
            <span>POS strictly deducts from Bar stock only. Never touches Dry store, Cold store, or secondary warehouses without explicit transfer.</span>
          </div>

          <!-- Movements Log -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Recent warehouse movements</span>
              <a href="#" class="card-link">Full movement history ↗</a>
            </div>

            <table class="erp-table">
              <thead>
                <tr>
                  <th>REFERENCE</th>
                  <th>MOVEMENT</th>
                  <th>ITEM & QUANTITY</th>
                  <th>HANDLED BY</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${state.warehouseMovements.map(m => `
                  <tr>
                    <td><strong>${m.ref}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${m.time}</span></td>
                    <td>${m.from} → ${m.to}</td>
                    <td><strong>${m.item}</strong> · ${m.qty}</td>
                    <td>${m.handledBy}</td>
                    <td><span class="badge badge-completed">${m.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right: Create a Transfer Panel -->
        <div>
          <div class="card">
            <h3 style="font-family: var(--font-serif); font-size: 20px; font-weight: 600; margin-bottom: 6px;">
              Create a transfer
            </h3>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
              Move stock between locations without changing total inventory.
            </p>

            <form id="form-quick-transfer">
              <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: center; margin-bottom: 14px;">
                <div>
                  <label class="form-label">From warehouse</label>
                  <select class="form-select" id="transfer-from">
                    ${warehouses.filter(w => w.id !== 'bar_stock').map(w => `
                      <option value="${w.id}">${w.name}</option>
                    `).join('')}
                    <option value="bar_stock">Bar stock</option>
                  </select>
                </div>
                <div style="font-size: 16px; margin-top: 20px; color: var(--brand-terracotta);">→</div>
                <div>
                  <label class="form-label">To warehouse</label>
                  <select class="form-select" id="transfer-to">
                    <option value="bar_stock">Bar stock</option>
                    ${warehouses.filter(w => w.id !== 'bar_stock').map(w => `
                      <option value="${w.id}">${w.name}</option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Stock item</label>
                <select class="form-select" id="transfer-item">
                  <option value="BEAN-01">House blend beans (12 kg in Dry store)</option>
                  <option value="DAIRY-01">Whole milk (24 L in Cold store)</option>
                  <option value="BAKE-02">Chocolate cookie (30 pcs in Dry store)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Quantity</label>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <input type="number" step="0.5" class="form-input" id="transfer-qty" value="2" required style="flex: 1;">
                  <span style="font-size: 12px; color: var(--text-muted); width: 100px;">Available: <strong id="transfer-avail-label">12 kg</strong></span>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Reason / note</label>
                <input type="text" class="form-input" id="transfer-reason" value="Bar replenishment">
              </div>

              <div style="background: #faf8f5; border: 1px solid var(--border-medium); border-radius: 6px; padding: 10px; font-size: 11.5px; color: var(--text-muted); margin: 16px 0;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>Traceable movement: balances in both locations update together and log to audit feed.
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px;">
                → Confirm transfer
              </button>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  bindInventoryEvents() {
    document.getElementById('btn-add-warehouse')?.addEventListener('click', () => {
      this.showAddWarehouseModal();
    });

    document.getElementById('btn-trigger-transfer-modal')?.addEventListener('click', () => {
      this.showTransferModal();
    });

    document.getElementById('form-quick-transfer')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fromWh = document.getElementById('transfer-from').value;
      const toWh = document.getElementById('transfer-to').value;
      const sku = document.getElementById('transfer-item').value;
      const qty = document.getElementById('transfer-qty').value;
      const reason = document.getElementById('transfer-reason').value;

      const success = store.transferStock(fromWh, toWh, sku, qty, reason);
      if (success) {
        this.showToast(`Transferred ${qty} of ${sku} to Bar stock.`);
      } else {
        alert('Insufficient stock in source warehouse.');
      }
    });

    document.getElementById('transfer-item')?.addEventListener('change', (e) => {
      const fromWh = document.getElementById('transfer-from');
      const availLabel = document.getElementById('transfer-avail-label');
      if (e.target.value === 'DAIRY-01') {
        fromWh.value = 'cold_store';
        availLabel.textContent = '24 L';
      } else {
        fromWh.value = 'dry_store';
        availLabel.textContent = '12 kg';
      }
    });
  }

  /* ==========================================================================
     7. PRODUCTS & RECIPES VIEW
     ========================================================================== */
  renderRecipesView(state) {
    const selectedProd = state.products.find(p => p.id === this.selectedProductId) || state.products[1];

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Products & recipes</h2>
          <p>Build your menu from the stock you already manage.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-add-product">
            <span>+ Add product</span>
          </button>
        </div>
      </div>

      <div class="two-col-grid" style="grid-template-columns: 320px 1fr;">
        <!-- Left: Menu Products List -->
        <div class="card" style="padding: 16px;">
          <div class="card-header">
            <span class="card-title">Menu products</span>
            <span style="font-size: 12px; color: var(--text-muted);">${state.products.length} items</span>
          </div>

          <input type="text" class="form-input" placeholder="Search name or code" style="margin-bottom: 12px;">

          <div style="display: flex; flex-direction: column; gap: 4px; max-height: 540px; overflow-y: auto;">
            ${state.products.map(p => `
              <div class="recipe-prod-item ${p.id === this.selectedProductId ? 'table-row-selected' : ''}" data-id="${p.id}" style="padding: 10px 12px; border-radius: 6px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border: 1px solid ${p.id === this.selectedProductId ? 'var(--brand-terracotta-border)' : 'transparent'};">
                <div>
                  <div style="font-size: 13.5px; font-weight: 700; color: var(--text-heading);">${p.name}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${p.recipeSummary}</div>
                </div>
                <div style="font-size: 13px; font-weight: 700;">EGP ${p.price.toFixed(0)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right: Recipe Builder & Consumption Preview -->
        <div>
          <div class="card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <h3 style="font-family: var(--font-serif); font-size: 24px; font-weight: 600;">${selectedProd.name}</h3>
              <span class="badge badge-instock">Active at POS</span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 18px;">
              Edit product details and its per-serving recipe.
            </p>

            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div>
                <label class="form-label">Product name</label>
                <input type="text" class="form-input" value="${selectedProd.name}">
              </div>
              <div>
                <label class="form-label">Product code</label>
                <input type="text" class="form-input" value="${selectedProd.code}">
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 24px;">
              <div>
                <label class="form-label">Category</label>
                <select class="form-select">
                  <option>${selectedProd.category}</option>
                  <option>Coffee</option>
                  <option>Iced drinks</option>
                  <option>Non-coffee</option>
                  <option>Bakery</option>
                </select>
              </div>
              <div>
                <label class="form-label">Sale price</label>
                <input type="text" class="form-input" value="EGP ${selectedProd.price.toFixed(2)}">
              </div>
              <div>
                <label class="form-label">Product type</label>
                <select class="form-select">
                  <option>Made to order</option>
                  <option>Packaged</option>
                </select>
              </div>
            </div>

            <!-- Ingredient Recipe Table -->
            <div style="border-top: 1px solid var(--border-light); padding-top: 18px; margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
                <h4 style="font-size: 15px; font-weight: 700;">Ingredient recipe</h4>
                <span style="font-size: 11.5px; color: var(--text-muted);">Per serving · 1 cup</span>
              </div>

              ${selectedProd.ingredients && selectedProd.ingredients.length > 0 ? selectedProd.ingredients.map(ing => `
                <div style="background: #faf8f5; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;">
                  <div style="display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 12px; align-items: center;">
                    <div>
                      <div style="font-size: 10.5px; color: var(--text-muted); font-weight: 600;">EXISTING STOCK INGREDIENT</div>
                      <div style="font-size: 13.5px; font-weight: 700;">${ing.name}</div>
                      <div style="font-size: 10.5px; color: var(--text-muted);">${ing.sku} · Selected from inventory</div>
                    </div>
                    <div>
                      <div style="font-size: 10.5px; color: var(--text-muted); font-weight: 600;">QUANTITY</div>
                      <input type="text" class="form-input" value="${ing.unit === 'kg' ? ing.qty * 1000 : ing.qty}" style="padding: 4px 8px; font-size: 13px;">
                    </div>
                    <div>
                      <div style="font-size: 10.5px; color: var(--text-muted); font-weight: 600;">UNIT</div>
                      <div style="font-size: 13px; font-weight: 700;">${ing.unit === 'kg' ? 'g' : ing.unit}</div>
                    </div>
                    <button class="icon-btn" style="color: #b91c1c;" title="Remove ingredient"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                  </div>
                </div>
              `).join('') : '<p style="font-size:12px; color:var(--text-muted);">Direct stock deduction without sub-recipe.</p>'}

              <button class="btn btn-outline btn-sm" style="margin-top: 6px;">+ Add ingredient</button>
            </div>

            <div class="alert-banner alert-success" style="padding: 8px 12px; margin-bottom: 20px;">
              <span>Saving a recipe does not consume stock. Ingredients are deducted only when a sale is completed.</span>
            </div>

            <!-- Consumption Preview Grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
              <div style="background: #faf8f5; padding: 14px; border-radius: 8px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <span style="font-size: 13px; font-weight: 700;">Consumption preview</span>
                  <span style="font-size: 12px; color: var(--text-muted);">2 servings</span>
                </div>
                <div style="font-size: 12.5px; display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span>House blend beans</span>
                  <strong>30 g</strong>
                </div>
                <div style="font-size: 12.5px; display: flex; justify-content: space-between;">
                  <span>Whole milk</span>
                  <strong>0.2 L</strong>
                </div>
                <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 8px;">
                  Deducts 0.030 kg beans + 0.2 L milk from Bar stock. Preview only.
                </div>
              </div>

              <div style="background: #faf8f5; padding: 14px; border-radius: 8px; border: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <span style="font-size: 13px; font-weight: 700;">Bar stock</span>
                  <span style="font-size: 10.5px; color: var(--brand-terracotta); font-weight: 600;">Café warehouse</span>
                </div>
                <div style="font-size: 12.5px; display: flex; justify-content: space-between; margin-bottom: 4px;">
                  <span>House blend beans</span>
                  <strong>1.8 kg available</strong>
                </div>
                <div style="font-size: 12.5px; display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span>Whole milk</span>
                  <strong>4.5 L available</strong>
                </div>
                <span class="badge badge-instock" style="font-size: 10px;">Enough for this preview</span>
              </div>
            </div>

            <!-- Warning notice -->
            <div style="background: #fff9ea; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; font-size: 12px; color: #92400e;">
              If Bar stock is insufficient, replenish before completing the sale.<br>
              Reserve only: Dry store · 12 kg beans / Cold store · 24 L milk. Never deducted by POS.
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 12px;">
              <button class="btn btn-outline">Discard changes</button>
              <button class="btn btn-primary" id="btn-save-recipe">Save product & recipe</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindRecipesEvents() {
    document.querySelectorAll('.recipe-prod-item').forEach(el => {
      el.addEventListener('click', () => {
        this.selectedProductId = el.getAttribute('data-id');
        this.render();
      });
    });

    document.getElementById('btn-save-recipe')?.addEventListener('click', () => {
      this.showToast('Product recipe saved successfully.');
    });
  }

  /* ==========================================================================
     8. SALES INVOICES & PAYMENTS VIEW
     ========================================================================== */
  renderInvoicesView(state) {
    const selectedInv = state.invoices.find(i => i.id === this.selectedInvoiceId) || state.invoices[0];

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Sales invoices & payments</h2>
          <p>Every invoice traces back to a sale, its payment and its stock movement.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-outline" id="btn-export-invoices">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Export invoices</span>
          </button>
        </div>
      </div>

      <!-- 3 Top Metric Cards -->
      <div class="metrics-grid" style="grid-template-columns: repeat(3, 1fr);">
        <div class="metric-card">
          <div class="metric-title">Invoiced today</div>
          <div class="metric-value">EGP 8,450</div>
          <div class="metric-meta">42 completed sales</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Payments recorded</div>
          <div class="metric-value">EGP 8,200</div>
          <div class="metric-meta">41 paid invoices</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Outstanding</div>
          <div class="metric-value">EGP 250</div>
          <div class="metric-meta alert">1 invoice to collect</div>
        </div>
      </div>

      <div class="two-col-grid">
        <!-- Left: Invoices Table with Tabs -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Sales invoices</span>
            <span style="font-size: 12px; color: var(--text-muted);">Today · 26 Oct ↗</span>
          </div>

          <input type="text" class="form-input" placeholder="Search invoice, sale or customer" style="margin-bottom: 12px;">

          <!-- Tab Pills -->
          <div style="display: flex; gap: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--border-light); padding-bottom: 10px; font-size: 13px;">
            <button class="btn btn-ghost btn-sm" style="font-weight: 700; border-bottom: 2px solid var(--brand-terracotta);">All · ${state.invoices.length}</button>
            <button class="btn btn-ghost btn-sm">Paid · ${state.invoices.filter(i => i.status === 'Paid').length}</button>
            <button class="btn btn-ghost btn-sm" style="color: #b45309;">Unpaid · ${state.invoices.filter(i => i.status === 'Unpaid').length}</button>
          </div>

          <table class="erp-table">
            <thead>
              <tr>
                <th>INVOICE / SALE</th>
                <th>CUSTOMER</th>
                <th>EGP</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              ${state.invoices.map(inv => `
                <tr class="table-row-clickable ${inv.id === this.selectedInvoiceId ? 'table-row-selected' : ''}" data-inv-id="${inv.id}">
                  <td>
                    <strong>${inv.id}</strong><br>
                    <span style="font-size: 11px; color: var(--text-muted);">Sale #${inv.saleId} · ${inv.time}</span>
                  </td>
                  <td>${inv.customer}<br><span style="font-size: 11px; color: var(--text-muted);">${inv.type}</span></td>
                  <td><strong>${inv.total.toFixed(2)}</strong></td>
                  <td>
                    <span class="badge ${inv.status === 'Paid' ? 'badge-paid' : (inv.status === 'Voided' ? 'badge-voided' : 'badge-unpaid')}">
                      ${inv.status}
                    </span>
                    ${inv.isRectified ? `<div style="font-size: 10px; color: #0369a1; font-weight: 600; margin-top: 2px;">Adjusted</div>` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="margin-top: 14px; font-size: 12px; color: var(--text-muted); display: flex; justify-content: space-between;">
            <span>Showing ${state.invoices.length} invoices</span>
            <span>← 1 2 3 ... 6 →</span>
          </div>

          <div style="margin-top: 16px; padding: 10px; background: #fffcf5; border: 1px solid #fed7aa; border-radius: 6px; font-size: 11.5px; color: #92400e;">
            Mistake orders can be modified or voided with automatic recipe ingredient restock to Bar stock.
          </div>
        </div>

        <!-- Right: Itemized Invoice & Stock Audit Panel -->
        <div>
          <div class="card" style="position: sticky; top: 80px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">DRIP CAFÉ · MAIN CAFÉ</div>
                <h3 style="font-family: var(--font-serif); font-size: 26px; font-weight: 700;">${selectedInv.id}</h3>
              </div>
              <span class="badge ${selectedInv.status === 'Paid' ? 'badge-paid' : (selectedInv.status === 'Voided' ? 'badge-voided' : 'badge-unpaid')}">
                ${selectedInv.status === 'Paid' ? 'Paid in full' : (selectedInv.status === 'Voided' ? 'Voided' : 'Unpaid')}
              </span>
            </div>

            ${selectedInv.status === 'Voided' ? `
              <div class="alert-banner alert-warning" style="margin-bottom: 14px; padding: 10px 14px; font-size: 12px;">
                <strong>VOIDED MISTAKE ORDER:</strong> ${selectedInv.rectificationNote || 'Cancelled by cashier'}. Raw ingredients were automatically restocked into Bar stock.
              </div>
            ` : (selectedInv.isRectified ? `
              <div class="alert-banner alert-neutral" style="margin-bottom: 14px; padding: 10px 14px; font-size: 12px;">
                <strong>RECTIFIED ORDER:</strong> ${selectedInv.rectificationNote}.
              </div>
            ` : '')}

            <div style="display: flex; justify-content: space-between; font-size: 12.5px; border-bottom: 1px solid var(--border-light); padding-bottom: 12px; margin-bottom: 14px;">
              <div>
                <strong>${selectedInv.customer}</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${selectedInv.type}</div>
              </div>
              <div style="text-align: right;">
                <span style="color: var(--brand-terracotta); font-weight: 600;">Sale #${selectedInv.saleId} ↗</span>
                <div style="font-size: 11px; color: var(--text-muted);">${selectedInv.date} · ${selectedInv.time}</div>
              </div>
            </div>

            <!-- Items -->
            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
              ${selectedInv.items.map(item => `
                <div style="display: flex; justify-content: space-between; font-size: 13px;">
                  <div>
                    <strong>${item.name}</strong>
                    <div style="font-size: 11px; color: var(--text-muted);">${item.desc || 'Standard'}</div>
                  </div>
                  <div style="text-align: right;">
                    <span>${item.qty} × EGP ${item.unitPrice.toFixed(0)}</span>
                    <div style="font-weight: 700;">EGP ${item.total.toFixed(2)}</div>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- Total Breakdown -->
            <div style="border-top: 1px solid var(--border-light); padding-top: 10px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-muted); margin-bottom: 4px;">
                <span>Subtotal</span>
                <span>${selectedInv.subtotal.toFixed(2)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 12.5px; color: var(--text-muted); margin-bottom: 8px;">
                <span>Tax / service</span>
                <span>0.00</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-family: var(--font-serif); font-size: 22px; font-weight: 700; border-top: 1px solid var(--border-medium); padding-top: 8px;">
                <span>Total</span>
                <span>EGP ${selectedInv.total.toFixed(2)}</span>
              </div>
            </div>

            <!-- Payment Recorded Card -->
            <div style="background: ${selectedInv.status === 'Voided' ? '#fee2e2' : '#f0fdf4'}; border: 1px solid ${selectedInv.status === 'Voided' ? '#fca5a5' : '#bbf7d0'}; border-radius: 8px; padding: 12px; margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; color: ${selectedInv.status === 'Voided' ? '#991b1b' : '#166534'}; margin-bottom: 4px;">
                <span>${selectedInv.status === 'Voided' ? 'Payment cancelled / refunded' : 'Payment recorded'}</span>
                <span>${selectedInv.status === 'Voided' ? 'Voided' : 'Paid'}</span>
              </div>
              <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 700;">
                <span>${selectedInv.paymentMethod} · Tender</span>
                <span>EGP ${selectedInv.total.toFixed(2)}</span>
              </div>
              <div style="font-size: 11px; color: ${selectedInv.status === 'Voided' ? '#991b1b' : '#166534'}; margin-top: 4px;">${selectedInv.paymentRef}</div>
            </div>

            <!-- Stock Posted Audit -->
            <div style="background: #faf8f5; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
              <div style="font-size: 11.5px; font-weight: 700; display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
                <span>Stock audit · Bar stock</span>
              </div>
              <div style="font-size: 11.5px; color: var(--text-muted); margin-bottom: 6px;">
                ${selectedInv.status === 'Voided' ? 'Stock reversed back to Bar stock on invoice cancellation.' : selectedInv.stockDeductionSummary}
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <button class="btn btn-outline" id="btn-print-invoice"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Print invoice</button>
              <button class="btn btn-outline" id="btn-pdf-invoice"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Download PDF</button>
            </div>

            ${selectedInv.status !== 'Voided' ? `
              <button class="btn btn-outline" id="btn-rectify-invoice" style="width: 100%; border-color: #f59e0b; color: #b45309; font-weight: 600;">
                <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Rectify / Void mistake order</span>
              </button>
            ` : `
              <div style="text-align: center; font-size: 11.5px; color: #991b1b; padding: 6px; background: #fee2e2; border-radius: 4px; font-weight: 600;">
                This mistake order is voided and stock is restored.
              </div>
            `}

            <div style="font-size: 10.5px; color: var(--text-muted); text-align: center; margin-top: 12px;">
              Completed by ${selectedInv.cashier} · Main café POS
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindInvoicesEvents() {
    document.querySelectorAll('.table-row-clickable').forEach(row => {
      row.addEventListener('click', () => {
        this.selectedInvoiceId = row.getAttribute('data-inv-id');
        this.render();
      });
    });

    document.getElementById('btn-rectify-invoice')?.addEventListener('click', () => {
      const state = store.getState();
      const selectedInv = state.invoices.find(i => i.id === this.selectedInvoiceId) || state.invoices[0];
      if (selectedInv) {
        this.showRectifyInvoiceModal(selectedInv);
      }
    });

    document.getElementById('btn-print-invoice')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('btn-pdf-invoice')?.addEventListener('click', () => {
      this.showToast('Generating invoice PDF preview...');
    });
  }

  /* ==========================================================================
     9. SUPPLIERS & RECEIVING VIEW
     ========================================================================== */
  renderSuppliersView(state) {
    const selectedRec = state.deliveries.find(d => d.id === this.selectedReceiptId) || state.deliveries[0];

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Suppliers & receiving</h2>
          <p>From supplier delivery to warehouse stock, with a clear paper trail.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-outline" id="btn-add-supplier">
            <span>+ Add supplier</span>
          </button>
          <button class="btn btn-primary" id="btn-new-receipt">
            <span>+ New receipt</span>
          </button>
        </div>
      </div>

      <!-- Overview Highlight Banner -->
      <div class="alert-banner alert-neutral" style="padding: 12px 18px; margin-bottom: 24px;">
        <div style="display: flex; gap: 24px; align-items: center; font-size: 13px;">
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg><strong>2 deliveries expected</strong></span>
          <span>1 received today</span>
          <span>${state.suppliers.length} active suppliers</span>
        </div>
        <a href="#" style="color: var(--brand-terracotta); font-weight: 600; font-size: 12px;">View delivery calendar ↗</a>
      </div>

      <div class="two-col-grid">
        <!-- Left: Receipts Table & Supplier Directory -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Delivery receipts</span>
              <a href="#" class="card-link">All receipts ↗</a>
            </div>

            <input type="text" class="form-input" placeholder="Search reference or supplier" style="margin-bottom: 12px;">

            <table class="erp-table">
              <thead>
                <tr>
                  <th>RECEIPT / SUPPLIER</th>
                  <th>EXPECTED</th>
                  <th>DESTINATION</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${state.deliveries.map(del => `
                  <tr class="table-row-clickable ${del.id === this.selectedReceiptId ? 'table-row-selected' : ''}" data-rcv-id="${del.id}">
                    <td><strong>${del.id}</strong><br>${del.supplier}</td>
                    <td>${del.expected}</td>
                    <td>${del.destination}</td>
                    <td>
                      <span class="badge ${del.status === 'Received' ? 'badge-received' : 'badge-pending'}">
                        ${del.status}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Supplier Directory -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Supplier directory (${state.suppliers.length})</span>
              <a href="#" class="card-link" id="link-add-supplier-inline">+ Add supplier ↗</a>
            </div>

            <table class="erp-table">
              <thead>
                <tr>
                  <th>SUPPLIER</th>
                  <th>CONTACT</th>
                  <th>SUPPLIES</th>
                </tr>
              </thead>
              <tbody>
                ${state.suppliers.map(s => `
                  <tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${s.contact}<br><span style="font-size: 11px; color: var(--text-muted);">${s.phone}</span></td>
                    <td>${s.supplies}<br><span style="font-size: 11px; color: var(--text-muted);">${s.schedule}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Right: Receiving Inspection Slip & Confirmation -->
        <div>
          <div class="card" style="position: sticky; top: 80px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <div style="font-size: 10.5px; color: var(--text-muted); text-transform: uppercase;">DELIVERY RECEIPT</div>
                <h3 style="font-family: var(--font-serif); font-size: 24px; font-weight: 700;">${selectedRec.id}</h3>
              </div>
              <span class="badge ${selectedRec.status === 'Received' ? 'badge-received' : 'badge-pending'}">
                ${selectedRec.status === 'Received' ? 'Received' : 'Pending receipt'}
              </span>
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 16px;">
              <div>
                <strong>${selectedRec.supplier}</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${selectedRec.poRef}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 10.5px; color: var(--text-muted);">EXPECTED TODAY</div>
                <strong>15:00–16:00</strong>
              </div>
            </div>

            <form id="form-confirm-receipt">
              <div class="form-group">
                <label class="form-label">Destination warehouse</label>
                <select class="form-select" id="rcv-destination-wh">
                  ${(state.warehouses || []).map(wh => `
                    <option value="${wh.id}" ${selectedRec.destination === wh.name ? 'selected' : ''}>
                      ${wh.name} (${wh.type || 'Storage'})
                    </option>
                  `).join('')}
                </select>
                <div class="form-hint">Received quantities will be added here, not to Bar stock automatically.</div>
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 4px;">
                  <label class="form-label">Items to receive</label>
                  <span style="font-size: 11px; color: var(--text-muted);">Ordered: ${selectedRec.orderedQty} ${selectedRec.unit}</span>
                </div>
                <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                  <div style="font-size: 13px; font-weight: 700;">${selectedRec.item}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${selectedRec.sku} · EGP ${selectedRec.unitPrice.toFixed(0)} / ${selectedRec.unit}</div>
                </div>

                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px;">
                  <div>
                    <label class="form-label" style="font-size: 11px;">Received quantity</label>
                    <input type="number" class="form-input" id="rcv-qty-input" value="${selectedRec.receivedQty}">
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 11px;">Unit</label>
                    <select class="form-select">
                      <option>${selectedRec.unit}</option>
                    </select>
                  </div>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: baseline; font-size: 15px; font-weight: 700; margin: 16px 0; padding-top: 10px; border-top: 1px solid var(--border-light);">
                <span>Receipt value</span>
                <span style="font-family: var(--font-serif); font-size: 22px;">EGP ${selectedRec.totalValue.toFixed(2)}</span>
              </div>

              <div class="form-group">
                <label class="form-label">Delivery note</label>
                <input type="text" class="form-input" placeholder="Add a note or discrepancy...">
              </div>

              <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px; margin-bottom: 16px;">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                  <input type="checkbox" checked required>
                  <span>Quantity and packaging checked</span>
                </label>
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                  <input type="checkbox" checked required>
                  <span>Quality and expiry checked</span>
                </label>
              </div>

              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; font-size: 11.5px; color: #166534; margin-bottom: 16px;">
                Confirming adds ${selectedRec.receivedQty} ${selectedRec.unit} to ${selectedRec.destination} and updates inventory with full audit log.
              </div>

              <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 10px;">
                <button type="button" class="btn btn-outline">Save draft</button>
                <button type="submit" class="btn btn-primary" ${selectedRec.status === 'Received' ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
                  <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg> Confirm receiving</span>
                </button>
              </div>
            </form>

            <div style="font-size: 10.5px; color: var(--text-muted); text-align: center; margin-top: 12px;">
              Prepared by ${selectedRec.preparedBy}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindSuppliersEvents() {
    document.getElementById('btn-add-supplier')?.addEventListener('click', () => {
      this.showAddSupplierModal();
    });

    document.getElementById('link-add-supplier-inline')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showAddSupplierModal();
    });

    document.getElementById('btn-new-receipt')?.addEventListener('click', () => {
      this.showToast('Select an expected delivery from the list to inspect and receive into storage.');
    });

    document.querySelectorAll('.table-row-clickable').forEach(row => {
      row.addEventListener('click', () => {
        this.selectedReceiptId = row.getAttribute('data-rcv-id');
        this.render();
      });
    });

    document.getElementById('form-confirm-receipt')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const destWh = document.getElementById('rcv-destination-wh').value;
      const qty = document.getElementById('rcv-qty-input').value;
      store.receiveDelivery(this.selectedReceiptId, destWh, qty);
      this.showToast(`Delivery ${this.selectedReceiptId} confirmed and stock added.`);
    });
  }

  /* ==========================================================================
     10. TEAM & PERMISSIONS VIEW
     ========================================================================== */
  renderTeamView(state) {
    const rolePermissions = state.rolePermissions[this.selectedRole] || state.rolePermissions.Barista;

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Team & permissions</h2>
          <p>Give each person just the access they need to do their work.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-invite-user">
            <span style="display: inline-flex; align-items: center; gap: 4px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg> Invite user</span>
          </button>
        </div>
      </div>

      <div style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 20px;">
        <strong>5 active accounts</strong> · 3 admin-role accounts · 2 baristas · 1 branch
      </div>

      <div class="two-col-grid">
        <!-- Left: Staff List & Simple Access Structure -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">People with system access</span>
              <a href="#" class="card-link">Activity log ↗</a>
            </div>

            <input type="text" class="form-input" placeholder="Search name or email" style="margin-bottom: 14px;">

            <table class="erp-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>ROLE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                ${state.team.map(m => `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="avatar-circle">${m.initials}</div>
                        <div>
                          <strong>${m.name}</strong><br>
                          <span style="font-size: 11px; color: var(--text-muted);">${m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>${m.role}</strong><br>
                      <span style="font-size: 11px; color: var(--text-muted);">${m.scope}</span>
                    </td>
                    <td>
                      <span class="badge badge-active">${m.status}</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>

            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 14px;">
              All accounts belong to Main café.
            </div>
          </div>

          <div style="background: #faf8f5; border: 1px solid var(--border-light); border-radius: 8px; padding: 12px 14px; font-size: 12px; color: var(--text-muted); margin-bottom: 20px;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>Part-time staff do not need system accounts. Only people who use the POS or manage café operations need access.
          </div>

          <!-- Simple Access Structure Card -->
          <div class="card">
            <h4 style="font-family: var(--font-serif); font-size: 18px; font-weight: 600; margin-bottom: 12px;">
              A simple access structure
            </h4>

            <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px;">
              <div>
                <strong>Owner · 1 account</strong>
                <p style="font-size: 11.5px; color: var(--text-muted);">Full access, including permissions and business settings.</p>
              </div>
              <div>
                <strong>Administrator · 2 accounts</strong>
                <p style="font-size: 11.5px; color: var(--text-muted);">Manage daily operations, inventory, receiving and invoices.</p>
              </div>
              <div>
                <strong>Barista · 2 accounts</strong>
                <p style="font-size: 11.5px; color: var(--text-muted);">Take orders, record payments and view available bar stock.</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Role Permissions Matrix -->
        <div>
          <div class="card" style="position: sticky; top: 80px;">
            <div class="card-header">
              <span class="card-title">Role permissions</span>
            </div>

            <!-- Role Selector Tabs -->
            <div style="display: flex; gap: 6px; margin-bottom: 16px; background: #faf8f5; padding: 4px; border-radius: 6px;">
              <button class="btn btn-sm ${this.selectedRole === 'Owner' ? 'btn-primary' : 'btn-outline'}" data-role="Owner" style="flex: 1;">Owner</button>
              <button class="btn btn-sm ${this.selectedRole === 'Administrator' ? 'btn-primary' : 'btn-outline'}" data-role="Administrator" style="flex: 1;">Administrator</button>
              <button class="btn btn-sm ${this.selectedRole === 'Barista' ? 'btn-primary' : 'btn-outline'}" data-role="Barista" style="flex: 1;">Barista</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px;">
              <h4 style="font-family: var(--font-serif); font-size: 20px; font-weight: 600;">${this.selectedRole}</h4>
              <span style="font-size: 11.5px; color: var(--text-muted);">Applies to ${this.selectedRole === 'Barista' ? 'Omar Nabil and Nour Farid' : 'Sara Ali and Youssef Adel'}</span>
            </div>

            <!-- Toggle Permissions List -->
            <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Use POS & complete sales</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Orders, modifiers and manual payment recording</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.usePOS ? 'checked' : ''} data-perm="usePOS">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">View own sales & invoices</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Read receipts from their own completed orders</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.viewOwnInvoices ? 'checked' : ''} data-perm="viewOwnInvoices">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">View Bar stock</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Read available quantities; no stock adjustments</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.viewBarStock ? 'checked' : ''} data-perm="viewBarStock">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Apply discounts</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Change the price of an order</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.applyDiscounts ? 'checked' : ''} data-perm="applyDiscounts">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Refund or void completed sales</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Reverse a sale and its linked stock movement</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.refundVoid ? 'checked' : ''} data-perm="refundVoid">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Manage warehouses & receiving</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Transfers, adjustments, suppliers and receipts</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.manageInventory ? 'checked' : ''} data-perm="manageInventory">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Manage team & permissions</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Invite users or change role access</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.manageTeam ? 'checked' : ''} data-perm="manageTeam">
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Edit admin settings</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Branch, invoice, payment and device setup</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" ${rolePermissions.editAdminSettings ? 'checked' : ''} data-perm="editAdminSettings">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div style="background: #faf8f5; border: 1px solid var(--border-light); border-radius: 6px; padding: 10px; font-size: 11.5px; color: var(--text-muted); margin-bottom: 16px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>Role changes apply to all baristas. Owner access cannot be removed.
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button class="btn btn-outline" id="btn-reset-perms">Reset changes</button>
              <button class="btn btn-primary" id="btn-save-perms">Save permissions</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  bindTeamEvents() {
    document.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedRole = btn.getAttribute('data-role');
        this.render();
      });
    });

    document.querySelectorAll('[data-perm]').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const permKey = toggle.getAttribute('data-perm');
        store.togglePermission(this.selectedRole, permKey, e.target.checked);
      });
    });

    document.getElementById('btn-save-perms')?.addEventListener('click', () => {
      this.showToast(`Saved permissions for role ${this.selectedRole}.`);
    });
  }

  /* ==========================================================================
     11. ADMIN SETTINGS VIEW
     ========================================================================== */
  renderSettingsView(state) {
    const activeTab = this.activeSettingsTab || 'branch';
    const devices = state.devices || [];
    const paymentMethods = state.paymentMethods || [];

    const tabs = [
      { id: 'branch', label: 'Branch & Operations', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>' },
      { id: 'fiscal', label: 'Fiscal & Invoicing', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"></rect><line x1="2" y1="10" x2="22" y2="10"></line></svg>' },
      { id: 'tenders', label: 'Payment Methods', badge: `${paymentMethods.filter(p => p.enabled).length}/${paymentMethods.length}`, icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>' },
      { id: 'devices', label: 'Peripherals & Hardware', badge: `${devices.filter(d => d.isOnline).length} Active`, icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>' },
      { id: 'backup', label: 'Data & Backups', icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' }
    ];

    let contentHtml = '';
    if (activeTab === 'branch') {
      contentHtml = this.renderSettingsBranchTab(state);
    } else if (activeTab === 'fiscal') {
      contentHtml = this.renderSettingsFiscalTab(state);
    } else if (activeTab === 'tenders') {
      contentHtml = this.renderSettingsTendersTab(state);
    } else if (activeTab === 'devices') {
      contentHtml = this.renderSettingsDevicesTab(state);
    } else if (activeTab === 'backup') {
      contentHtml = this.renderSettingsBackupTab(state);
    }

    return `
      <div class="view-header">
        <div class="view-titles">
          <h2>Store Configuration & Control</h2>
          <p>Real-time settings for Main café, Zamalek. Changes sync immediately across POS registers.</p>
        </div>
        <div class="view-actions">
          <button class="btn btn-primary" id="btn-save-settings">
            Save changes
          </button>
        </div>
      </div>

      <!-- Settings Sub-Tabs Navigation -->
      <div class="settings-subtabs-nav" id="settings-tabs-container">
        ${tabs.map(tab => `
          <button class="settings-tab-btn ${tab.id === activeTab ? 'active' : ''}" data-settings-tab="${tab.id}">
            ${tab.icon}
            <span>${tab.label}</span>
            ${tab.badge ? `<span class="settings-tab-badge">${tab.badge}</span>` : ''}
          </button>
        `).join('')}
      </div>

      <!-- Tab Content Area -->
      <div class="settings-tab-content">
        ${contentHtml}
      </div>
    `;
  }

  renderSettingsBranchTab(state) {
    const branch = state.branch;
    const policies = state.policies || {};

    return `
      <div class="two-col-grid">
        <!-- Left: Branch Configuration -->
        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <span class="card-title">Branch configuration</span>
                <div style="font-size: 11px; color: var(--text-muted);">Primary café operating profile</div>
              </div>
              <span class="badge badge-draft">Main café · Active</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div>
                <label class="form-label">Business name</label>
                <input type="text" class="form-input" id="cfg-business" value="${branch.businessName}">
              </div>
              <div>
                <label class="form-label">Branch name</label>
                <input type="text" class="form-input" id="cfg-branch" value="${branch.branchName}">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Location / street address</label>
              <input type="text" class="form-input" id="cfg-location" value="${branch.location}">
            </div>

            <div class="form-group">
              <label class="form-label">Contact phone / WhatsApp</label>
              <input type="text" class="form-input" id="cfg-phone" value="${branch.phone || '+20 100 123 4567'}">
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div>
                <label class="form-label">Operating currency</label>
                <select class="form-select" id="cfg-currency">
                  <option value="EGP" selected>${branch.currencyLabel}</option>
                  <option value="USD">USD · US dollar</option>
                  <option value="EUR">EUR · Euro</option>
                </select>
              </div>
              <div>
                <label class="form-label">Time zone</label>
                <select class="form-select" id="cfg-timezone">
                  <option value="Africa/Cairo" selected>${branch.timezone}</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">POS stock deduction warehouse</label>
              <select class="form-select" id="cfg-warehouse">
                <option value="Bar stock" selected>Bar stock (Café floor · POS primary)</option>
              </select>
              <div class="form-hint">Bar stock is the active café operating warehouse. Completed POS sales deduct recipe ingredients exclusively from this warehouse, never from reserve storage.</div>
            </div>
          </div>
        </div>

        <!-- Right: Recipe operations & Session policies -->
        <div>
          <!-- Recipe and Warehouse Operations Card -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">Recipe and warehouse operations</span>
              <a href="#" class="card-link" id="link-to-recipes-page">Products & recipes ↗</a>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 14px;">
              Define sellable products from ingredient recipes and keep POS stock isolated from reserve storage.
            </p>

            <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px; margin-bottom: 14px;">
              <div style="font-size: 13px; font-weight: 700; margin-bottom: 2px;">Sellable products are built from ingredient recipes</div>
              <div style="font-size: 11px; color: var(--text-muted);">Examples: Espresso · 18 g beans; Flat white · 18 g beans + 160 ml milk. Recipe specs are maintained in Products & recipes.</div>
            </div>

            <div style="background: #fff9ea; border: 1px solid #fde68a; border-radius: 6px; padding: 10px; font-size: 11.5px; color: #92400e; margin-bottom: 12px; display: flex; align-items: flex-start; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" style="flex-shrink:0; margin-top:1px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              <span>Dry store and Cold store are reserve locations. They are never used as direct POS deduction locations and only replenish Bar stock through explicit transfers.</span>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span><strong>Recipe deductions happen only on completed sales:</strong> Draft orders and cart edits do not deduct stock until paid.</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                <span><strong>Transfers replenish Bar stock:</strong> Use an explicit warehouse transfer to move stock from reserve storage.</span>
              </div>
            </div>
          </div>

          <!-- POS sign-in and session controls -->
          <div class="card">
            <div class="card-header">
              <span class="card-title">POS sign-in and session controls</span>
              <a href="#" class="card-link" id="link-to-register-sessions">Register sessions ↗</a>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 16px;">
              Configure cash control policies, register authentication, and end-of-shift reconciliation rules.
            </p>

            <div style="display: flex; flex-direction: column; gap: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Require cashier sign-in before opening a session</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Cashiers must identify before opening a register. Selling remains locked until a session is active.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="policy-signin" ${policies.requireCashierSignIn !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Require an open session before POS sales</div>
                  <div style="font-size: 11px; color: var(--text-muted);">POS sales can only be completed after a register session is opened. Opening cash is recorded first.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="policy-session" ${policies.requireOpenSession !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Enforce blind drawer cash drop at shift closing</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Cashiers count drawer cash blind without seeing expected drawer total before submitting closing count.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="policy-blind-drop" ${policies.enforceBlindDrawerDrop !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Auto-print customer receipt upon payment completion</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Immediately dispatch ESC/POS print job to the bar receipt printer when an invoice is settled.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="policy-autoprint" ${policies.printReceiptOnCompletion !== false ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderSettingsFiscalTab(state) {
    const branch = state.branch;
    const taxRate = branch.taxRate !== undefined ? branch.taxRate : 14;
    const serviceCharge = branch.serviceCharge !== undefined ? branch.serviceCharge : 12;

    const sampleSub = 180.00;
    const sampleTax = +(sampleSub * (taxRate / 100)).toFixed(2);
    const sampleService = +(sampleSub * (serviceCharge / 100)).toFixed(2);
    const sampleTotal = +(sampleSub + sampleTax + sampleService).toFixed(2);

    return `
      <div class="two-col-grid">
        <!-- Left: Invoicing & Fiscal parameters -->
        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <span class="card-title">Fiscal & Invoicing Preferences</span>
                <div style="font-size: 11px; color: var(--text-muted);">Egypt ETA E-Receipt & Sales Tax Parameters</div>
              </div>
              <span class="badge badge-paid">Tax Configured</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div>
                <label class="form-label">Invoice prefix</label>
                <input type="text" class="form-input" id="cfg-inv-prefix" value="${branch.invoicePrefix || 'INV-'}">
              </div>
              <div>
                <label class="form-label">Next invoice sequence number</label>
                <input type="number" class="form-input" id="cfg-inv-next" value="${branch.nextInvoiceNumber || 43}">
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div>
                <label class="form-label">Value Added Tax (VAT %)</label>
                <input type="number" step="0.5" min="0" max="100" class="form-input" id="cfg-tax-rate" value="${taxRate}">
                <div class="form-hint">Standard Egypt VAT is 14.0%</div>
              </div>
              <div>
                <label class="form-label">Dine-in service charge (%)</label>
                <input type="number" step="0.5" min="0" max="100" class="form-input" id="cfg-service-charge" value="${serviceCharge}">
                <div class="form-hint">Standard hospitality service is 12.0%</div>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Tax registration number (TRN / ETA)</label>
              <input type="text" class="form-input" id="cfg-tax-reg" value="${branch.taxReg || '614-239-810'}">
            </div>

            <div class="form-group">
              <label class="form-label">Receipt footer note</label>
              <input type="text" class="form-input" id="cfg-receipt-footer" value="${branch.receiptFooter || 'Thank you for choosing Drip Café.'}">
              <div class="form-hint">Appears at the bottom of printed thermal receipts and PDF invoices.</div>
            </div>
          </div>

          <!-- Live Calculator Card -->
          <div class="fiscal-calc-card">
            <div class="fiscal-calc-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"></path></svg>
              <span>Live Fiscal Impact Breakdown (Sample Order: 2× Flat white)</span>
            </div>
            <div class="calc-row">
              <span style="color: var(--text-muted);">Sample Items Subtotal:</span>
              <span style="font-family: var(--font-mono); font-weight: 600;">EGP 180.00</span>
            </div>
            <div class="calc-row">
              <span style="color: var(--text-muted);">VAT (<span id="calc-preview-vat-rate">${taxRate}</span>%):</span>
              <span style="font-family: var(--font-mono); font-weight: 600;" id="calc-preview-vat-amount">EGP ${sampleTax.toFixed(2)}</span>
            </div>
            <div class="calc-row">
              <span style="color: var(--text-muted);">Service charge (<span id="calc-preview-srv-rate">${serviceCharge}</span>%):</span>
              <span style="font-family: var(--font-mono); font-weight: 600;" id="calc-preview-srv-amount">EGP ${sampleService.toFixed(2)}</span>
            </div>
            <div class="calc-row calc-total">
              <span>Customer Payable Total:</span>
              <span id="calc-preview-total">EGP ${sampleTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <!-- Right: Authentic Thermal Receipt Preview -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Live Thermal Receipt Preview</span>
              <button class="btn btn-secondary btn-sm" id="btn-test-print-receipt">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                Print test receipt
              </button>
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">
              Visual mockup of physical 80mm thermal receipt delivered to the barista printer.
            </p>

            <div class="receipt-preview-box">
              <div class="receipt-header">
                <div class="receipt-logo">${branch.businessName}</div>
                <div class="receipt-branch">${branch.branchName} · ${branch.location}</div>
                <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Tax ID: ${branch.taxReg || '614-239-810'} · ETA Compliant</div>
              </div>

              <div class="receipt-divider"></div>

              <div style="font-size: 11px; margin-bottom: 8px;">
                <div style="display: flex; justify-content: space-between;">
                  <span>Invoice: <strong>${branch.invoicePrefix || 'INV-'}${String(branch.nextInvoiceNumber || 43).padStart(4, '0')}</strong></span>
                  <span>Table 04</span>
                </div>
                <div style="display: flex; justify-content: space-between; color: var(--text-muted); margin-top: 2px;">
                  <span>26 Oct 2026 · 14:35</span>
                  <span>Cashier: Omar N.</span>
                </div>
              </div>

              <div class="receipt-divider"></div>

              <div class="receipt-item-row">
                <span>2× Flat white</span>
                <span style="font-family: var(--font-mono);">180.00</span>
              </div>
              <div style="font-size: 10.5px; color: var(--text-muted); padding-left: 8px; margin-bottom: 4px;">Whole milk · Double shot</div>

              <div class="receipt-divider"></div>

              <div class="receipt-item-row">
                <span style="color: var(--text-muted);">Subtotal</span>
                <span style="font-family: var(--font-mono);">180.00</span>
              </div>
              <div class="receipt-item-row">
                <span style="color: var(--text-muted);">VAT (${taxRate}%)</span>
                <span style="font-family: var(--font-mono);">${sampleTax.toFixed(2)}</span>
              </div>
              <div class="receipt-item-row">
                <span style="color: var(--text-muted);">Service charge (${serviceCharge}%)</span>
                <span style="font-family: var(--font-mono);">${sampleService.toFixed(2)}</span>
              </div>

              <div class="receipt-divider"></div>

              <div style="display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; padding: 4px 0;">
                <span>TOTAL EGP</span>
                <span style="font-family: var(--font-mono); color: var(--brand-terracotta);">${sampleTotal.toFixed(2)}</span>
              </div>

              <div class="receipt-divider"></div>

              <div class="receipt-footer-text">
                <div>${branch.receiptFooter || 'Thank you for choosing Drip Café.'}</div>
                <div style="font-size: 10px; margin-top: 4px; color: var(--text-muted);">Zamalek, Cairo · Wi-Fi: DripGuest (drip2026)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderSettingsTendersTab(state) {
    const paymentMethods = state.paymentMethods || [];

    const getTenderIcon = (id) => {
      if (id === 'cash') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg>';
      } else if (id === 'card') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>';
      } else if (id === 'instapay') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polyline></svg>';
      }
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>';
    };

    return `
      <div class="two-col-grid">
        <!-- Left: Payment Methods List -->
        <div>
          <div class="card">
            <div class="card-header">
              <div>
                <span class="card-title">Accepted Payment Tenders</span>
                <div style="font-size: 11px; color: var(--text-muted);">${paymentMethods.filter(p => p.enabled).length} of ${paymentMethods.length} tender channels enabled</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-add-tender-notice">
                + Add Custom Tender
              </button>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 16px;">
              Toggle active tenders shown to baristas on POS checkout and configure transaction surcharges.
            </p>

            ${paymentMethods.map(method => `
              <div class="tender-card">
                <div class="tender-info">
                  <div class="tender-icon-box">
                    ${getTenderIcon(method.id)}
                  </div>
                  <div class="tender-text">
                    <h4>
                      <span>${method.name}</span>
                      <span class="badge ${method.enabled ? 'badge-paid' : 'badge-draft'}">${method.enabled ? 'Active' : 'Disabled'}</span>
                      ${method.feePercentage > 0 ? `<span style="font-size: 11px; font-weight: 500; color: var(--text-muted);">(${method.feePercentage}% fee)</span>` : ''}
                    </h4>
                    <p>${method.description}</p>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                  <label class="toggle-switch">
                    <input type="checkbox" class="tender-toggle" data-tender-id="${method.id}" ${method.enabled ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Right: Tender Policies & Payment Rules -->
        <div>
          <div class="card">
            <div class="card-header">
              <span class="card-title">Checkout & Tender Policies</span>
            </div>
            <p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 16px;">
              Rules controlling POS cashier change handling and payment receipt validation.
            </p>

            <div style="display: flex; flex-direction: column; gap: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Allow split payment across multiple tenders</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Enable guests to split a check (e.g. partial cash + partial card or InstaPay).</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Round cash change to nearest EGP 0.50</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Standard Egyptian coin denomination rounding to prevent small-change drawer shortages.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <div style="font-size: 13px; font-weight: 600;">Require customer phone on InstaPay payments</div>
                  <div style="font-size: 11px; color: var(--text-muted);">Record buyer mobile reference on InstaPay QR transfers for accounting reconciliation.</div>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox">
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div style="background: #faf8f5; border: 1px solid var(--border-light); border-radius: 6px; padding: 12px; margin-top: 18px; font-size: 12px; color: var(--text-muted); display: flex; align-items: flex-start; gap: 8px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; margin-top:1px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <span>Instant Bank Transfers via InstaPay settle immediately to the Drip Café National Bank of Egypt (NBE) account with zero merchant interchange fee.</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderSettingsDevicesTab(state) {
    const devices = state.devices || [];

    const getDeviceIcon = (id) => {
      if (id === 'receipt-printer') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>';
      } else if (id === 'card-terminal') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="3"></rect><line x1="2" y1="8" x2="22" y2="8"></line><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line><line x1="14" y1="16" x2="14.01" y2="16"></line></svg>';
      } else if (id === 'instapay-qr') {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="9"></line><line x1="9" y1="15" x2="15" y2="15"></line><line x1="12" y1="9" x2="12" y2="15"></line></svg>';
      }
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"></path><circle cx="12" cy="12" r="1"></circle></svg>';
    };

    return `
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="status-dot" style="background: #16a34a; box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2);"></span>
          <div>
            <div style="font-size: 13.5px; font-weight: 700; color: #166534;">Hardware Mesh Active · POS-01 Counter Terminal</div>
            <div style="font-size: 11.5px; color: #15803d;">All 4 counter peripherals online and responding to local LAN & USB polling.</div>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-device-refresh-all">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Poll All Hardware
        </button>
      </div>

      <div class="device-grid">
        ${devices.map(d => `
          <div class="device-card">
            <div>
              <div class="device-header">
                <div class="device-title-area">
                  <div class="device-icon-box">
                    ${getDeviceIcon(d.id)}
                  </div>
                  <div>
                    <div class="device-name">${d.name}</div>
                    <div class="device-model">${d.model}</div>
                  </div>
                </div>
                <span class="badge ${d.isOnline ? 'badge-paid' : 'badge-draft'}">
                  ${d.status}
                </span>
              </div>

              <div class="device-details-box">
                <div class="device-meta-row">
                  <span class="device-meta-label">Assigned Role:</span>
                  <span style="font-weight: 600;">${d.role}</span>
                </div>
                <div class="device-meta-row">
                  <span class="device-meta-label">Interface:</span>
                  <span class="device-meta-val">${d.interface}</span>
                </div>
                <div class="device-meta-row">
                  <span class="device-meta-label">Last Polled:</span>
                  <span class="device-meta-val" id="device-ping-${d.id}">${d.lastPing}</span>
                </div>
              </div>
            </div>

            <div class="device-actions">
              ${d.id === 'receipt-printer' ? `
                <button class="btn btn-secondary btn-sm" id="btn-test-printer" style="width: 100%;">
                  Test ESC/POS Print
                </button>
              ` : d.id === 'card-terminal' ? `
                <button class="btn btn-secondary btn-sm" id="btn-test-terminal" style="width: 100%;">
                  Ping Terminal Echo
                </button>
              ` : d.id === 'instapay-qr' ? `
                <button class="btn btn-secondary btn-sm" id="btn-test-qr" style="width: 100%;">
                  Push Sample QR
                </button>
              ` : `
                <button class="btn btn-secondary btn-sm" id="btn-test-scanner" style="width: 100%;">
                  Simulate Barcode Scan
                </button>
              `}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <div class="card-header">
          <span class="card-title">Peripheral Connection Diagnostics & Protocols</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; font-size: 12px; color: var(--text-muted);">
          <div>
            <strong style="color: var(--text-dark);">ESC/POS Thermal Printing:</strong>
            <p style="margin-top: 4px;">Drip Café communicates directly with the Epson TM-T88VI over TCP port 9100 on local subnet 192.168.1.0/24 with full Arabic CP864 font codepage support.</p>
          </div>
          <div>
            <strong style="color: var(--text-dark);">Bank Acquirer Protocol:</strong>
            <p style="margin-top: 4px;">The PAX A920 smart terminal pairs via local TLS socket to receive purchase intents, avoiding manual entry errors during busy barista rushes.</p>
          </div>
          <div>
            <strong style="color: var(--text-dark);">Barcode HID Engine:</strong>
            <p style="margin-top: 4px;">The Honeywell 1950g scans 1D retail UPCs on beans and syrups into the inventory matrix with instant automatic form submission.</p>
          </div>
        </div>
      </div>
    `;
  }

  renderSettingsBackupTab(state) {
    const jsonStr = JSON.stringify(state);
    const sizeKb = (jsonStr.length / 1024).toFixed(1);

    return `
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <div>
            <span class="card-title">Live Database Telemetry & Local Storage Footprint</span>
            <div style="font-size: 11px; color: var(--text-muted);">High-reliability client-side storage architecture</div>
          </div>
          <span class="badge badge-paid">Healthy · ${sizeKb} KB</span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-top: 10px;">
          <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Menu Products</div>
            <div style="font-size: 20px; font-weight: 700; color: var(--text-dark); margin-top: 4px;">${state.products ? state.products.length : 0}</div>
          </div>
          <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Inventory SKUs</div>
            <div style="font-size: 20px; font-weight: 700; color: var(--text-dark); margin-top: 4px;">${state.inventory ? state.inventory.length : 0}</div>
          </div>
          <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Fiscal Invoices</div>
            <div style="font-size: 20px; font-weight: 700; color: var(--text-dark); margin-top: 4px;">${state.invoices ? state.invoices.length : 0}</div>
          </div>
          <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Warehouse Moves</div>
            <div style="font-size: 20px; font-weight: 700; color: var(--text-dark); margin-top: 4px;">${state.warehouseMovements ? state.warehouseMovements.length : 0}</div>
          </div>
          <div style="background: #faf8f5; border: 1px solid var(--border-light); padding: 12px; border-radius: 6px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Warehouses</div>
            <div style="font-size: 20px; font-weight: 700; color: var(--text-dark); margin-top: 4px;">3 (1 Bar, 2 Res)</div>
          </div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div class="backup-card">
          <div>
            <div class="backup-card-header">
              <div class="backup-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 14px; font-weight: 700;">Export JSON Snapshot</h4>
                <div style="font-size: 11px; color: var(--text-muted);">Complete database archive</div>
              </div>
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
              Download a complete JSON backup of all sales, ingredient stock counts, recipes, register sessions, and preferences for offline archiving or audits.
            </p>
          </div>
          <button class="btn btn-primary" id="btn-export-backup" style="width: 100%;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download Database Backup (.json)
          </button>
        </div>

        <div class="backup-card">
          <div>
            <div class="backup-card-header">
              <div class="backup-icon" style="background: #eff6ff; color: #2563eb;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 14px; font-weight: 700;">Restore from Backup</h4>
                <div style="font-size: 11px; color: var(--text-muted);">Re-import JSON database file</div>
              </div>
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
              Restore your café records from a previously exported backup file. Data is validated for schema integrity before replacing active state.
            </p>
          </div>
          <div>
            <input type="file" id="input-restore-file" accept=".json" style="display: none;">
            <button class="btn btn-secondary" id="btn-trigger-restore" style="width: 100%;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload & Restore Backup File
            </button>
          </div>
        </div>

        <div class="backup-card">
          <div>
            <div class="backup-card-header">
              <div class="backup-icon" style="background: #fef2f2; color: #dc2626;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
              </div>
              <div>
                <h4 style="margin: 0; font-size: 14px; font-weight: 700;">Revert to Factory Baseline</h4>
                <div style="font-size: 11px; color: var(--text-muted);">Clean slate reset</div>
              </div>
            </div>
            <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 16px;">
              Restore the initial out-of-the-box Zamalek café sample inventory, recipes, shift records, and pre-loaded invoices.
            </p>
          </div>
          <button class="btn btn-secondary" id="btn-backup-factory-reset" style="width: 100%; color: #dc2626; border-color: #fecaca;">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
            Restore Default Baseline
          </button>
        </div>
      </div>
    `;
  }

  bindSettingsEvents() {
    const state = store.getState();

    // 1. Sub-tab switching
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-settings-tab');
        if (targetTab && targetTab !== this.activeSettingsTab) {
          this.activeSettingsTab = targetTab;
          this.render();
        }
      });
    });

    // 2. Save Settings Button
    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const biz = document.getElementById('cfg-business')?.value ?? state.branch.businessName;
      const branchName = document.getElementById('cfg-branch')?.value ?? state.branch.branchName;
      const loc = document.getElementById('cfg-location')?.value ?? state.branch.location;
      const phone = document.getElementById('cfg-phone')?.value ?? (state.branch.phone || '+20 100 123 4567');
      const prefix = document.getElementById('cfg-inv-prefix')?.value ?? state.branch.invoicePrefix;
      const nextNum = document.getElementById('cfg-inv-next') ? parseInt(document.getElementById('cfg-inv-next').value, 10) : state.branch.nextInvoiceNumber;
      const taxRate = document.getElementById('cfg-tax-rate') ? parseFloat(document.getElementById('cfg-tax-rate').value) : state.branch.taxRate;
      const serviceCharge = document.getElementById('cfg-service-charge') ? parseFloat(document.getElementById('cfg-service-charge').value) : state.branch.serviceCharge;
      const footer = document.getElementById('cfg-receipt-footer')?.value ?? state.branch.receiptFooter;
      const taxReg = document.getElementById('cfg-tax-reg')?.value ?? (state.branch.taxReg || '614-239-810');

      store.updateSettings({
        businessName: biz,
        branchName: branchName,
        location: loc,
        phone: phone,
        invoicePrefix: prefix,
        nextInvoiceNumber: isNaN(nextNum) ? state.branch.nextInvoiceNumber : nextNum,
        taxRate: isNaN(taxRate) ? state.branch.taxRate : taxRate,
        serviceCharge: isNaN(serviceCharge) ? state.branch.serviceCharge : serviceCharge,
        receiptFooter: footer,
        taxReg: taxReg
      });

      // Also save policies if on branch tab
      if (document.getElementById('policy-signin')) {
        store.updatePolicies({
          requireCashierSignIn: document.getElementById('policy-signin').checked,
          requireOpenSession: document.getElementById('policy-session').checked,
          enforceBlindDrawerDrop: document.getElementById('policy-blind-drop').checked,
          printReceiptOnCompletion: document.getElementById('policy-autoprint').checked
        });
      }

      this.showToast('Workspace settings saved successfully.');
    });

    // 3. Navigation shortcuts
    document.getElementById('link-to-recipes-page')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('recipes');
    });

    document.getElementById('link-to-register-sessions')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.navigateTo('session-close');
    });

    // 4. Live Fiscal Rate preview updater
    const updateFiscalLiveCalc = () => {
      const taxInput = document.getElementById('cfg-tax-rate');
      const srvInput = document.getElementById('cfg-service-charge');
      if (!taxInput || !srvInput) return;

      const tRate = parseFloat(taxInput.value) || 0;
      const sRate = parseFloat(srvInput.value) || 0;
      const sub = 180.00;
      const tax = +(sub * (tRate / 100)).toFixed(2);
      const srv = +(sub * (sRate / 100)).toFixed(2);
      const tot = +(sub + tax + srv).toFixed(2);

      const elVatRate = document.getElementById('calc-preview-vat-rate');
      const elVatAmt = document.getElementById('calc-preview-vat-amount');
      const elSrvRate = document.getElementById('calc-preview-srv-rate');
      const elSrvAmt = document.getElementById('calc-preview-srv-amount');
      const elTot = document.getElementById('calc-preview-total');

      if (elVatRate) elVatRate.textContent = tRate;
      if (elVatAmt) elVatAmt.textContent = `EGP ${tax.toFixed(2)}`;
      if (elSrvRate) elSrvRate.textContent = sRate;
      if (elSrvAmt) elSrvAmt.textContent = `EGP ${srv.toFixed(2)}`;
      if (elTot) elTot.textContent = `EGP ${tot.toFixed(2)}`;
    };

    document.getElementById('cfg-tax-rate')?.addEventListener('input', updateFiscalLiveCalc);
    document.getElementById('cfg-service-charge')?.addEventListener('input', updateFiscalLiveCalc);

    // 5. Test print receipt action
    document.getElementById('btn-test-print-receipt')?.addEventListener('click', () => {
      this.showToast('Sending test thermal receipt to Epson TM-T88VI (192.168.1.120:9100)... Print completed.');
    });

    // 6. Tender toggles
    document.querySelectorAll('.tender-toggle').forEach(toggle => {
      toggle.addEventListener('change', (e) => {
        const tenderId = e.target.getAttribute('data-tender-id');
        store.togglePaymentMethod(tenderId, e.target.checked);
        this.showToast(`Tender ${tenderId.toUpperCase()} ${e.target.checked ? 'enabled' : 'disabled'}.`);
      });
    });

    document.getElementById('btn-add-tender-notice')?.addEventListener('click', () => {
      this.showToast('Custom tender creation is managed in the multi-branch enterprise portal.');
    });

    // 7. Hardware peripheral actions
    document.getElementById('btn-test-printer')?.addEventListener('click', () => {
      store.updateDevice('receipt-printer', { lastPing: 'Just now', status: 'Connected' });
      this.showToast('Epson TM-T88VI ESC/POS chit printed successfully on port 9100.');
    });

    document.getElementById('btn-test-terminal')?.addEventListener('click', () => {
      store.updateDevice('card-terminal', { lastPing: 'Just now', status: 'Paired' });
      this.showToast('PAX A920 terminal echo received in 34ms (NBE Acquirer TLS OK).');
    });

    document.getElementById('btn-test-qr')?.addEventListener('click', () => {
      store.updateDevice('instapay-qr', { lastPing: 'Just now', status: 'Active' });
      this.showToast('Dynamic InstaPay E-Payment QR pushed to Sunmi D2 Mini screen.');
    });

    document.getElementById('btn-test-scanner')?.addEventListener('click', () => {
      store.updateDevice('barcode-scanner', { lastPing: 'Just now', status: 'Active' });
      this.showToast('Barcode read: 6221234567890 · SKU BEAN-01 (House blend beans 1 kg).');
    });

    document.getElementById('btn-device-refresh-all')?.addEventListener('click', () => {
      this.showToast('Polled 4 local hardware peripherals: All ports responding normally.');
    });

    // 8. Data & Backup actions
    document.getElementById('btn-export-backup')?.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(store.exportState());
      const downloadAnchor = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `drip-cafe-erp-backup-${dateStr}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      this.showToast('Complete ERP backup archive downloaded successfully.');
    });

    document.getElementById('btn-trigger-restore')?.addEventListener('click', () => {
      document.getElementById('input-restore-file')?.click();
    });

    document.getElementById('input-restore-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = store.importState(event.target.result);
        if (result.success) {
          this.showToast('ERP database successfully restored from JSON backup.');
          this.render();
        } else {
          alert('Could not restore backup: ' + result.error);
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('btn-backup-factory-reset')?.addEventListener('click', () => {
      if (confirm('Revert all sample sales, stock counts, and sessions back to initial factory baseline?')) {
        store.resetToDefaults();
        this.showToast('Factory default baseline restored.');
        this.render();
      }
    });
  }


  /* ==========================================================================
     MODALS & DIALOGS
     ========================================================================== */
  showTransferModal() {
    const state = store.getState();
    const modal = document.getElementById('modal-container');
    const warehouses = state.warehouses || [];

    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Create warehouse transfer</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body">
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
              Move reserve stock to Bar stock operating warehouse.
            </p>

            <form id="form-modal-transfer">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
                <div>
                  <label class="form-label">From warehouse</label>
                  <select class="form-select" id="modal-transfer-from">
                    ${warehouses.filter(w => w.id !== 'bar_stock').map(w => `
                      <option value="${w.id}">${w.name} (${w.type || 'Reserve'})</option>
                    `).join('')}
                    <option value="bar_stock">Bar stock</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">To warehouse</label>
                  <select class="form-select" id="modal-transfer-to">
                    <option value="bar_stock">Bar stock (POS Operating)</option>
                    ${warehouses.filter(w => w.id !== 'bar_stock').map(w => `
                      <option value="${w.id}">${w.name}</option>
                    `).join('')}
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Stock item</label>
                <select class="form-select" id="modal-transfer-item">
                  <option value="BEAN-01">House blend beans (BEAN-01)</option>
                  <option value="DAIRY-01">Whole milk (DAIRY-01)</option>
                  <option value="BAKE-02">Chocolate cookie (BAKE-02)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Quantity</label>
                <input type="number" step="0.5" class="form-input" id="modal-transfer-qty" value="2.0" required>
              </div>

              <div class="form-group">
                <label class="form-label">Reason / note</label>
                <input type="text" class="form-input" id="modal-transfer-note" value="Bar replenishment">
              </div>

              <div class="modal-footer" style="padding: 16px 0 0; background: none; border: none;">
                <button type="button" class="btn btn-outline" id="modal-btn-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Confirm transfer</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    document.getElementById('form-modal-transfer').addEventListener('submit', (e) => {
      e.preventDefault();
      const fromWh = document.getElementById('modal-transfer-from').value;
      const toWh = document.getElementById('modal-transfer-to').value;
      const sku = document.getElementById('modal-transfer-item').value;
      const qty = document.getElementById('modal-transfer-qty').value;
      const note = document.getElementById('modal-transfer-note').value;

      const success = store.transferStock(fromWh, toWh, sku, qty, note);
      if (success) {
        closeModal();
        this.showToast(`Transfer completed: ${qty} added to Bar stock.`);
      } else {
        alert('Insufficient stock in source warehouse.');
      }
    });
  }

  showAddWarehouseModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content" style="max-width: 520px;">
          <div class="modal-header">
            <h3>Add new warehouse / storage</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body">
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
              Create reserve warehouses, mobile outside carts, or secondary storage units. POS only directly deducts from Bar stock.
            </p>

            <form id="form-modal-add-warehouse">
              <div class="form-group">
                <label class="form-label">Warehouse name *</label>
                <input type="text" class="form-input" id="wh-name-input" placeholder="e.g. Zamalek Mobile Cart / 6th October Central Store" required>
              </div>

              <div class="form-group">
                <label class="form-label">Location type *</label>
                <select class="form-select" id="wh-type-input">
                  <option value="reserve">Reserve storage (Default · Replenishes Bar stock)</option>
                  <option value="mobile_cart">Mobile Event Cart (Outside catering unit)</option>
                  <option value="satellite_bar">Satellite Bar Unit</option>
                  <option value="cold_unit">Cold Storage Annex</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Physical address / location</label>
                <input type="text" class="form-input" id="wh-location-input" placeholder="e.g. Downtown Cairo or Zamalek Mobile Station">
              </div>

              <div class="form-group">
                <label class="form-label">Description / Operating notes</label>
                <textarea class="form-input" id="wh-desc-input" rows="2" placeholder="e.g. Dedicated mobile unit for outside events. Stock is replenished via explicit warehouse transfers."></textarea>
              </div>

              <div class="modal-footer" style="padding: 16px 0 0; background: none; border: none;">
                <button type="button" class="btn btn-outline" id="modal-btn-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Create warehouse</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    document.getElementById('form-modal-add-warehouse').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('wh-name-input').value.trim();
      const type = document.getElementById('wh-type-input').value;
      const location = document.getElementById('wh-location-input').value.trim();
      const description = document.getElementById('wh-desc-input').value.trim();

      if (!name) return;

      store.addWarehouse({ name, type, location, description });
      closeModal();
      this.showToast(`Warehouse "${name}" added successfully.`);
    });
  }

  showAddSupplierModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content" style="max-width: 520px;">
          <div class="modal-header">
            <h3>Add new supplier</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body">
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
              Register partner suppliers for direct deliveries to Dry Store, Cold Store, or Bar Stock.
            </p>

            <form id="form-modal-add-supplier">
              <div class="form-group">
                <label class="form-label">Company / Supplier name *</label>
                <input type="text" class="form-input" id="supp-name-input" placeholder="e.g. Delta Dairy Hub / Red Sea Roasters" required>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
                <div>
                  <label class="form-label">Contact person *</label>
                  <input type="text" class="form-input" id="supp-contact-input" placeholder="e.g. Tarek Mansour" required>
                </div>
                <div>
                  <label class="form-label">Phone number *</label>
                  <input type="text" class="form-input" id="supp-phone-input" placeholder="e.g. 010 1234 5678" required>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
                <div>
                  <label class="form-label">Supplies category</label>
                  <select class="form-select" id="supp-category-input">
                    <option value="Coffee beans">Coffee beans (Specialty roast)</option>
                    <option value="Milk & dairy">Milk & dairy products</option>
                    <option value="Pastries & bakery">Pastries & bakery</option>
                    <option value="Paper cups & packaging">Paper cups & packaging</option>
                    <option value="Syrups & ingredients">Syrups & non-coffee</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Delivery schedule</label>
                  <select class="form-select" id="supp-schedule-input">
                    <option value="Daily">Daily morning</option>
                    <option value="3× weekly">3× weekly</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Bi-weekly">Bi-weekly</option>
                    <option value="On demand">On demand</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Delivery notes / Payment terms</label>
                <input type="text" class="form-input" id="supp-notes-input" placeholder="e.g. Delivers at 07:30 AM · Net 15 days payment">
              </div>

              <div class="modal-footer" style="padding: 16px 0 0; background: none; border: none;">
                <button type="button" class="btn btn-outline" id="modal-btn-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Save supplier</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    document.getElementById('form-modal-add-supplier').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('supp-name-input').value.trim();
      const contact = document.getElementById('supp-contact-input').value.trim();
      const phone = document.getElementById('supp-phone-input').value.trim();
      const supplies = document.getElementById('supp-category-input').value;
      const schedule = document.getElementById('supp-schedule-input').value;
      const notes = document.getElementById('supp-notes-input').value.trim();

      if (!name) return;

      store.addSupplier({ name, contact, phone, supplies, schedule, notes });
      closeModal();
      this.showToast(`Supplier "${name}" added to directory.`);
    });
  }

  showCreateEventModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content" style="max-width: 540px;">
          <div class="modal-header">
            <h3>Plan outside event</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body">
            <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">
              Create outside catering pop-up, mobile bar, or cupping session with allocated mobile stock.
            </p>

            <form id="form-modal-create-event">
              <div class="form-group">
                <label class="form-label">Event title *</label>
                <input type="text" class="form-input" id="evt-title-input" placeholder="e.g. Cairo Tech Summit Mobile Bar" required>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
                <div>
                  <label class="form-label">Event type</label>
                  <select class="form-select" id="evt-type-input">
                    <option value="Outside Catering">Outside Catering</option>
                    <option value="Pop-up Cart">Pop-up Cart</option>
                    <option value="Cupping & Workshop">Cupping & Workshop</option>
                    <option value="Corporate Event">Corporate Event</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Expected guests</label>
                  <input type="number" class="form-input" id="evt-guests-input" value="60" required>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
                <div>
                  <label class="form-label">Date *</label>
                  <input type="text" class="form-input" id="evt-date-input" value="30 Oct 2026" required>
                </div>
                <div>
                  <label class="form-label">Time window</label>
                  <input type="text" class="form-input" id="evt-time-input" value="14:00–18:00" required>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Venue / Outside location *</label>
                <input type="text" class="form-input" id="evt-venue-input" placeholder="e.g. The Greek Campus · Downtown Cairo" required>
              </div>

              <div class="form-group">
                <label class="form-label">Lead Barista / Staff</label>
                <select class="form-select" id="evt-staff-input">
                  <option value="Omar Nabil">Omar Nabil (Barista · POS operator)</option>
                  <option value="Nour Farid">Nour Farid (Barista)</option>
                  <option value="Sara Ali">Sara Ali (Administrator)</option>
                  <option value="Youssef Adel">Youssef Adel (Administrator)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Allocated mobile stock kit</label>
                <input type="text" class="form-input" id="evt-stock-input" value="8 kg House blend beans · 20 L Whole milk · 150 Paper cups">
                <div class="form-hint">Stock reserved for this event will be linked when ringing up orders in Event POS mode.</div>
              </div>

              <div class="modal-footer" style="padding: 16px 0 0; background: none; border: none;">
                <button type="button" class="btn btn-outline" id="modal-btn-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary">Save & allocate event</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    document.getElementById('form-modal-create-event').addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('evt-title-input').value.trim();
      const type = document.getElementById('evt-type-input').value;
      const guests = document.getElementById('evt-guests-input').value;
      const date = document.getElementById('evt-date-input').value.trim();
      const time = document.getElementById('evt-time-input').value.trim();
      const venue = document.getElementById('evt-venue-input').value.trim();
      const assignedStaff = document.getElementById('evt-staff-input').value;
      const allocatedStock = document.getElementById('evt-stock-input').value.trim();

      if (!title || !venue) return;

      store.addEvent({ title, type, guests, date, time, venue, assignedStaff, allocatedStock });
      closeModal();
      this.showToast(`Outside event "${title}" planned successfully.`);
    });
  }

  showRectifyInvoiceModal(invoice) {
    const modal = document.getElementById('modal-container');
    let currentAction = 'edit';
    let selectedTender = (invoice.paymentMethod || 'Cash').toLowerCase() === 'card' ? 'Card' : 'Cash';
    let editedItems = JSON.parse(JSON.stringify(invoice.items || []));

    const calculateCurrentTotal = () => {
      return editedItems.reduce((acc, item) => acc + (item.qty * item.unitPrice), 0);
    };

    const renderModalContent = () => {
      const currentTotal = calculateCurrentTotal();
      const diff = currentTotal - invoice.total;

      modal.innerHTML = `
        <div class="modal-overlay" id="modal-overlay">
          <div class="modal-content" style="max-width: 580px;">
            <div class="modal-header">
              <div>
                <div style="font-size: 11px; text-transform: uppercase; color: var(--brand-terracotta); font-weight: 700;">
                  Mistake Control & Order Rectification
                </div>
                <h3>Rectify ${invoice.id}</h3>
              </div>
              <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
            </div>
            
            <div class="modal-body">
              <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 14px; background: #faf8f5; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border-light);">
                <div>
                  <strong>Sale #${invoice.saleId}</strong> · ${invoice.customer}
                  <div style="font-size: 11px; color: var(--text-muted);">${invoice.type} · ${invoice.cashier}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 11px; color: var(--text-muted);">${invoice.date} · ${invoice.time}</div>
                  <strong>Original: EGP ${invoice.total.toFixed(2)} (${invoice.paymentMethod})</strong>
                </div>
              </div>

              <!-- Action Tabs -->
              <div class="action-selector-tabs">
                <button type="button" class="action-selector-tab ${currentAction === 'edit' ? 'active' : ''}" id="tab-action-edit">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg> Modify items / Tender
                </button>
                <button type="button" class="action-selector-tab ${currentAction === 'void' ? 'active' : ''}" id="tab-action-void" style="${currentAction === 'void' ? 'border-color: #ef4444; background: #fef2f2; color: #b91c1c;' : ''}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Void invoice completely
                </button>
              </div>

              <form id="form-rectify-invoice">
                ${currentAction === 'edit' ? `
                  <div style="margin-bottom: 14px;">
                    <label class="form-label" style="display: flex; justify-content: space-between;">
                      <span>Order items (adjust if entered by barista mistake)</span>
                      <span style="font-size: 11px; color: var(--brand-terracotta);">Raw ingredients return to Bar stock</span>
                    </label>

                    <div style="display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-light); border-radius: 6px; padding: 10px; background: #fff;">
                      ${editedItems.map((item, index) => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: ${index < editedItems.length - 1 ? '1px solid var(--border-light)' : 'none'};">
                          <div>
                            <div style="font-size: 13px; font-weight: 600;">${item.name}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">EGP ${item.unitPrice.toFixed(0)} each · ${item.desc || 'Standard'}</div>
                          </div>
                          <div style="display: flex; align-items: center; gap: 10px;">
                            <div class="qty-stepper" style="display: flex; align-items: center; gap: 6px; background: #f4efe6; border-radius: 4px; padding: 2px;">
                              <button type="button" class="qty-btn btn-rectify-minus" data-idx="${index}" style="width: 24px; height: 24px; border: none; background: #fff; cursor: pointer; border-radius: 3px; font-weight: 700;">−</button>
                              <span style="min-width: 20px; text-align: center; font-weight: 700; font-size: 13px;">${item.qty}</span>
                              <button type="button" class="qty-btn btn-rectify-plus" data-idx="${index}" style="width: 24px; height: 24px; border: none; background: #fff; cursor: pointer; border-radius: 3px; font-weight: 700;">+</button>
                            </div>
                            <div style="font-weight: 700; font-size: 13px; min-width: 70px; text-align: right;">
                              EGP ${(item.qty * item.unitPrice).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      `).join('')}
                    </div>
                  </div>

                  <div class="form-group">
                    <label class="form-label">Payment tender (if recorded wrong tender)</label>
                    <div style="display: flex; gap: 10px;">
                      <button type="button" class="btn btn-outline btn-sm ${selectedTender === 'Cash' ? 'active' : ''}" id="rectify-tender-cash" style="flex: 1; ${selectedTender === 'Cash' ? 'border-color: var(--brand-terracotta); background: var(--brand-terracotta-light); color: var(--brand-terracotta);' : ''}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="12" cy="12" r="2"></circle><path d="M6 12h.01M18 12h.01"></path></svg> Cash
                      </button>
                      <button type="button" class="btn btn-outline btn-sm ${selectedTender === 'Card' ? 'active' : ''}" id="rectify-tender-card" style="flex: 1; ${selectedTender === 'Card' ? 'border-color: var(--brand-terracotta); background: var(--brand-terracotta-light); color: var(--brand-terracotta);' : ''}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg> Card / Visa
                      </button>
                    </div>
                  </div>

                  <div class="rectify-box">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                      <span>New invoice total:</span>
                      <strong style="font-family: var(--font-serif); font-size: 18px;">EGP ${currentTotal.toFixed(2)}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: ${diff < 0 ? '#166534' : (diff > 0 ? '#b45309' : 'var(--text-muted)')};">
                      <span>Adjustment difference:</span>
                      <span>${diff < 0 ? `− EGP ${Math.abs(diff).toFixed(2)} (Drawer refund & stock returned to Bar)` : (diff > 0 ? `+ EGP ${diff.toFixed(2)}` : 'No net change')}</span>
                    </div>
                  </div>
                ` : `
                  <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
                    <div style="color: #991b1b; font-weight: 700; font-size: 13.5px; margin-bottom: 6px;">
                      <span style="display: flex; align-items: center; gap: 6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Confirm Complete Invoice Cancellation</span>
                    </div>
                    <ul style="font-size: 12px; color: #7f1d1d; padding-left: 18px; display: flex; flex-direction: column; gap: 6px;">
                      <li><strong>Automated Stock Reversal:</strong> All recipe raw ingredients (beans, milk, bakery) will be instantly returned to <strong>Bar stock</strong>.</li>
                      <li><strong>Drawer Reconciliation:</strong> EGP ${invoice.total.toFixed(2)} will be subtracted from session sales and cash drawer expected float.</li>
                      <li><strong>Traceability:</strong> Invoice will be flagged as <span class="badge badge-voided">Voided</span> with audit timestamp.</li>
                    </ul>
                  </div>
                `}

                <div class="form-group">
                  <label class="form-label">Audit reason for mistake correction *</label>
                  <input type="text" class="form-input" id="rectify-reason-input" placeholder="e.g. Barista entered 2 Flat Whites instead of 1 / Customer cancelled" required>
                </div>

                <div class="modal-footer" style="padding: 16px 0 0; background: none; border: none;">
                  <button type="button" class="btn btn-outline" id="modal-btn-cancel">Cancel</button>
                  <button type="submit" class="btn ${currentAction === 'void' ? 'btn-outline' : 'btn-primary'}" style="${currentAction === 'void' ? 'border-color: #ef4444; color: #b91c1c; background: #fff;' : ''}">
                    ${currentAction === 'void' ? 'Confirm Void & Return Stock' : 'Apply Rectification'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      `;

      const closeModal = () => { modal.innerHTML = ''; };
      document.getElementById('modal-close').addEventListener('click', closeModal);
      document.getElementById('modal-btn-cancel').addEventListener('click', closeModal);
      document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') closeModal();
      });

      document.getElementById('tab-action-edit').addEventListener('click', () => {
        currentAction = 'edit';
        renderModalContent();
      });

      document.getElementById('tab-action-void').addEventListener('click', () => {
        currentAction = 'void';
        renderModalContent();
      });

      if (currentAction === 'edit') {
        document.querySelectorAll('.btn-rectify-minus').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-idx'));
            if (editedItems[idx].qty > 0) {
              editedItems[idx].qty -= 1;
              editedItems[idx].total = editedItems[idx].qty * editedItems[idx].unitPrice;
              renderModalContent();
            }
          });
        });

        document.querySelectorAll('.btn-rectify-plus').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.getAttribute('data-idx'));
            editedItems[idx].qty += 1;
            editedItems[idx].total = editedItems[idx].qty * editedItems[idx].unitPrice;
            renderModalContent();
          });
        });

        document.getElementById('rectify-tender-cash')?.addEventListener('click', () => {
          selectedTender = 'Cash';
          renderModalContent();
        });

        document.getElementById('rectify-tender-card')?.addEventListener('click', () => {
          selectedTender = 'Card';
          renderModalContent();
        });
      }

      document.getElementById('form-rectify-invoice').addEventListener('submit', (e) => {
        e.preventDefault();
        const reason = document.getElementById('rectify-reason-input').value.trim();
        if (!reason) {
          alert('Please enter an audit reason.');
          return;
        }

        if (currentAction === 'void') {
          store.rectifyInvoice(invoice.id, {
            action: 'void',
            reason: reason || 'Order made by mistake · Voided'
          });
          closeModal();
          this.showToast(`Invoice ${invoice.id} voided. Ingredients restocked to Bar stock.`);
        } else {
          const finalItems = editedItems.filter(item => item.qty > 0);
          if (finalItems.length === 0) {
            store.rectifyInvoice(invoice.id, {
              action: 'void',
              reason: reason || 'All items removed · Voided'
            });
            closeModal();
            this.showToast(`All items removed. Invoice ${invoice.id} voided and stock returned.`);
          } else {
            store.rectifyInvoice(invoice.id, {
              action: 'edit',
              reason: reason,
              newPaymentMethod: selectedTender,
              newItems: finalItems
            });
            closeModal();
            this.showToast(`Invoice ${invoice.id} updated. Stock adjusted automatically.`);
          }
        }
      });
    };

    renderModalContent();
  }

  showInvoiceModal(invoice) {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header">
            <h3>Invoice ${invoice.id}</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body">
            <div class="receipt-slip">
              <div class="receipt-logo">
                <h4>DRIP CAFÉ</h4>
                <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Operations Connected · Cairo</div>
              </div>

              <div class="receipt-meta">
                <div>Invoice: <strong>${invoice.id}</strong></div>
                <div>Date: ${invoice.date} · ${invoice.time}</div>
                <div>Type: ${invoice.type}</div>
                <div>Cashier: ${invoice.cashier}</div>
              </div>

              <div>
                ${invoice.items.map(item => `
                  <div class="receipt-item-row">
                    <div>
                      <strong>${item.name}</strong> × ${item.qty}
                      <div style="font-size: 10px; color: var(--text-muted);">${item.desc}</div>
                    </div>
                    <strong>EGP ${item.total.toFixed(2)}</strong>
                  </div>
                `).join('')}
              </div>

              <div class="receipt-divider"></div>

              <div class="receipt-item-row" style="font-size: 14px; font-weight: 700;">
                <span>TOTAL</span>
                <span>EGP ${invoice.total.toFixed(2)}</span>
              </div>
              <div class="receipt-item-row" style="font-size: 11.5px; color: var(--text-muted);">
                <span>Payment tender (${invoice.paymentMethod})</span>
                <span>EGP ${invoice.total.toFixed(2)}</span>
              </div>

              <div class="receipt-divider"></div>

              <div style="font-size: 10px; color: #166534; text-align: center; background: #f0fdf4; padding: 6px; border-radius: 4px;">
                Recipe ingredients automatically deducted from Bar stock
              </div>

              <div class="receipt-footer-text">
                Thank you for choosing Drip Café.<br>
                drip.example · Cairo, Egypt
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-outline" id="modal-btn-print"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Print Receipt</button>
            <button class="btn btn-primary" id="modal-btn-done">Done</button>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-btn-done').addEventListener('click', closeModal);
    document.getElementById('modal-btn-print').addEventListener('click', () => { window.print(); });
  }

  showSetupGuideModal() {
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-content" style="max-width: 620px;">
          <div class="modal-header">
            <h3>Drip Café — Operations Manual</h3>
            <button class="icon-btn" id="modal-close" title="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
          </div>
          <div class="modal-body" style="font-size: 13.5px; line-height: 1.6;">
            <p style="margin-bottom: 12px; font-weight: 600; color: var(--text-heading);">Specialty Coffee Standard Operating Procedures (SOP):</p>

            <ol style="padding-left: 20px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px;">
              <li><strong>Opening Shift & Float:</strong> Cashiers must sign in and count opening float (default EGP 500.00) in <em>Register Session</em> before POS order entry is unlocked.</li>
              <li><strong>Bar Stock Inventory Isolation:</strong> POS drink sales deduct raw ingredients exclusively from the <em>Bar stock</em> operating warehouse. Dry store and Cold store remain reserve locations.</li>
              <li><strong>Warehouse Transfers:</strong> When bar ingredients fall below par levels, submit an explicit <em>Warehouse transfer</em> to move stock from reserve storage.</li>
              <li><strong>Outside Events & Catering:</strong> Dedicated catering and pop-up events have reserved stock kits and attribute sales directly to the outside unit.</li>
              <li><strong>Closing Cash Reconciliation:</strong> At shift end, perform blind drawer count. The system reconciles expected cash (Float + Cash Sales) against physical counted currency.</li>
              <li><strong>Supplier Deliveries:</strong> Receiving staff inspect bills of lading and confirm deliveries into respective reserve facilities.</li>
            </ol>

            <div style="background: #faf8f5; border: 1px solid var(--border-medium); border-radius: 6px; padding: 12px; font-size: 12px; color: var(--text-body);">
              <strong>System Notice:</strong> For technical support, printer connectivity issues, or fiscal VAT configuration, refer to Admin Settings or contact your system administrator.
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-primary" id="modal-guide-close">Close Guide</button>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-guide-close').addEventListener('click', closeModal);
  }

  showToast(message) {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #1c1917;
        color: #ffffff;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        z-index: 9999;
        transition: opacity 0.2s ease, transform 0.2s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        border-left: 4px solid var(--brand-terracotta);
      `;
      document.body.appendChild(toast);
    }

    toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>${message}</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 3200);
  }
}

// Instantiate and launch app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dripApp = new DripApp();
});
