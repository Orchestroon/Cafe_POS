/* ==========================================================================
   DRIP CAFÉ ERP — REACTIVE STATE STORE & BUSINESS LOGIC ENGINE
   Pre-loaded with operational branch data (Cairo, Egypt)
   Enhanced with Outside Events, Dynamic Warehouses, Supplier Popups,
   and Invoice Rectification / Mistake Control & Automated Stock Reversals.
   ========================================================================== */

const STORAGE_KEY = 'drip_cafe_erp_state_v2';

// Initial baseline operational data
const DEFAULT_STATE = {
  branch: {
    businessName: 'Drip Café',
    branchName: 'Main café',
    location: 'Zamalek, Cairo, Egypt',
    phone: '+20 100 123 4567',
    currency: 'EGP',
    currencyLabel: 'EGP · Egyptian pound',
    timezone: 'Africa/Cairo',
    operatingWarehouse: 'Bar stock',
    invoicePrefix: 'INV-',
    nextInvoiceNumber: 43,
    receiptFooter: 'Thank you for choosing Drip Café.',
    taxRate: 14,
    serviceCharge: 12
  },

  currentUser: {
    name: 'Mahmoud Hassan',
    email: 'mahmoud@drip.example',
    role: 'Owner · Admin',
    initials: 'MH'
  },

  // Active cashier session
  session: {
    id: 'S-0028',
    register: 'POS-01',
    cashier: 'Omar Nabil',
    cashierEmail: 'omar@drip.example',
    role: 'Barista · POS operator',
    status: 'Active', // 'Active', 'Closed', 'Locked'
    openedAt: '26 Oct 2026 · 09:00',
    openingFloat: 500.00,
    openingNote: 'Morning shift · Float counted',
    netSales: 3250.00,
    completedSales: 24,
    cashSales: 2100.00, // 16 sales
    cardSales: 1150.00, // 8 sales
    expectedDrawer: 2600.00 // 500 float + 2100 cash sales
  },

  // Open unresolved order in active session
  openOrder: {
    id: 1042,
    code: 'Order #1042',
    table: 'Table 04 · 2 guests',
    type: 'Dine-in',
    status: 'unpaid',
    openedTime: '14:25',
    cashier: 'Omar Nabil',
    items: [
      {
        id: 'flat-white',
        name: 'Flat white',
        unitPrice: 90.00,
        quantity: 2,
        total: 180.00,
        recipeDesc: '18 g beans + 160 ml milk',
        modifiers: 'Whole milk · Double shot'
      },
      {
        id: 'croissant',
        name: 'Butter croissant',
        unitPrice: 70.00,
        quantity: 1,
        total: 70.00,
        recipeDesc: '1 pc ready bake',
        modifiers: 'Standard · Warmed'
      }
    ],
    subtotal: 250.00,
    tax: 0.00,
    total: 250.00,
    paymentMethod: 'cash'
  },

  // Warehouses (Bar stock is the ONLY direct POS source)
  warehouses: [
    {
      id: 'bar_stock',
      name: 'Bar stock',
      type: 'operating',
      description: 'Main café operating warehouse · POS deducts stock from here only',
      itemCount: 12,
      lowStockCount: 3,
      leadItem: 'Active POS Location'
    },
    {
      id: 'dry_store',
      name: 'Dry store',
      type: 'reserve',
      description: 'Reserve storage · Never a direct POS source · Replenish Bar stock with explicit transfers',
      itemCount: 18,
      leadItem: 'House blend beans · 12 kg'
    },
    {
      id: 'cold_store',
      name: 'Cold store',
      type: 'reserve',
      description: 'Reserve storage · Never a direct POS source · Replenish Bar stock with explicit transfers',
      itemCount: 6,
      leadItem: 'Whole milk · 24 L'
    }
  ],

  // Inventory items across warehouses
  inventory: [
    {
      sku: 'BEAN-01',
      name: 'House blend beans',
      category: 'coffee',
      unit: 'kg',
      barStock: 1.8,
      barMinimum: 2.0,
      dryStore: 12.0,
      coldStore: 0,
      costPerUnit: 500.00,
      status: 'low'
    },
    {
      sku: 'DAIRY-01',
      name: 'Whole milk',
      category: 'dairy',
      unit: 'L',
      barStock: 4.5,
      barMinimum: 6.0,
      dryStore: 0,
      coldStore: 24.0,
      costPerUnit: 40.00,
      status: 'low'
    },
    {
      sku: 'BAKE-01',
      name: 'Butter croissant',
      category: 'bakery',
      unit: 'pcs',
      barStock: 8,
      barMinimum: 10,
      dryStore: 0,
      coldStore: 0,
      costPerUnit: 35.00,
      status: 'low'
    },
    {
      sku: 'DAIRY-02',
      name: 'Oat milk',
      category: 'dairy',
      unit: 'L',
      barStock: 5.0,
      barMinimum: 3.0,
      dryStore: 0,
      coldStore: 15.0,
      costPerUnit: 70.00,
      status: 'normal'
    },
    {
      sku: 'PACK-01',
      name: 'Takeaway cups (8oz/12oz)',
      category: 'packaging',
      unit: 'pcs',
      barStock: 240,
      barMinimum: 100,
      dryStore: 1200,
      coldStore: 0,
      costPerUnit: 3.50,
      status: 'normal'
    },
    {
      sku: 'BAKE-02',
      name: 'Chocolate cookie',
      category: 'bakery',
      unit: 'pcs',
      barStock: 18,
      barMinimum: 8,
      dryStore: 30,
      coldStore: 0,
      costPerUnit: 25.00,
      status: 'normal'
    }
  ],

  // Products and their ingredient recipes
  products: [
    {
      id: 'espresso',
      code: 'COF-001',
      name: 'Espresso',
      category: 'Coffee',
      price: 55.00,
      recipeSummary: '18 g House blend beans · 0.018 kg',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.018, unit: 'kg' }
      ]
    },
    {
      id: 'french-coffee',
      code: 'COF-010',
      name: 'French coffee',
      category: 'Coffee',
      price: 75.00,
      recipeSummary: '15 g beans + 0.1 L milk',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.015, unit: 'kg' },
        { sku: 'DAIRY-01', name: 'Whole milk', qty: 0.100, unit: 'L' }
      ]
    },
    {
      id: 'flat-white',
      code: 'COF-002',
      name: 'Flat white',
      category: 'Coffee',
      price: 90.00,
      recipeSummary: '18 g beans + 160 ml milk',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.018, unit: 'kg' },
        { sku: 'DAIRY-01', name: 'Whole milk', qty: 0.160, unit: 'L' }
      ]
    },
    {
      id: 'cappuccino',
      code: 'COF-003',
      name: 'Cappuccino',
      category: 'Coffee',
      price: 85.00,
      recipeSummary: 'Recipe linked · Bar stock',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.018, unit: 'kg' },
        { sku: 'DAIRY-01', name: 'Whole milk', qty: 0.150, unit: 'L' }
      ]
    },
    {
      id: 'americano',
      code: 'COF-004',
      name: 'Americano',
      category: 'Coffee',
      price: 65.00,
      recipeSummary: '18 g House blend beans · Bar stock',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.018, unit: 'kg' }
      ]
    },
    {
      id: 'iced-latte',
      code: 'ICED-001',
      name: 'Iced latte',
      category: 'Iced drinks',
      price: 100.00,
      recipeSummary: 'Iced drinks · Recipe linked',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.018, unit: 'kg' },
        { sku: 'DAIRY-01', name: 'Whole milk', qty: 0.200, unit: 'L' }
      ]
    },
    {
      id: 'cold-brew',
      code: 'ICED-002',
      name: 'Cold brew',
      category: 'Iced drinks',
      price: 95.00,
      recipeSummary: 'Iced drinks · Recipe linked',
      ingredients: [
        { sku: 'BEAN-01', name: 'House blend beans', qty: 0.030, unit: 'kg' }
      ]
    },
    {
      id: 'matcha-latte',
      code: 'NON-001',
      name: 'Matcha latte',
      category: 'Non-coffee',
      price: 110.00,
      recipeSummary: 'Non-coffee · Recipe linked',
      ingredients: [
        { sku: 'DAIRY-02', name: 'Oat milk', qty: 0.200, unit: 'L' }
      ]
    },
    {
      id: 'croissant',
      code: 'BAKE-001',
      name: 'Butter croissant',
      category: 'Bakery',
      price: 70.00,
      recipeSummary: 'Bakery · Stock item BAKE-01',
      ingredients: [
        { sku: 'BAKE-01', name: 'Butter croissant', qty: 1, unit: 'pcs' }
      ]
    },
    {
      id: 'cookie',
      code: 'BAKE-002',
      name: 'Chocolate cookie',
      category: 'Bakery',
      price: 50.00,
      recipeSummary: 'Bakery · Stock item BAKE-02',
      ingredients: [
        { sku: 'BAKE-02', name: 'Chocolate cookie', qty: 1, unit: 'pcs' }
      ]
    }
  ],

  // Invoices list
  invoices: [
    {
      id: 'INV-0042',
      saleId: 1042,
      time: '14:28',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Dine-in · Table 04',
      cashier: 'Omar Nabil',
      items: [
        { id: 'flat-white', name: 'Flat white', desc: 'Whole milk · Double shot', unitPrice: 90.00, qty: 2, total: 180.00 },
        { id: 'croissant', name: 'Butter croissant', desc: 'Warmed', unitPrice: 70.00, qty: 1, total: 70.00 }
      ],
      subtotal: 250.00,
      tax: 0.00,
      total: 250.00,
      status: 'Paid',
      paymentMethod: 'Cash',
      paymentRef: 'PAY-0042 · 14:28 · Recorded by Omar Nabil',
      stockDeductionSummary: '36 g House blend beans · 320 ml Whole milk · 1 Butter croissant',
      isRectified: false,
      rectificationNote: ''
    },
    {
      id: 'INV-0041',
      saleId: 1041,
      time: '14:21',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Takeaway',
      cashier: 'Omar Nabil',
      items: [{ id: 'flat-white', name: 'Flat white', desc: 'Whole milk', unitPrice: 90.00, qty: 2, total: 180.00 }],
      subtotal: 180.00,
      tax: 0.00,
      total: 180.00,
      status: 'Paid',
      paymentMethod: 'Card',
      paymentRef: 'PAY-0041 · 14:21 · Recorded by Omar Nabil',
      stockDeductionSummary: '36 g House blend beans · 320 ml Whole milk',
      isRectified: false
    },
    {
      id: 'INV-0040',
      saleId: 1040,
      time: '14:10',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Dine-in · Table 02',
      cashier: 'Omar Nabil',
      items: [
        { id: 'french-coffee', name: 'French coffee', desc: 'Standard', unitPrice: 75.00, qty: 2, total: 150.00 },
        { id: 'cookie', name: 'Chocolate cookie', desc: 'Standard', unitPrice: 50.00, qty: 2, total: 100.00 }
      ],
      subtotal: 250.00,
      tax: 0.00,
      total: 250.00,
      status: 'Unpaid',
      paymentMethod: 'Pending',
      paymentRef: 'Awaiting settlement',
      stockDeductionSummary: 'Pending payment',
      isRectified: false
    },
    {
      id: 'INV-0039',
      saleId: 1039,
      time: '14:02',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Takeaway',
      cashier: 'Omar Nabil',
      items: [
        { id: 'cappuccino', name: 'Cappuccino', desc: 'Standard', unitPrice: 85.00, qty: 1, total: 85.00 },
        { id: 'americano', name: 'Americano', desc: 'Standard', unitPrice: 65.00, qty: 1, total: 60.00 }
      ],
      subtotal: 145.00,
      tax: 0.00,
      total: 145.00,
      status: 'Paid',
      paymentMethod: 'Cash',
      paymentRef: 'PAY-0039 · 14:02 · Recorded by Omar Nabil',
      stockDeductionSummary: '36 g House blend beans · 150 ml Whole milk',
      isRectified: false
    },
    {
      id: 'INV-0038',
      saleId: 1038,
      time: '13:54',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Dine-in · Table 01',
      cashier: 'Omar Nabil',
      items: [
        { id: 'matcha-latte', name: 'Matcha latte', desc: 'Oat milk', unitPrice: 110.00, qty: 2, total: 220.00 },
        { id: 'flat-white', name: 'Flat white', desc: 'Standard', unitPrice: 90.00, qty: 1, total: 90.00 }
      ],
      subtotal: 310.00,
      tax: 0.00,
      total: 310.00,
      status: 'Paid',
      paymentMethod: 'Cash',
      paymentRef: 'PAY-0038 · 13:54 · Recorded by Omar Nabil',
      stockDeductionSummary: '18 g beans · 160 ml milk · 400 ml oat milk',
      isRectified: false
    },
    {
      id: 'INV-0037',
      saleId: 1037,
      time: '13:42',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Takeaway',
      cashier: 'Omar Nabil',
      items: [
        { id: 'cold-brew', name: 'Cold brew', desc: 'Standard', unitPrice: 95.00, qty: 1, total: 95.00 },
        { id: 'cookie', name: 'Chocolate cookie', desc: 'Standard', unitPrice: 50.00, qty: 1, total: 60.00 }
      ],
      subtotal: 155.00,
      tax: 0.00,
      total: 155.00,
      status: 'Paid',
      paymentMethod: 'Card',
      paymentRef: 'PAY-0037 · 13:42 · Recorded by Omar Nabil',
      stockDeductionSummary: '30 g beans · 1 cookie',
      isRectified: false
    },
    {
      id: 'INV-0036',
      saleId: 1036,
      time: '13:35',
      date: '26 Oct 2026',
      customer: 'Walk-in customer',
      type: 'Dine-in · Table 03',
      cashier: 'Omar Nabil',
      items: [
        { id: 'espresso', name: 'Espresso', desc: 'Double', unitPrice: 55.00, qty: 1, total: 55.00 },
        { id: 'croissant', name: 'Butter croissant', desc: 'Standard', unitPrice: 35.00, qty: 1, total: 35.00 }
      ],
      subtotal: 90.00,
      tax: 0.00,
      total: 90.00,
      status: 'Paid',
      paymentMethod: 'Cash',
      paymentRef: 'PAY-0036 · 13:35 · Recorded by Omar Nabil',
      stockDeductionSummary: '18 g beans · 1 croissant',
      isRectified: false
    }
  ],

  // Outside & In-house Events
  events: [
    {
      id: 'EVT-001',
      title: 'Community cupping',
      date: '30 Oct 2026',
      time: '18:00–20:00',
      venue: 'Main café (Roastery Lab)',
      type: 'In-house Cupping',
      guests: 24,
      assignedStaff: 'Mahmoud Hassan',
      status: 'Planned',
      description: '24 guests planned. Reserve specialty single origin stock and link event sales at POS.',
      allocatedStock: '2 kg Ethiopian Yirgacheffe · 50 Cupping bowls · 5 L Pure water'
    },
    {
      id: 'EVT-002',
      title: 'Cairo Tech Summit Outside Catering',
      date: '02 Nov 2026',
      time: '09:00–17:00',
      venue: 'Greek Campus, Downtown Cairo',
      type: 'Outside Catering',
      guests: 180,
      assignedStaff: 'Omar Nabil & Nour Farid',
      status: 'Planned',
      description: 'Full mobile espresso & pour-over bar with 2 dedicated baristas for all-day conference.',
      allocatedStock: '8 kg House blend beans · 25 L Oat milk · 350 Takeaway cups'
    },
    {
      id: 'EVT-003',
      title: 'Zamalek Art Gallery Pop-Up',
      date: '24 Oct 2026',
      time: '19:00–22:00',
      venue: 'Zamalek Arts Center, Cairo',
      type: 'Outside Event',
      guests: 75,
      assignedStaff: 'Sara Ali',
      status: 'Completed',
      description: 'Cold brew and flat white catering station with curated pastry pairing.',
      allocatedStock: '4 kg House blend beans · 12 L Whole milk · 80 Glasses'
    }
  ],

  // Warehouse movements
  warehouseMovements: [
    {
      ref: 'TR-0018',
      time: 'Today 11:40',
      from: 'Dry store',
      to: 'Bar stock',
      item: 'House blend beans',
      sku: 'BEAN-01',
      qty: '2 kg',
      handledBy: 'Sara Ali',
      status: 'Completed'
    },
    {
      ref: 'TR-0017',
      time: 'Today 09:30',
      from: 'Cold store',
      to: 'Bar stock',
      item: 'Whole milk',
      sku: 'DAIRY-01',
      qty: '6 L',
      handledBy: 'Sara Ali',
      status: 'Completed'
    },
    {
      ref: 'RCV-0027',
      time: 'Today 09:15',
      from: 'Supplier (Fresh Dairy Co.)',
      to: 'Cold store',
      item: 'Whole milk',
      sku: 'DAIRY-01',
      qty: '24 L',
      handledBy: 'Youssef Adel',
      status: 'Received'
    }
  ],

  // Supplier deliveries & receipts
  deliveries: [
    {
      id: 'RCV-0028',
      supplier: 'Nile Roasters',
      poRef: 'PO-0016 · Supplier ref. NR-886',
      expected: 'Today 15:00–16:00',
      destination: 'Dry store',
      item: 'House blend beans',
      sku: 'BEAN-01',
      orderedQty: 10,
      receivedQty: 10,
      unit: 'kg',
      unitPrice: 500.00,
      totalValue: 5000.00,
      status: 'Pending',
      preparedBy: 'Youssef Adel · 26 Oct 2026, 10:05'
    },
    {
      id: 'RCV-0029',
      supplier: 'Daily Bake',
      poRef: 'PO-0017 · Daily fresh delivery',
      expected: 'Tomorrow 07:00–08:00',
      destination: 'Bar stock',
      item: 'Butter croissant',
      sku: 'BAKE-01',
      orderedQty: 20,
      receivedQty: 20,
      unit: 'pcs',
      unitPrice: 35.00,
      totalValue: 700.00,
      status: 'Pending',
      preparedBy: 'Sara Ali'
    },
    {
      id: 'RCV-0027',
      supplier: 'Fresh Dairy Co.',
      poRef: 'PO-0015 · Cold store drop',
      expected: 'Today 09:15 received',
      destination: 'Cold store',
      item: 'Whole milk',
      sku: 'DAIRY-01',
      orderedQty: 24,
      receivedQty: 24,
      unit: 'L',
      unitPrice: 40.00,
      totalValue: 960.00,
      status: 'Received',
      preparedBy: 'Youssef Adel'
    },
    {
      id: 'RCV-0026',
      supplier: 'Nile Roasters',
      poRef: 'PO-0014 · Green coffee batch',
      expected: '24 Oct 10:20 received',
      destination: 'Dry store',
      item: 'House blend beans',
      sku: 'BEAN-01',
      orderedQty: 20,
      receivedQty: 20,
      unit: 'kg',
      unitPrice: 500.00,
      totalValue: 10000.00,
      status: 'Received',
      preparedBy: 'Mahmoud Hassan'
    }
  ],

  // Suppliers directory
  suppliers: [
    {
      name: 'Nile Roasters',
      contact: 'Mona Khaled',
      phone: '010 0000 0121',
      supplies: 'Coffee beans',
      schedule: 'Weekly',
      notes: 'Main specialty coffee roaster partner'
    },
    {
      name: 'Fresh Dairy Co.',
      contact: 'Ahmed Sami',
      phone: '010 0000 0122',
      supplies: 'Milk & dairy',
      schedule: '3× weekly',
      notes: 'Cold store temperature monitored delivery'
    },
    {
      name: 'Daily Bake',
      contact: 'Laila Mostafa',
      phone: '010 0000 0123',
      supplies: 'Pastries',
      schedule: 'Daily',
      notes: 'Delivers at 07:00 AM every morning'
    }
  ],

  // Connected activity feed
  connectedActivity: [
    {
      id: 1,
      type: 'sale',
      title: 'Sale #1042 completed',
      detail: 'INV-0042 created · EGP 250 recorded · Bar stock deducted',
      time: '14:28'
    },
    {
      id: 2,
      type: 'transfer',
      title: 'TR-0018 · Dry store → Bar stock',
      detail: '2 kg House blend beans · Completed by Sara Ali',
      time: '11:40'
    },
    {
      id: 3,
      type: 'receipt',
      title: 'RCV-0027 received · Fresh Dairy Co.',
      detail: '24 L Whole milk added to Cold store',
      time: '09:15'
    }
  ],

  // Team members
  team: [
    {
      id: 'mh',
      name: 'Mahmoud Hassan',
      email: 'mahmoud@drip.example',
      role: 'Owner',
      scope: 'All operations',
      status: 'Active',
      initials: 'MH'
    },
    {
      id: 'sa',
      name: 'Sara Ali',
      email: 'sara@drip.example',
      role: 'Administrator',
      scope: 'Daily operations',
      status: 'Active',
      initials: 'SA'
    },
    {
      id: 'ya',
      name: 'Youssef Adel',
      email: 'youssef@drip.example',
      role: 'Administrator',
      scope: 'Stock & receiving',
      status: 'Active',
      initials: 'YA'
    },
    {
      id: 'on',
      name: 'Omar Nabil',
      email: 'omar@drip.example',
      role: 'Barista',
      scope: 'POS operator',
      status: 'Active',
      initials: 'ON'
    },
    {
      id: 'nf',
      name: 'Nour Farid',
      email: 'nour@drip.example',
      role: 'Barista',
      scope: 'POS operator',
      status: 'Active',
      initials: 'NF'
    }
  ],

  // Role permissions matrix
  rolePermissions: {
    Barista: {
      usePOS: true,
      viewOwnInvoices: true,
      viewBarStock: true,
      applyDiscounts: false,
      refundVoid: false,
      manageInventory: false,
      manageTeam: false,
      editAdminSettings: false
    },
    Administrator: {
      usePOS: true,
      viewOwnInvoices: true,
      viewBarStock: true,
      applyDiscounts: true,
      refundVoid: true,
      manageInventory: true,
      manageTeam: false,
      editAdminSettings: false
    },
    Owner: {
      usePOS: true,
      viewOwnInvoices: true,
      viewBarStock: true,
      applyDiscounts: true,
      refundVoid: true,
      manageInventory: true,
      manageTeam: true,
      editAdminSettings: true
    }
  },

  // Store hardware & peripheral devices
  devices: [
    {
      id: 'receipt-printer',
      name: 'Counter Receipt Printer',
      model: 'Epson TM-T88VI (Thermal 80mm)',
      interface: 'TCP/IP · 192.168.1.120:9100',
      role: 'POS receipts, order chits & kitchen drops',
      status: 'Connected',
      isOnline: true,
      lastPing: 'Just now'
    },
    {
      id: 'card-terminal',
      name: 'Smart Payment Terminal',
      model: 'PAX A920 Smart POS',
      interface: 'Wi-Fi · NBE Merchant Gateway',
      role: 'Visa, Mastercard & Contactless NFC',
      status: 'Paired',
      isOnline: true,
      lastPing: '1 min ago'
    },
    {
      id: 'instapay-qr',
      name: 'InstaPay QR Display',
      model: 'Sunmi D2 Mini · Customer Screen',
      interface: 'Direct USB Host · Egypt CBO E-Payment',
      role: 'Instant account-to-account dynamic QR',
      status: 'Active',
      isOnline: true,
      lastPing: 'Connected'
    },
    {
      id: 'barcode-scanner',
      name: 'Retail Barcode Scanner',
      model: 'Honeywell Xenon 1950g 2D',
      interface: 'USB HID Emulation',
      role: 'Retail whole beans, syrups & cups',
      status: 'Standby',
      isOnline: true,
      lastPing: 'Ready'
    }
  ],

  // Payment methods / tender configurations
  paymentMethods: [
    {
      id: 'cash',
      name: 'Cash (EGP)',
      type: 'Cash Drawer',
      enabled: true,
      feePercentage: 0,
      description: 'Physical cash collected in POS drawer; counted during end-of-shift drop.'
    },
    {
      id: 'card',
      name: 'Card (Visa / Mastercard)',
      type: 'Terminal',
      enabled: true,
      feePercentage: 1.75,
      description: 'Local and international debit/credit cards processed via PAX A920 terminal.'
    },
    {
      id: 'instapay',
      name: 'InstaPay Egypt (IPA)',
      type: 'Instant Bank QR',
      enabled: true,
      feePercentage: 0,
      description: 'Direct account-to-account instant transfer via National Instant Payment Network.'
    },
    {
      id: 'house_account',
      name: 'House Account / Office Tab',
      type: 'Credit Facility',
      enabled: false,
      feePercentage: 0,
      description: 'Monthly charge account for neighborhood regulars and partner offices.'
    }
  ],

  // Operational & shift policies
  policies: {
    requireCashierSignIn: true,
    requireOpenSession: true,
    attributeSalesToSession: true,
    enforceBlindDrawerDrop: true,
    printReceiptOnCompletion: true
  }
};

class Store {
  constructor() {
    this.listeners = [];
    this.state = this.loadState();
  }

  loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_STATE,
          ...parsed,
          branch: {
            ...DEFAULT_STATE.branch,
            ...(parsed.branch || {})
          },
          devices: (parsed.devices && parsed.devices.length) ? parsed.devices : DEFAULT_STATE.devices,
          paymentMethods: (parsed.paymentMethods && parsed.paymentMethods.length) ? parsed.paymentMethods : DEFAULT_STATE.paymentMethods,
          policies: {
            ...DEFAULT_STATE.policies,
            ...(parsed.policies || {})
          },
          events: (parsed.events && parsed.events.length) ? parsed.events : DEFAULT_STATE.events
        };
      }
    } catch (e) {
      console.warn('Could not read from localStorage, using defaults', e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
    this.notify();
  }

  resetToDefaults() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.saveState();
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  notify() {
    for (const callback of this.listeners) {
      try {
        callback(this.state);
      } catch (e) {
        console.error('Subscriber notification error', e);
      }
    }
  }

  getState() {
    return this.state;
  }

  /* -------------------------------------------------------------
     POS & SALES ACTIONS (Deducts recipes from Bar stock only!)
     ------------------------------------------------------------- */
  chargeCurrentOrder(tenderMethod = 'cash') {
    const order = this.state.openOrder;
    if (!order || !order.items || order.items.length === 0) return null;

    const invoicePrefix = this.state.branch.invoicePrefix || 'INV-';
    const invoiceNumber = `${invoicePrefix}${String(this.state.branch.nextInvoiceNumber).padStart(4, '0')}`;
    this.state.branch.nextInvoiceNumber += 1;

    // Deduct raw ingredients from Bar Stock
    const deductionLogs = [];
    for (const item of order.items) {
      const product = this.state.products.find(p => p.id === item.id);
      if (product && product.ingredients) {
        for (const ing of product.ingredients) {
          const invItem = this.state.inventory.find(i => i.sku === ing.sku);
          if (invItem) {
            const deductionAmount = ing.qty * item.quantity;
            invItem.barStock = Math.max(0, +(invItem.barStock - deductionAmount).toFixed(3));
            if (invItem.barStock <= invItem.barMinimum) {
              invItem.status = 'low';
            }
            deductionLogs.push(`${(deductionAmount >= 1 ? deductionAmount : deductionAmount * 1000)} ${ing.unit === 'kg' && deductionAmount < 1 ? 'g' : (ing.unit === 'L' && deductionAmount < 1 ? 'ml' : ing.unit)} ${invItem.name}`);
          }
        }
      }
    }

    // Create the invoice
    const newInvoice = {
      id: invoiceNumber,
      saleId: order.id,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      date: '26 Oct 2026',
      customer: order.eventLinked ? `Event Guest (${order.eventLinked})` : 'Walk-in customer',
      type: `${order.type} · ${order.table}`,
      cashier: this.state.session.cashier,
      items: order.items.map(i => ({
        id: i.id,
        name: i.name,
        desc: i.modifiers || 'Standard',
        unitPrice: i.unitPrice,
        qty: i.quantity,
        total: i.total
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      serviceCharge: order.serviceChargeAmount || 0,
      total: order.total,
      status: 'Paid',
      paymentMethod: tenderMethod === 'cash' ? 'Cash' : (tenderMethod === 'card' ? 'Card' : (tenderMethod === 'instapay' ? 'InstaPay' : 'House Account')),
      paymentRef: `PAY-${invoiceNumber.replace(/^[^\d]+/, '')} · ${order.openedTime} · Recorded by ${this.state.session.cashier}`,
      stockDeductionSummary: deductionLogs.join(' · ') || 'Stock deducted from Bar stock',
      isRectified: false
    };

    this.state.invoices.unshift(newInvoice);

    // Update Session & Metrics
    this.state.session.completedSales += 1;
    this.state.session.netSales += order.total;
    if (tenderMethod === 'cash') {
      this.state.session.cashSales += order.total;
      this.state.session.expectedDrawer += order.total;
    } else {
      this.state.session.cardSales += order.total;
    }

    // Add activity
    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'sale',
      title: `Sale #${order.id} completed`,
      detail: `${invoiceNumber} created · EGP ${order.total.toFixed(2)} recorded · Bar stock deducted`,
      time: newInvoice.time
    });

    // Prepare next order
    this.state.openOrder = {
      id: order.id + 1,
      code: `Order #${order.id + 1}`,
      table: 'Table 01 · 2 guests',
      type: 'Dine-in',
      status: 'open',
      openedTime: newInvoice.time,
      cashier: this.state.session.cashier,
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      paymentMethod: 'cash'
    };

    this.saveState();
    return newInvoice;
  }

  addItemToCart(product, modifiers = 'Standard') {
    const existing = this.state.openOrder.items.find(i => i.id === product.id && i.modifiers === modifiers);
    if (existing) {
      existing.quantity += 1;
      existing.total = +(existing.quantity * existing.unitPrice).toFixed(2);
    } else {
      this.state.openOrder.items.push({
        id: product.id,
        name: product.name,
        unitPrice: product.price,
        quantity: 1,
        total: product.price,
        recipeDesc: product.recipeSummary,
        modifiers: modifiers
      });
    }

    this.recalculateCartTotals();
    this.saveState();
  }

  updateItemQuantity(index, delta) {
    const item = this.state.openOrder.items[index];
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
      this.state.openOrder.items.splice(index, 1);
    } else {
      item.total = +(item.quantity * item.unitPrice).toFixed(2);
    }

    this.recalculateCartTotals();
    this.saveState();
  }

  recalculateCartTotals() {
    const sub = this.state.openOrder.items.reduce((acc, i) => acc + i.total, 0);
    const taxRate = parseFloat(this.state.branch.taxRate) || 0;
    const serviceRate = parseFloat(this.state.branch.serviceCharge) || 0;
    const taxAmount = +(sub * (taxRate / 100)).toFixed(2);
    const serviceAmount = +(sub * (serviceRate / 100)).toFixed(2);

    this.state.openOrder.subtotal = +sub.toFixed(2);
    this.state.openOrder.tax = taxAmount;
    this.state.openOrder.serviceChargeAmount = serviceAmount;
    this.state.openOrder.total = +(sub + taxAmount + serviceAmount).toFixed(2);
  }

  setOrderType(type, eventTitle = null) {
    this.state.openOrder.type = type;
    if (eventTitle) {
      this.state.openOrder.eventLinked = eventTitle;
      this.state.openOrder.table = `Event: ${eventTitle}`;
    }
    this.saveState();
  }

  /* -------------------------------------------------------------
     INVOICE RECTIFICATION & MISTAKE CONTROL (WITH AUTO-RESTOCK!)
     ------------------------------------------------------------- */
  rectifyInvoice(invoiceId, { action, reason, newPaymentMethod, newItems }) {
    const inv = this.state.invoices.find(i => i.id === invoiceId);
    if (!inv) return false;

    const oldTotal = inv.total;
    const oldMethod = inv.paymentMethod;
    const isOldPaid = inv.status === 'Paid';

    if (action === 'void') {
      // 1. Restore all recipe ingredients back to Bar stock
      for (const item of inv.items) {
        const product = this.state.products.find(p => p.id === item.id || p.name === item.name);
        if (product && product.ingredients) {
          for (const ing of product.ingredients) {
            const invItem = this.state.inventory.find(i => i.sku === ing.sku);
            if (invItem) {
              const restoredQty = ing.qty * item.qty;
              invItem.barStock = +(invItem.barStock + restoredQty).toFixed(3);
              if (invItem.barStock > invItem.barMinimum) {
                invItem.status = 'normal';
              }
            }
          }
        }
      }

      // 2. Adjust financials
      if (isOldPaid) {
        this.state.session.netSales = Math.max(0, +(this.state.session.netSales - oldTotal).toFixed(2));
        if (oldMethod === 'Cash') {
          this.state.session.cashSales = Math.max(0, +(this.state.session.cashSales - oldTotal).toFixed(2));
          this.state.session.expectedDrawer = Math.max(0, +(this.state.session.expectedDrawer - oldTotal).toFixed(2));
        } else {
          this.state.session.cardSales = Math.max(0, +(this.state.session.cardSales - oldTotal).toFixed(2));
        }
      }

      inv.status = 'Voided';
      inv.isRectified = true;
      inv.rectificationNote = `Order voided due to mistake: "${reason}". Raw ingredients restored to Bar stock.`;

      this.state.connectedActivity.unshift({
        id: Date.now(),
        type: 'sale',
        title: `${inv.id} VOIDED · Mistake rectified`,
        detail: `EGP ${oldTotal.toFixed(2)} refunded · Recipe stock returned to Bar stock · ${reason}`,
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      });

    } else if (action === 'edit') {
      // Handle item quantity changes and restore partial ingredients
      if (newItems && Array.isArray(newItems)) {
        for (const newItem of newItems) {
          const oldItem = inv.items.find(it => it.id === newItem.id || it.name === newItem.name);
          const oldQty = oldItem ? oldItem.qty : 0;
          const deltaQty = oldQty - newItem.qty;

          if (deltaQty > 0) {
            // Customer ordered less or item removed: restore surplus ingredients to Bar stock
            const product = this.state.products.find(p => p.id === newItem.id || p.name === newItem.name);
            if (product && product.ingredients) {
              for (const ing of product.ingredients) {
                const invItem = this.state.inventory.find(i => i.sku === ing.sku);
                if (invItem) {
                  const restoredQty = ing.qty * deltaQty;
                  invItem.barStock = +(invItem.barStock + restoredQty).toFixed(3);
                  if (invItem.barStock > invItem.barMinimum) {
                    invItem.status = 'normal';
                  }
                }
              }
            }
          }
        }

        inv.items = newItems.filter(it => it.qty > 0);
        inv.subtotal = inv.items.reduce((acc, it) => acc + (it.unitPrice * it.qty), 0);
        inv.total = inv.subtotal;
      }

      // Handle payment method adjustment (e.g. Cash -> Card)
      if (newPaymentMethod && newPaymentMethod !== inv.paymentMethod) {
        if (oldMethod === 'Cash' && newPaymentMethod === 'Card') {
          this.state.session.cashSales = Math.max(0, +(this.state.session.cashSales - oldTotal).toFixed(2));
          this.state.session.expectedDrawer = Math.max(0, +(this.state.session.expectedDrawer - oldTotal).toFixed(2));
          this.state.session.cardSales += inv.total;
        } else if (oldMethod === 'Card' && newPaymentMethod === 'Cash') {
          this.state.session.cardSales = Math.max(0, +(this.state.session.cardSales - oldTotal).toFixed(2));
          this.state.session.cashSales += inv.total;
          this.state.session.expectedDrawer += inv.total;
        }
        inv.paymentMethod = newPaymentMethod;
      }

      inv.isRectified = true;
      inv.status = 'Paid';
      inv.rectificationNote = `Invoice adjusted: "${reason}". Financials & stock synchronized.`;

      this.state.connectedActivity.unshift({
        id: Date.now(),
        type: 'sale',
        title: `${inv.id} Adjusted · Audit log`,
        detail: `Updated to EGP ${inv.total.toFixed(2)} (${inv.paymentMethod}) · ${reason}`,
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      });
    }

    this.saveState();
    return true;
  }

  /* -------------------------------------------------------------
     OUTSIDE & IN-HOUSE EVENTS
     ------------------------------------------------------------- */
  addEvent(eventData) {
    const newId = `EVT-00${this.state.events.length + 1}`;
    const newEvt = {
      id: newId,
      title: eventData.title,
      date: eventData.date || '30 Oct 2026',
      time: eventData.time || '14:00–18:00',
      venue: eventData.venue || 'Outside Venue · Cairo',
      type: eventData.type || 'Outside Event',
      guests: parseInt(eventData.guests) || 50,
      assignedStaff: eventData.assignedStaff || 'Omar Nabil',
      status: 'Planned',
      description: eventData.description || 'Outside catering event with mobile bar.',
      allocatedStock: eventData.allocatedStock || 'Standard event stock kit'
    };

    this.state.events.unshift(newEvt);

    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'receipt',
      title: `Event Planned · ${newEvt.title}`,
      detail: `${newEvt.date} · ${newEvt.venue} · Assigned to ${newEvt.assignedStaff}`,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });

    this.saveState();
    return newEvt;
  }

  /* -------------------------------------------------------------
     WAREHOUSES MANAGEMENT (Add Warehouse)
     ------------------------------------------------------------- */
  addWarehouse({ name, type, description, location }) {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newWh = {
      id,
      name,
      type: type || 'reserve',
      description: description || `${name} · Storage facility`,
      itemCount: 0,
      leadItem: location || 'Main Facility'
    };

    this.state.warehouses.push(newWh);

    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'transfer',
      title: `Warehouse Added · ${name}`,
      detail: `Type: ${type} · ${description || 'Ready for transfers & deliveries'}`,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });

    this.saveState();
    return newWh;
  }

  /* -------------------------------------------------------------
     SUPPLIERS DIRECTORY (Add Supplier)
     ------------------------------------------------------------- */
  addSupplier({ name, contact, phone, supplies, schedule, notes }) {
    const newSupp = {
      name,
      contact: contact || 'Contact person',
      phone: phone || '010 0000 0000',
      supplies: supplies || 'General supplies',
      schedule: schedule || 'On demand',
      notes: notes || ''
    };

    this.state.suppliers.push(newSupp);

    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'receipt',
      title: `Supplier Added · ${name}`,
      detail: `Contact: ${contact} (${phone}) · Supplies: ${supplies}`,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });

    this.saveState();
    return newSupp;
  }

  /* -------------------------------------------------------------
     INVENTORY TRANSFERS (Dry / Cold Store -> Bar Stock)
     ------------------------------------------------------------- */
  transferStock(fromWarehouse, toWarehouse, sku, quantity, note = 'Bar replenishment') {
    const item = this.state.inventory.find(i => i.sku === sku);
    if (!item) return false;

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return false;

    // Deduct from source
    if (fromWarehouse === 'dry_store') {
      if (item.dryStore < qty) return false;
      item.dryStore = +(item.dryStore - qty).toFixed(2);
    } else if (fromWarehouse === 'cold_store') {
      if (item.coldStore < qty) return false;
      item.coldStore = +(item.coldStore - qty).toFixed(2);
    } else if (fromWarehouse === 'bar_stock') {
      if (item.barStock < qty) return false;
      item.barStock = +(item.barStock - qty).toFixed(2);
    }

    // Add to target
    if (toWarehouse === 'bar_stock') {
      item.barStock = +(item.barStock + qty).toFixed(2);
      if (item.barStock > item.barMinimum) {
        item.status = 'normal';
      }
    } else if (toWarehouse === 'dry_store') {
      item.dryStore = +(item.dryStore + qty).toFixed(2);
    } else if (toWarehouse === 'cold_store') {
      item.coldStore = +(item.coldStore + qty).toFixed(2);
    }

    const trNum = `TR-00${this.state.warehouseMovements.length + 19}`;
    const timeStr = 'Today ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const fromWhObj = this.state.warehouses.find(w => w.id === fromWarehouse);
    const toWhObj = this.state.warehouses.find(w => w.id === toWarehouse);
    const fromLabel = fromWhObj ? fromWhObj.name : fromWarehouse;
    const toLabel = toWhObj ? toWhObj.name : toWarehouse;

    this.state.warehouseMovements.unshift({
      ref: trNum,
      time: timeStr,
      from: fromLabel,
      to: toLabel,
      item: item.name,
      sku: item.sku,
      qty: `${qty} ${item.unit}`,
      handledBy: this.state.currentUser.name,
      status: 'Completed'
    });

    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'transfer',
      title: `${trNum} · ${fromLabel} → ${toLabel}`,
      detail: `${qty} ${item.unit} ${item.name} · Completed by ${this.state.currentUser.name}`,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });

    this.saveState();
    return true;
  }

  /* -------------------------------------------------------------
     SUPPLIER DELIVERY RECEIVING
     ------------------------------------------------------------- */
  receiveDelivery(receiptId, destinationWarehouse, receivedQty) {
    const delivery = this.state.deliveries.find(d => d.id === receiptId);
    if (!delivery || delivery.status === 'Received') return false;

    const whObj = this.state.warehouses.find(w => w.id === destinationWarehouse);
    delivery.status = 'Received';
    delivery.destination = whObj ? whObj.name : destinationWarehouse;
    delivery.receivedQty = parseFloat(receivedQty) || delivery.orderedQty;

    // Add to destination warehouse
    const item = this.state.inventory.find(i => i.sku === delivery.sku);
    if (item) {
      if (destinationWarehouse === 'dry_store') {
        item.dryStore = +(item.dryStore + delivery.receivedQty).toFixed(2);
      } else if (destinationWarehouse === 'cold_store') {
        item.coldStore = +(item.coldStore + delivery.receivedQty).toFixed(2);
      } else {
        item.barStock = +(item.barStock + delivery.receivedQty).toFixed(2);
      }
    }

    this.state.connectedActivity.unshift({
      id: Date.now(),
      type: 'receipt',
      title: `${delivery.id} received · ${delivery.supplier}`,
      detail: `${delivery.receivedQty} ${delivery.unit} ${delivery.item} added to ${delivery.destination}`,
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    });

    this.saveState();
    return true;
  }

  /* -------------------------------------------------------------
     REGISTER SESSION LIFECYCLE
     ------------------------------------------------------------- */
  openRegisterSession(cashierName, cashierEmail, openingFloat, note) {
    this.state.session = {
      id: `S-00${Math.floor(Math.random() * 90) + 29}`,
      register: 'POS-01',
      cashier: cashierName || 'Omar Nabil',
      cashierEmail: cashierEmail || 'omar@drip.example',
      role: 'Barista · POS operator',
      status: 'Active',
      openedAt: `26 Oct 2026 · ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      openingFloat: parseFloat(openingFloat) || 500.00,
      openingNote: note || 'Morning shift · Float counted',
      netSales: 0.00,
      completedSales: 0,
      cashSales: 0.00,
      cardSales: 0.00,
      expectedDrawer: parseFloat(openingFloat) || 500.00
    };

    this.saveState();
  }

  closeRegisterSession(countedCash, closingNote) {
    this.state.session.status = 'Closed';
    this.state.session.countedCash = parseFloat(countedCash);
    this.state.session.closingNote = closingNote;
    this.state.session.difference = +(this.state.session.countedCash - this.state.session.expectedDrawer).toFixed(2);
    this.saveState();
  }

  /* -------------------------------------------------------------
     ROLE PERMISSIONS TOGGLES
     ------------------------------------------------------------- */
  togglePermission(role, key, value) {
    if (this.state.rolePermissions[role]) {
      this.state.rolePermissions[role][key] = value;
      this.saveState();
    }
  }

  /* -------------------------------------------------------------
     ADMIN BRANCH & SYSTEM SETTINGS
     ------------------------------------------------------------- */
  updateSettings(newSettings) {
    this.state.branch = { ...this.state.branch, ...newSettings };
    this.recalculateCartTotals();
    this.saveState();
  }

  updatePolicies(policies) {
    this.state.policies = { ...this.state.policies, ...policies };
    this.saveState();
  }

  togglePaymentMethod(id, enabled) {
    if (!this.state.paymentMethods) return;
    const method = this.state.paymentMethods.find(m => m.id === id);
    if (method) {
      method.enabled = enabled;
      this.saveState();
    }
  }

  updateDevice(id, updates) {
    if (!this.state.devices) return;
    const device = this.state.devices.find(d => d.id === id);
    if (device) {
      Object.assign(device, updates);
      this.saveState();
    }
  }

  exportState() {
    return JSON.stringify(this.state, null, 2);
  }

  importState(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !parsed.branch || !parsed.inventory) {
        throw new Error('Invalid ERP backup format: missing core branch or inventory state');
      }
      this.state = parsed;
      this.saveState();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

export const store = new Store();
