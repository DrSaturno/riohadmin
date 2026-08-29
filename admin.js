// RIOH. ADMIN ENGINE

// ── LOGIN SYSTEM ──
document.addEventListener('DOMContentLoaded', initializeAdminAuth);

async function initializeAdminAuth() {
    const errorEl = document.getElementById('login-error');
    if (typeof window.supabase === 'undefined') {
        errorEl.textContent = 'No se pudo cargar el servicio de autenticación.';
        return;
    }

    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    client.auth.onAuthStateChange(event => {
        if (event === 'SIGNED_OUT') showAdminLogin();
    });

    try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error) throw error;
        if (session?.user && await isAuthorizedAdmin(session.user.id)) {
            showAdminApp();
        } else {
            if (session) await client.auth.signOut();
            showAdminLogin();
        }
    } catch (error) {
        console.error('Admin auth initialization error:', error);
        errorEl.textContent = 'No se pudo validar la sesión. Intentá nuevamente.';
        showAdminLogin();
    }
}

async function isAuthorizedAdmin(userId) {
    if (!client || !userId) return false;

    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await client
            .from('admin_usuarios')
            .select('user_id')
            .eq('user_id', userId)
            .eq('activo', true)
            .maybeSingle();

        if (!error) return Boolean(data);

        lastError = error;
        if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    console.error('Admin authorization error:', lastError);
    throw new Error('No se pudo verificar el acceso con Supabase. Revisá la conexión e intentá nuevamente.');
}

window.doLogin = async function () {
    const email = (document.getElementById('login-user').value || '').trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');
    const button = document.querySelector('#login-overlay .login-btn');

    if (!email || !pass) {
        errorEl.textContent = 'Completá email y contraseña';
        return;
    }

    if (!client) {
        errorEl.textContent = 'El servicio todavía no está listo. Reintentá en unos segundos.';
        return;
    }

    errorEl.textContent = '';
    if (button) { button.disabled = true; button.textContent = 'VALIDANDO...'; }
    try {
        const { data, error } = await client.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        if (!data.user || !await isAuthorizedAdmin(data.user.id)) {
            await client.auth.signOut();
            throw new Error('Esta cuenta no tiene permisos de administrador.');
        }
        showAdminApp();
    } catch (error) {
        console.error('Admin login error:', error);
        errorEl.textContent = error.message === 'Invalid login credentials'
            ? 'Email o contraseña incorrectos.'
            : (error.message || 'No se pudo iniciar sesión.');
        document.getElementById('login-pass').value = '';
        document.getElementById('login-pass').focus();
    } finally {
        if (button) { button.disabled = false; button.textContent = 'INGRESAR'; }
    }
};

window.doLogout = async function () {
    if (client) await client.auth.signOut();
    location.reload();
};

let adminAppInitialized = false;

function showAdminLogin() {
    document.getElementById('login-overlay')?.classList.remove('hidden');
    const main = document.getElementById('main-content');
    if (main) main.style.display = 'none';
}

function showAdminApp() {
    document.getElementById('login-overlay')?.classList.add('hidden');
    document.getElementById('main-content').style.display = 'block';
    if (!adminAppInitialized) {
        adminAppInitialized = true;
        initApp();
    }
}

const SUPABASE_URL = 'https://xjoyrjzvdfwavnvnfnvt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhqb3lyanp2ZGZ3YXZudm5mbnZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NzIxMDYsImV4cCI6MjA4NjQ0ODEwNn0.Uw0MwDvBPtRjyMCt2ZA-kMYvVmIhUPXPP52AJo4a14Y';

let client = null;
let allInsumos = [];
let currentFilter = 'hoy';
let customDateRange = { from: null, to: null };

let ordersFilter = 'hoy';
let ordersCustomRange = { from: null, to: null };
let ordersAutoRefreshTimer = null;
let currentRecipe = [];
let allIngredientesForRecipe = [];
let allProductCategories = [];
let productCategoriesAvailable = true;
let productPreviewObjectUrl = null;

// ── QZ TRAY STATE ──
let _qzConnected = false;
let _selectedPrinter = localStorage.getItem('rioh_printer') || null;
const _qzUnsignedLocalOnly = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);

// ── IMAGE HELPER ──
function getProductImage(productNameOrUrl) {
    if (productNameOrUrl) {
        if (productNameOrUrl.toLowerCase().includes('papas')) return 'papas.webp';
        if (productNameOrUrl.toLowerCase().includes('nuggets')) return 'nuggets.webp';
    }
    return 'burger1.webp';
}

const OPTIMIZED_ADMIN_IMAGES = new Map([
    ['malbec_rich.jpg', 'malbec_rich.webp'],
    ['cheddar_soul.jpg', 'cheddar_soul.webp'],
    ['crunchy_byte.jpg', 'crunchy_byte.webp'],
    ['fresh_bloom.jpg', 'fresh_bloom.webp'],
    ['burger1.png', 'burger1.webp'],
    ['nuggets.png', 'nuggets.webp'],
    ['papas.png', 'papas.webp']
]);

function optimizedAdminImage(value) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    return OPTIMIZED_ADMIN_IMAGES.get(raw.replace(/^\.\//, '')) || raw;
}

function normalizeOrderExtra(extra) {
    if (typeof extra === 'string') return { name: extra, qty: 1, unitPrice: 0 };
    return {
        name: extra?.name || '',
        qty: Math.max(1, parseInt(extra?.qty) || 1),
        unitPrice: parseFloat(extra?.unitPrice) || 0
    };
}

function formatOrderExtra(extra) {
    const normalized = normalizeOrderExtra(extra);
    if (!normalized.name) return '';
    return `${normalized.qty > 1 ? `${normalized.qty}x ` : ''}${normalized.name}`;
}

function formatOrderExtras(extras, separator = ', ') {
    return (extras || []).map(formatOrderExtra).filter(Boolean).join(separator);
}

function formatOrderRemovedIngredients(item, separator = ', ') {
    return (item?.removedIngredients || [])
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .join(separator);
}

function normalizeOrderText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function isMedallionExtra(extra) {
    return normalizeOrderText(normalizeOrderExtra(extra).name).includes('medallon');
}

function getComandaSize(item) {
    if (!item?.type) return '';
    const basePatties = normalizeOrderText(item.type) === 'doble' ? 2 : 1;
    const extraPatties = (item.extras || []).reduce((total, extra) => {
        return total + (isMedallionExtra(extra) ? normalizeOrderExtra(extra).qty : 0);
    }, 0);
    const patties = basePatties + extraPatties;
    return ({ 1: 'SIMPLE', 2: 'DOBLE', 3: 'TRIPLE', 4: 'CUADRUPLE' })[patties]
        || `${patties} MEDALLONES`;
}

function getComandaProductName(item) {
    const title = String(item?.title || 'ITEM').trim();
    return (item?.type ? title.split(/\s+/)[0] : title).toUpperCase();
}

function getComandaExtraDetails(item) {
    return (item?.extras || []).filter(extra => !isMedallionExtra(extra));
}

let orderBenefitCatalog = new Map();

async function loadOrderBenefitCatalog() {
    const [couponsResult, promosResult] = await Promise.all([
        client.from('cupones').select('id, codigo'),
        client.from('promociones').select('id, nombre')
    ]);
    if (couponsResult.error) throw couponsResult.error;
    if (promosResult.error) throw promosResult.error;

    const catalog = new Map();
    (couponsResult.data || []).forEach(item => catalog.set(String(item.id), {
        type: 'coupon',
        typeLabel: 'CUPÓN',
        label: item.codigo || 'SIN CÓDIGO'
    }));
    (promosResult.data || []).forEach(item => catalog.set(String(item.id), {
        type: 'promotion',
        typeLabel: 'PROMOCIÓN',
        label: item.nombre || 'SIN NOMBRE'
    }));
    orderBenefitCatalog = catalog;
    return catalog;
}

function getOrderBenefit(order) {
    const referenceId = order?.cupon_id || order?.promo_id;
    const catalogBenefit = referenceId ? orderBenefitCatalog.get(String(referenceId)) : null;
    if (catalogBenefit) return { ...catalogBenefit, amount: Math.max(0, Number(order?.monto_descuento) || 0) };
    if (Number(order?.monto_descuento) > 0) {
        return { type: 'discount', typeLabel: 'DESCUENTO', label: 'DESCUENTO', amount: Number(order.monto_descuento) };
    }
    return null;
}

function orderBenefitText(order) {
    const benefit = getOrderBenefit(order);
    return benefit ? `${benefit.typeLabel}: ${benefit.label}` : '';
}

function summarizeOrderBenefits(orders) {
    return (orders || []).reduce((summary, order) => {
        if (order?.estado_pago === 'cancelado') return summary;
        const benefit = getOrderBenefit(order);
        if (!benefit) return summary;
        summary.orders += 1;
        summary.discount += benefit.amount;
        if (benefit.type === 'coupon') summary.coupons += 1;
        else if (benefit.type === 'promotion') summary.promotions += 1;
        else summary.other += 1;
        return summary;
    }, { orders: 0, coupons: 0, promotions: 0, other: 0, discount: 0 });
}

function benefitMetricsText(summary) {
    const parts = [
        `${summary.coupons} ${summary.coupons === 1 ? 'cupón' : 'cupones'}`,
        `${summary.promotions} ${summary.promotions === 1 ? 'promo' : 'promos'}`
    ];
    if (summary.other) parts.push(`${summary.other} ${summary.other === 1 ? 'otro' : 'otros'}`);
    parts.push(`$${summary.discount.toLocaleString('es-AR')} descontados`);
    return parts.join(' · ');
}

function formatScheduledDelivery(isoValue, fallback = 'A coordinar') {
    if (!isoValue) return fallback;
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return fallback;
    return `${date.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    })} hs`;
}

// ── MOBILE MENU ──
window.toggleMobileMenu = function () {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeMobileMenu = function () {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
};

// ── APP INITIALIZATION ──
async function initApp() {
    if (client) {
        loadOrders();
        initRealtime();
        initForms();
        startOrdersAutoRefresh();
        loadStoreStatus();
        loadStoreHours();
        initProductImagePreview();
        initCategoryForm();
        loadProductCategories();
        loadIngredientesForRecipe();
        initQZTray(); // intentar conectar ticketera silenciosamente
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

function initForms() {
    const stockForm = document.getElementById('stock-form');
    if (stockForm) stockForm.onsubmit = handleStockSubmit;

    const marketingForm = document.getElementById('marketing-form');
    if (marketingForm) marketingForm.onsubmit = handleMarketingSubmit;
}

// ── QZ TRAY INIT ──
async function initQZTray() {
    if (!_qzUnsignedLocalOnly || typeof qz === 'undefined') {
        updateQZStatusUI(false);
        return;
    }

    // Modo sin firma digital (uso local/privado)
    qz.security.setCertificatePromise(function(resolve) { resolve(); });
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise(function(toSign, resolve) { resolve(); });

    // Suprimir errores de QZ en consola durante el intento de conexión
    qz.websocket.setErrorCallbacks(function() {});
    qz.websocket.setClosedCallbacks(function() {
        _qzConnected = false;
        updateQZStatusUI(false);
    });

    try {
        await qz.websocket.connect({ retries: 1, delay: 500 });
        _qzConnected = true;
        if (!_selectedPrinter) {
            _selectedPrinter = await qz.printers.getDefault();
            localStorage.setItem('rioh_printer', _selectedPrinter);
        }
        updateQZStatusUI(true);
        console.log('[QZ Tray] Conectado. Impresora:', _selectedPrinter);
    } catch (e) {
        _qzConnected = false;
        updateQZStatusUI(false);
        console.log('[QZ Tray] No disponible (esperado si la app no está abierta)');
    }
}

function updateQZStatusUI(connected) {
    const dot = document.getElementById('qz-indicator');
    const btn = document.getElementById('qz-status-btn');
    if (!dot) return;
    if (connected) {
        dot.textContent = '🟢';
        dot.title = `QZ Tray conectado — ${_selectedPrinter || 'impresora default'}`;
        if (btn) btn.title = `Ticketera conectada: ${_selectedPrinter || 'default'}`;
    } else {
        dot.textContent = '🔴';
        if (btn) btn.title = 'Ticketera desconectada — click para configurar';
    }
}

// Abrir panel de configuración de ticketera
window.openTicketeraConfig = async function () {
    document.getElementById('ticketera-modal').style.display = 'flex';
    renderTicketeraStatus();
    if (_qzConnected) await loadPrintersForTicketera();
};

window.closeTicketeraConfig = function (e) {
    if (!e || e.target === document.getElementById('ticketera-modal')) {
        document.getElementById('ticketera-modal').style.display = 'none';
    }
};

function renderTicketeraStatus() {
    const statusEl = document.getElementById('qz-status-block');
    if (_qzConnected) {
        statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px;background:#e8f5e9;border:2px solid #2e7d32;">
            <span style="font-size:1.4rem;">🟢</span>
            <div>
                <div style="font-weight:700;font-size:0.9rem;color:#1b5e20;">QZ TRAY CONECTADO</div>
                <div style="font-size:0.78rem;color:#388e3c;">Los tickets se imprimen automáticamente sin diálogos</div>
            </div>
        </div>`;
        document.getElementById('qz-printer-block').style.display = 'block';
        document.getElementById('qz-offline-block').style.display = 'none';
    } else {
        const productionNotice = !_qzUnsignedLocalOnly
            ? 'En producción se usa la impresión segura del navegador. La impresión silenciosa requiere un certificado QZ y un endpoint de firma.'
            : 'Instalá QZ Tray para imprimir sin diálogos';
        statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px;background:#ffebee;border:2px solid #c62828;">
            <span style="font-size:1.4rem;">🔴</span>
            <div>
                <div style="font-weight:700;font-size:0.9rem;color:#b71c1c;">QZ TRAY NO DETECTADO</div>
                <div style="font-size:0.78rem;color:#c62828;">${productionNotice}</div>
            </div>
        </div>`;
        document.getElementById('qz-printer-block').style.display = 'none';
        document.getElementById('qz-offline-block').style.display = 'block';
    }
}

async function loadPrintersForTicketera() {
    try {
        const printers = await qz.printers.find();
        const select = document.getElementById('qz-printer-select');
        if (!select) return;
        const saved = _selectedPrinter || '';
        select.replaceChildren(...printers.map(printer => {
            const option = new Option(String(printer), String(printer), false, printer === saved);
            return option;
        }));
    } catch (e) {
        console.error('[QZ] Error cargando impresoras:', e);
    }
}

window.saveTicketeraConfig = function () {
    const select = document.getElementById('qz-printer-select');
    if (!select || !select.value) return;
    _selectedPrinter = select.value;
    localStorage.setItem('rioh_printer', _selectedPrinter);
    showStatusToast(`✅ Impresora guardada: ${_selectedPrinter}`);
    updateQZStatusUI(true);
};

window.retryQZConnect = async function () {
    if (!_qzUnsignedLocalOnly) {
        showStatusToast('QZ Tray requiere firma digital para habilitarse en producción');
        return;
    }
    const btn = document.querySelector('#qz-offline-block button[onclick="retryQZConnect()"]');
    if (btn) btn.textContent = 'CONECTANDO...';
    await initQZTray();
    renderTicketeraStatus();
    if (_qzConnected) await loadPrintersForTicketera();
    if (btn) btn.textContent = 'REINTENTAR';
};

window.testPrintQZ = function () {
    const testOrder = {
        numero_pedido: 'TEST',
        created_at: new Date().toISOString(),
        total: 9999,
        estado_pago: 'aprobado',
        metodo_entrega: 'delivery',
        direccion_entrega: 'Av. RIOH. 1234',
        timbre: '4° B',
        entrega_programada: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        clientes: { nombre: 'Ticket de Prueba', whatsapp: '' },
        items: [{
            qty: 1,
            title: 'MALBEC RICH',
            type: 'Doble',
            extras: [
                { name: 'Medallón Extra', qty: 1, unitPrice: 1500 },
                { name: 'Extra Bacon', qty: 1, unitPrice: 1500 }
            ],
            pricePerUnit: 9999
        }],
        nota: 'Prueba de comanda'
    };
    printTicket(testOrder, 'Efectivo');
};

// ── CASH REGISTER SOUND ──
function playCashRegisterSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        function ding(freq, startTime, duration) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + startTime + duration);
            gain.gain.setValueAtTime(0.4, ctx.currentTime + startTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);
            osc.start(ctx.currentTime + startTime);
            osc.stop(ctx.currentTime + startTime + duration);
        }
        ding(1400, 0, 0.25);
        ding(1000, 0.18, 0.3);
        ding(1200, 0.38, 0.35);
    } catch (e) { console.log("Audio error:", e); }
}

function initRealtime() {
    client
        .channel('schema-db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, () => {
            playCashRegisterSound();
            showNewOrderToast();
            loadOrders();
            const dashSec = document.getElementById('dashboard-section');
            if (dashSec && dashSec.classList.contains('active')) loadDashboard();
        })
        .subscribe();
}

function showNewOrderToast() {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 2rem; right: 2rem;
        background: var(--primary); color: white;
        padding: 1.5rem 2rem;
        border: 3px solid #111; box-shadow: 8px 8px 0px #111;
        font-family: 'Archivo Black', sans-serif;
        z-index: 9999;
        animation: toastIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    `;
    toast.innerHTML = '¡NUEVO PEDIDO ENTRANDO!';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.5s forwards';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

function showStatusToast(message) {
    const t = document.createElement('div');
    t.style.cssText = `
        position: fixed; top: 2rem; left: 50%; transform: translateX(-50%);
        background: var(--text-dark); color: white; padding: 1rem 2rem;
        border: 2px solid var(--primary); font-family: 'Archivo Black', sans-serif;
        box-shadow: 6px 6px 0px var(--primary); z-index: 10000;
        animation: toastIn 0.4s forwards;
    `;
    t.innerText = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ── EXPORT: WHATSAPP (DASHBOARD) ──
window.exportToWhatsApp = function () {
    const total = document.getElementById('stats-total-sales')?.innerText || '$0';
    const pedidos = document.getElementById('stats-orders-count')?.innerText || '0';
    const burgers = document.getElementById('stats-burgers-count')?.innerText || '0';
    const ticket = document.getElementById('stats-avg-ticket')?.innerText || '$0';
    const filters = { hoy: 'Hoy', semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre', semestre: 'Semestre', custom: 'Rango personalizado' };
    const periodo = filters[currentFilter] || currentFilter;
    let sellers = '';
    const bestEl = document.getElementById('best-sellers-list');
    if (bestEl) {
        const rows = bestEl.querySelectorAll('div');
        rows.forEach((r, i) => { if (i < 5) sellers += `  ${r.textContent.trim()}\n`; });
    }
    const text = `🍔 *RIOH. Burgers — Dashboard ${periodo}*\n\n📦 Pedidos: *${pedidos}*\n🍔 Burgers vendidas: *${burgers}*\n💰 Facturado: *${total}*\n🎯 Ticket promedio: *${ticket}*\n\n🏆 Ranking de productos:\n${sellers || '  Sin datos'}\n\n_Panel RIOH.ADMIN_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
};

window.exportToPDF = function () { window.print(); };

// ══════════════════════════════════
// STORE ON/OFF TOGGLE
// ══════════════════════════════════

async function loadStoreStatus() {
    if (!client) return;
    try {
        const { data } = await client.from('configuracion').select('valor').eq('id', 'ventas_web').maybeSingle();
        if (data && data.valor) {
            const isOnline = data.valor.online === true;
            document.getElementById('store-toggle').checked = isOnline;
            updateStoreStatusUI(isOnline);
        }
    } catch (e) { console.error("Error loading store status:", e); }
}

function updateStoreStatusUI(isOnline) {
    const label = document.getElementById('store-status-label');
    if (!label) return;
    if (isOnline) {
        label.textContent = 'ABIERTA (MANUAL)';
        label.className = 'store-toggle-status online';
    } else {
        label.textContent = 'SOLO HORARIOS';
        label.className = 'store-toggle-status offline';
    }
}

window.toggleStoreStatus = async function () {
    const toggle = document.getElementById('store-toggle');
    const newValue = toggle.checked;
    updateStoreStatusUI(newValue);

    try {
        const { error } = await client.from('configuracion').upsert({
            id: 'ventas_web',
            valor: { online: newValue }
        });
        if (error) throw error;
        showStatusToast(newValue ? 'TIENDA ABIERTA' : 'TIENDA CERRADA');
    } catch (e) {
        console.error("Error toggling store:", e);
        toggle.checked = !newValue;
        updateStoreStatusUI(!newValue);
        showStatusToast('Error al cambiar estado de tienda');
    }
};

// ══════════════════════════════════
// STORE HOURS CONFIGURATION
// ══════════════════════════════════

async function loadStoreHours() {
    if (!client) return;
    try {
        const { data } = await client.from('configuracion').select('valor').eq('id', 'horarios_atencion').maybeSingle();
        if (data && data.valor) {
            const h = data.valor;
            if (h.dias && Array.isArray(h.dias)) {
                document.querySelectorAll('#days-checkboxes input').forEach(cb => {
                    cb.checked = h.dias.includes(parseInt(cb.value));
                });
            }
            if (h.hora_apertura) document.getElementById('hours-open').value = h.hora_apertura;
            if (h.hora_cierre) document.getElementById('hours-close').value = h.hora_cierre;

            const dayNames = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
            const daysText = (h.dias || []).map(d => dayNames[d]).join(', ');
            const status = document.getElementById('hours-status');
            status.replaceChildren();
            const strong = document.createElement('strong');
            strong.textContent = 'Configuración actual:';
            status.append(strong, ` ${daysText || 'Sin días'} de ${h.hora_apertura || '--:--'} a ${h.hora_cierre || '--:--'}`);
        }
    } catch (e) { console.error("Error loading hours:", e); }
}

window.saveStoreHours = async function (e) {
    e.preventDefault();
    const dias = [];
    document.querySelectorAll('#days-checkboxes input:checked').forEach(cb => {
        dias.push(parseInt(cb.value));
    });
    const hora_apertura = document.getElementById('hours-open').value;
    const hora_cierre = document.getElementById('hours-close').value;

    try {
        const { error } = await client.from('configuracion').upsert({
            id: 'horarios_atencion',
            valor: { dias, hora_apertura, hora_cierre }
        });
        if (error) throw error;
        showStatusToast('HORARIOS GUARDADOS');
        loadStoreHours();
    } catch (err) {
        console.error(err);
        showStatusToast('Error al guardar horarios');
    }
};

// ══════════════════════════════════
// PRODUCTOS CRUD
// ══════════════════════════════════

function escapeAdminHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function safeAdminId(value) {
    const id = String(value || '');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ? id
        : '';
}

function safeAdminImageUrl(value, fallback = 'burger1.webp') {
    const raw = optimizedAdminImage(value);
    if (!raw) return fallback;
    try {
        const url = new URL(raw, window.location.href);
        if (!['http:', 'https:'].includes(url.protocol) && url.origin !== window.location.origin) return fallback;
        return url.href;
    } catch (_) {
        return fallback;
    }
}

function slugifyProductCategory(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function initCategoryForm() {
    const nameInput = document.getElementById('category-name');
    const slugInput = document.getElementById('category-slug');
    if (!nameInput || !slugInput || nameInput.dataset.slugSyncBound === '1') return;

    nameInput.dataset.slugSyncBound = '1';
    nameInput.addEventListener('input', () => {
        if (!document.getElementById('category-edit-id').value) {
            slugInput.value = slugifyProductCategory(nameInput.value);
        }
    });
    slugInput.addEventListener('input', () => {
        slugInput.value = slugifyProductCategory(slugInput.value);
    });
}

function getProductCategory(slug) {
    return allProductCategories.find(category => category.slug === slug) || null;
}

function populateProductCategorySelect(selectedSlug) {
    const select = document.getElementById('prod-categoria');
    if (!select) return;
    const currentValue = selectedSlug !== undefined ? selectedSlug : select.value;
    const options = allProductCategories.map(category =>
        `<option value="${escapeAdminHtml(category.slug)}">${escapeAdminHtml(String(category.nombre || category.slug).toUpperCase())}${category.activo ? '' : ' (INACTIVA)'}</option>`
    );

    if (currentValue && !allProductCategories.some(category => category.slug === currentValue)) {
        options.unshift(`<option value="${escapeAdminHtml(currentValue)}">${escapeAdminHtml(currentValue.toUpperCase())} (SIN CATEGORIA)</option>`);
    }

    select.innerHTML = options.length
        ? options.join('')
        : '<option value="">Primero crea una categoria</option>';

    if (currentValue && Array.from(select.options).some(option => option.value === currentValue)) {
        select.value = currentValue;
    } else {
        const firstActive = allProductCategories.find(category => category.activo);
        select.value = firstActive?.slug || allProductCategories[0]?.slug || '';
    }
    toggleDoblePrice();
}

function renderProductCategories() {
    const tbody = document.getElementById('categories-table-body');
    if (!tbody) return;

    if (!productCategoriesAvailable) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--primary); font-weight:800;">Falta crear la tabla categorias_productos en Supabase.</td></tr>';
        return;
    }

    if (!allProductCategories.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#999;">Sin categorias. Crea la primera arriba.</td></tr>';
        return;
    }

    tbody.innerHTML = allProductCategories.map(category => `
        <tr>
            <td>
                <strong style="font-family:'Archivo Black';">${escapeAdminHtml(category.nombre)}</strong>
                ${category.descripcion ? `<br><small style="color:#888;">${escapeAdminHtml(category.descripcion)}</small>` : ''}
            </td>
            <td><code>${escapeAdminHtml(category.slug)}</code></td>
            <td>${category.tipo_venta === 'configurable' ? 'CONFIGURABLE' : 'DIRECTO'}</td>
            <td>${Number(category.orden) || 0}</td>
            <td>${category.activo
                ? '<span class="status-badge status-ok">ACTIVA</span>'
                : '<span class="status-badge status-inactive">INACTIVA</span>'}</td>
            <td style="white-space:nowrap;">
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="editProductCategory('${category.id}')">EDITAR</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="toggleProductCategoryActive('${category.id}', ${category.activo})">${category.activo ? 'DESACTIVAR' : 'ACTIVAR'}</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px; color:var(--primary);" onclick="deleteProductCategory('${category.id}', '${category.slug}')">ELIMINAR</button>
            </td>
        </tr>
    `).join('');
}

async function loadProductCategories() {
    if (!client) return [];
    const previousValue = document.getElementById('prod-categoria')?.value || '';
    try {
        const { data, error } = await client
            .from('categorias_productos')
            .select('*')
            .order('orden', { ascending: true })
            .order('nombre', { ascending: true });
        if (error) throw error;

        productCategoriesAvailable = true;
        allProductCategories = data || [];
    } catch (error) {
        productCategoriesAvailable = false;
        console.error('Product categories load error:', error);
        allProductCategories = [
            { id: 'legacy-burgers', nombre: 'Burgers', slug: 'burgers', descripcion: '', tipo_venta: 'configurable', orden: 0, activo: true },
            { id: 'legacy-extras', nombre: 'Extras', slug: 'extras', descripcion: '', tipo_venta: 'directo', orden: 1, activo: true }
        ];
    }

    renderProductCategories();
    populateProductCategorySelect(previousValue || undefined);
    return allProductCategories;
}

window.refreshProductsModule = async function () {
    await Promise.all([loadProductCategories(), loadIngredientesForRecipe()]);
    await loadProductos();
};

window.handleCategorySubmit = async function (event) {
    event.preventDefault();
    if (!productCategoriesAvailable) {
        showStatusToast('Primero ejecuta la migracion de categorias en Supabase');
        return;
    }

    const editId = document.getElementById('category-edit-id').value;
    const submitBtn = document.getElementById('category-submit-btn');
    const nombre = document.getElementById('category-name').value.trim();
    const existingCategory = editId
        ? allProductCategories.find(category => String(category.id) === String(editId))
        : null;
    const slug = existingCategory?.slug || slugifyProductCategory(document.getElementById('category-slug').value);
    const descripcion = document.getElementById('category-description').value.trim();
    const tipoVenta = document.getElementById('category-sale-type').value;
    const orden = Number(document.getElementById('category-order').value);

    if (!nombre || !slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        showStatusToast('Completa un nombre y un slug valido');
        return;
    }
    if (!['directo', 'configurable'].includes(tipoVenta) || !Number.isInteger(orden) || orden < 0) {
        showStatusToast('Tipo de venta u orden invalido');
        return;
    }

    const payload = {
        nombre,
        slug,
        descripcion: descripcion || null,
        tipo_venta: tipoVenta,
        orden,
        activo: document.getElementById('category-active').checked
    };

    submitBtn.disabled = true;
    submitBtn.textContent = editId ? 'GUARDANDO...' : 'CREANDO...';
    try {
        const query = editId
            ? client.from('categorias_productos').update(payload).eq('id', editId)
            : client.from('categorias_productos').insert(payload);
        const { error } = await query;
        if (error) throw error;

        showStatusToast(editId ? 'CATEGORIA ACTUALIZADA' : 'CATEGORIA CREADA');
        cancelCategoryEdit();
        await loadProductCategories();
        await loadProductos();
    } catch (error) {
        console.error('Category save error:', error);
        showStatusToast('Error al guardar categoria: ' + (error.message || ''));
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = document.getElementById('category-edit-id').value ? 'GUARDAR CAMBIOS' : 'CREAR CATEGORIA';
    }
};

window.editProductCategory = function (id) {
    const category = allProductCategories.find(item => String(item.id) === String(id));
    if (!category || String(category.id).startsWith('legacy-')) return;

    document.getElementById('category-edit-id').value = category.id;
    document.getElementById('category-name').value = category.nombre || '';
    document.getElementById('category-slug').value = category.slug || '';
    document.getElementById('category-slug').readOnly = true;
    document.getElementById('category-description').value = category.descripcion || '';
    document.getElementById('category-sale-type').value = category.tipo_venta || 'directo';
    document.getElementById('category-order').value = Number(category.orden) || 0;
    document.getElementById('category-active').checked = category.activo !== false;
    document.getElementById('category-form-title').textContent = 'EDITAR CATEGORIA';
    document.getElementById('category-submit-btn').textContent = 'GUARDAR CAMBIOS';
    document.getElementById('category-cancel-btn').style.display = 'inline-block';
    document.getElementById('category-name').focus();
};

window.cancelCategoryEdit = function () {
    const form = document.getElementById('category-form');
    if (!form) return;
    form.reset();
    document.getElementById('category-edit-id').value = '';
    document.getElementById('category-slug').readOnly = false;
    document.getElementById('category-order').value = 0;
    document.getElementById('category-active').checked = true;
    document.getElementById('category-form-title').innerHTML = 'CATEGOR&Iacute;AS DE PRODUCTOS';
    document.getElementById('category-submit-btn').textContent = 'CREAR CATEGORIA';
    document.getElementById('category-cancel-btn').style.display = 'none';
};

window.toggleProductCategoryActive = async function (id, currentActive) {
    if (!productCategoriesAvailable) return;
    try {
        const { error } = await client.from('categorias_productos').update({ activo: !currentActive }).eq('id', id);
        if (error) throw error;
        await loadProductCategories();
        await loadProductos();
        showStatusToast(currentActive ? 'CATEGORIA DESACTIVADA' : 'CATEGORIA ACTIVADA');
    } catch (error) {
        console.error('Category status error:', error);
        showStatusToast('Error al cambiar el estado de la categoria');
    }
};

window.deleteProductCategory = async function (id, slug) {
    if (!productCategoriesAvailable) return;
    try {
        const { count, error: referenceError } = await client
            .from('productos')
            .select('id', { count: 'exact', head: true })
            .eq('categoria', slug);
        if (referenceError) throw referenceError;
        if (count > 0) {
            showStatusToast(`No se puede eliminar: ${count} producto(s) usan esta categoria`);
            return;
        }
        if (!confirm('Eliminar esta categoria? Esta accion no se puede deshacer.')) return;

        const { error } = await client.from('categorias_productos').delete().eq('id', id);
        if (error) throw error;
        await loadProductCategories();
        showStatusToast('CATEGORIA ELIMINADA');
    } catch (error) {
        console.error('Category delete error:', error);
        showStatusToast('Error al eliminar categoria: ' + (error.message || ''));
    }
};

function initProductImagePreview() {
    const input = document.getElementById('prod-imagen');
    if (!input || input.dataset.previewBound === '1') return;
    input.dataset.previewBound = '1';
    input.addEventListener('change', () => {
        const file = input.files[0];
        const preview = document.getElementById('prod-img-preview');
        if (productPreviewObjectUrl) {
            URL.revokeObjectURL(productPreviewObjectUrl);
            productPreviewObjectUrl = null;
        }
        if (file) {
            productPreviewObjectUrl = URL.createObjectURL(file);
            preview.src = productPreviewObjectUrl;
            preview.style.display = 'block';
        } else if (preview.dataset.persistedUrl) {
            preview.src = preview.dataset.persistedUrl;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    });
}

async function loadIngredientesForRecipe() {
    if (!client) return;
    try {
        const { data, error } = await client.from('insumos').select('*').order('nombre');
        if (error) throw error;
        allIngredientesForRecipe = data || [];
        const select = document.getElementById('recipe-ingredient-select');
        if (select) {
            const previousValue = select.value;
            select.innerHTML = '<option value="">Seleccionar ingrediente...</option>' +
                allIngredientesForRecipe.map(i => `<option value="${i.id}">${escapeAdminHtml(i.nombre)} (${escapeAdminHtml(i.unidad)})</option>`).join('');
            if (allIngredientesForRecipe.some(i => String(i.id) === String(previousValue))) select.value = previousValue;
        }
        return allIngredientesForRecipe;
    } catch (e) { console.error("Error loading ingredientes for recipe:", e); }
}

window.addRecipeIngredient = function () {
    const select = document.getElementById('recipe-ingredient-select');
    const qtyInput = document.getElementById('recipe-ingredient-qty');
    const doubleMultInput = document.getElementById('recipe-ingredient-double-mult');
    const id = select.value;
    const qty = Number(qtyInput.value);
    const doubleMult = Number(doubleMultInput.value);
    if (!id || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(doubleMult) || doubleMult <= 0) {
        showStatusToast('Selecciona ingrediente, cantidad y multiplicador validos');
        return;
    }
    if (currentRecipe.find(r => String(r.ingrediente_id) === String(id))) { showStatusToast('Ingrediente ya agregado'); return; }
    const ing = allIngredientesForRecipe.find(i => String(i.id) === String(id));
    if (!ing) return;
    currentRecipe.push({ ingrediente_id: ing.id, nombre: ing.nombre, cantidad: qty, unidad: ing.unidad, doble_mult: doubleMult });
    renderRecipeList();
    select.value = '';
    qtyInput.value = '';
    doubleMultInput.value = '1';
};

window.removeRecipeIngredient = function (ingredienteId) {
    currentRecipe = currentRecipe.filter(r => String(r.ingrediente_id) !== String(ingredienteId));
    renderRecipeList();
};

window.updateRecipeIngredient = function (ingredienteId, field, rawValue) {
    if (!['cantidad', 'doble_mult'].includes(field)) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
        showStatusToast('El valor debe ser mayor a cero');
        renderRecipeList();
        return;
    }
    const ingredient = currentRecipe.find(r => String(r.ingrediente_id) === String(ingredienteId));
    if (ingredient) ingredient[field] = value;
};

function renderRecipeList() {
    const container = document.getElementById('recipe-list');
    if (!container) return;
    if (!currentRecipe.length) {
        container.innerHTML = '<div style="color:#999; font-size:0.85rem; padding:8px;">Sin ingredientes asignados</div>';
        return;
    }
    container.innerHTML = currentRecipe.map(r => {
        const ingredientExists = allIngredientesForRecipe.some(i => String(i.id) === String(r.ingrediente_id));
        const quantity = Number(r.cantidad);
        const doubleMult = r.doble_mult === undefined || r.doble_mult === null || r.doble_mult === ''
            ? 1
            : Number(r.doble_mult);
        const recipeItemValid = ingredientExists && quantity > 0 && Number.isFinite(doubleMult) && doubleMult > 0;
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 12px; border:2px solid ${recipeItemValid ? '#eee' : 'var(--primary)'}; margin-bottom:4px; background:#fafafa; flex-wrap:wrap;">
                <span style="font-weight:700;">${escapeAdminHtml(r.nombre || 'Ingrediente eliminado')}${ingredientExists ? '' : ' (NO EXISTE)'}</span>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <label style="font-size:0.72rem; font-weight:800;">SIMPLE
                        <input type="number" value="${Number.isFinite(quantity) ? quantity : ''}" min="0.1" step="0.1" onchange="updateRecipeIngredient('${r.ingrediente_id}', 'cantidad', this.value)" style="width:82px; padding:5px; border:2px solid #111; font-weight:800;">
                    </label>
                    <span style="font-weight:700;">${escapeAdminHtml(r.unidad || '')}</span>
                    <label style="font-size:0.72rem; font-weight:800;">MULT. DOBLE
                        <input type="number" value="${Number.isFinite(doubleMult) ? doubleMult : ''}" min="0.1" step="0.1" onchange="updateRecipeIngredient('${r.ingrediente_id}', 'doble_mult', this.value)" style="width:72px; padding:5px; border:2px solid #111; font-weight:800;">
                    </label>
                    <button type="button" class="qty-btn" style="font-size:0.7rem; padding:4px 8px; color:var(--primary);" onclick="removeRecipeIngredient('${r.ingrediente_id}')">X</button>
                </div>
            </div>
        `;
    }).join('');
}

window.toggleDoblePrice = function () {
    const categorySlug = document.getElementById('prod-categoria')?.value;
    const category = getProductCategory(categorySlug);
    const configurable = category ? category.tipo_venta === 'configurable' : categorySlug === 'burgers';
    const wrap = document.getElementById('prod-doble-wrap');
    const input = document.getElementById('prod-precio-doble');
    if (wrap) wrap.style.display = configurable ? 'flex' : 'none';
    if (input) input.required = configurable;
};

async function uploadProductImage(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) throw new Error('La imagen debe ser JPG, PNG o WEBP');
    if (file.size > 5 * 1024 * 1024) throw new Error('La imagen no puede superar 5 MB');

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = `products/${fileName}`;

    const { error } = await client.storage.from('product-images').upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
    });

    if (error) throw error;

    const { data } = client.storage.from('product-images').getPublicUrl(filePath);
    return { publicUrl: data.publicUrl, filePath };
}

function getStoredProductImagePath(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    const marker = '/storage/v1/object/public/product-images/';
    const markerIndex = imageUrl.indexOf(marker);
    if (markerIndex === -1) return null;
    try {
        const path = decodeURIComponent(imageUrl.slice(markerIndex + marker.length).split('?')[0]);
        return path.startsWith('products/') ? path : null;
    } catch (_) {
        return null;
    }
}

async function removeStoredProductImage(imageUrl) {
    const path = getStoredProductImagePath(imageUrl);
    if (!path) return false;
    const { error } = await client.storage.from('product-images').remove([path]);
    if (error) throw error;
    return true;
}

window.handleProductSubmit = async function (event) {
    event.preventDefault();
    const editId = document.getElementById('prod-edit-id').value;
    const submitBtn = document.getElementById('product-submit-btn');
    const selectedCategory = getProductCategory(document.getElementById('prod-categoria').value);
    const nombre = document.getElementById('prod-nombre').value.trim();
    const precioSimple = Number(document.getElementById('prod-precio-simple').value);
    const precioDoble = Number(document.getElementById('prod-precio-doble').value || 0);
    const stock = Number(document.getElementById('prod-stock').value || 0);
    const orden = Number(document.getElementById('prod-orden').value || 0);

    if (!nombre || !selectedCategory) {
        showStatusToast('Completa el nombre y selecciona una categoria valida');
        return;
    }
    if (![precioSimple, precioDoble, stock, orden].every(Number.isFinite) ||
        precioSimple < 0 || precioDoble < 0 || !Number.isInteger(stock) || stock < 0 || !Number.isInteger(orden) || orden < 0) {
        showStatusToast('Precios, stock y orden deben ser numeros no negativos');
        return;
    }
    if (selectedCategory.tipo_venta === 'configurable' && !document.getElementById('prod-precio-doble').value) {
        showStatusToast('Completa el precio doble para esta categoria configurable');
        return;
    }

    const recipe = currentRecipe.map(item => ({
        ingrediente_id: item.ingrediente_id,
        nombre: item.nombre,
        cantidad: Number(item.cantidad),
        unidad: item.unidad,
        doble_mult: item.doble_mult === undefined || item.doble_mult === null || item.doble_mult === ''
            ? 1
            : Number(item.doble_mult)
    }));
    const invalidRecipeItem = recipe.find(item =>
        !allIngredientesForRecipe.some(ingredient => String(ingredient.id) === String(item.ingrediente_id)) ||
        !Number.isFinite(item.cantidad) || item.cantidad <= 0 ||
        !Number.isFinite(item.doble_mult) || item.doble_mult <= 0
    );
    if (invalidRecipeItem) {
        showStatusToast('La receta tiene ingredientes inexistentes o cantidades invalidas');
        return;
    }

    const payload = {
        nombre,
        categoria: selectedCategory.slug,
        precio_simple: precioSimple,
        precio_doble: selectedCategory.tipo_venta === 'configurable' ? precioDoble : 0,
        descripcion: document.getElementById('prod-descripcion').value.trim(),
        ingredientes: recipe.map(item => `${item.nombre} (${item.cantidad} ${item.unidad})`).join(', '),
        receta: { ingredientes: recipe },
        stock,
        orden,
        destacado: document.getElementById('prod-destacado').checked,
        activo: document.getElementById('prod-activo').checked
    };

    submitBtn.textContent = editId ? 'GUARDANDO...' : 'CREANDO...';
    submitBtn.disabled = true;
    let uploadedImage = null;
    let previousImageUrl = null;

    try {
        if (editId) {
            const { data: existingProduct, error: existingError } = await client
                .from('productos')
                .select('imagen_url')
                .eq('id', editId)
                .single();
            if (existingError) throw existingError;
            previousImageUrl = existingProduct?.imagen_url || null;
        }

        const file = document.getElementById('prod-imagen').files[0];
        if (file) {
            uploadedImage = await uploadProductImage(file);
            payload.imagen_url = uploadedImage.publicUrl;
        } else if (!editId) {
            payload.imagen_url = getProductImage(payload.nombre);
        }

        const { error } = editId
            ? await client.from('productos').update(payload).eq('id', editId)
            : await client.from('productos').insert(payload);
        if (error) throw error;

        let imageCleanupFailed = false;
        if (uploadedImage && previousImageUrl && previousImageUrl !== uploadedImage.publicUrl) {
            try {
                await removeStoredProductImage(previousImageUrl);
            } catch (cleanupError) {
                imageCleanupFailed = true;
                console.error('Previous product image cleanup error:', cleanupError);
            }
        }

        showStatusToast(imageCleanupFailed
            ? 'PRODUCTO GUARDADO; NO SE PUDO BORRAR LA IMAGEN ANTERIOR'
            : (editId ? 'PRODUCTO ACTUALIZADO' : 'PRODUCTO CREADO'));
        cancelProductEdit();
        await loadProductos();
    } catch (error) {
        if (uploadedImage) {
            try { await removeStoredProductImage(uploadedImage.publicUrl); }
            catch (cleanupError) { console.error('New product image rollback error:', cleanupError); }
        }
        console.error('Product save error:', error);
        showStatusToast('Error al guardar producto: ' + (error.message || ''));
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = document.getElementById('prod-edit-id').value ? 'GUARDAR CAMBIOS' : 'CREAR PRODUCTO';
    }
};

window.loadProductos = async function () {
    if (!client) return;
    try {
        if (!allProductCategories.length) await loadProductCategories();
        const [productsResult, ingredientsResult] = await Promise.all([
            client.from('productos').select('*'),
            client.from('insumos').select('*').order('nombre', { ascending: true })
        ]);
        if (productsResult.error) throw productsResult.error;
        if (ingredientsResult.error) throw ingredientsResult.error;

        allIngredientesForRecipe = ingredientsResult.data || [];
        const categoryOrder = new Map(allProductCategories.map(category => [category.slug, Number(category.orden) || 0]));
        const products = (productsResult.data || []).sort((a, b) =>
            (categoryOrder.get(a.categoria) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(b.categoria) ?? Number.MAX_SAFE_INTEGER) ||
            String(a.categoria || '').localeCompare(String(b.categoria || ''), 'es') ||
            (Number(a.orden) || 0) - (Number(b.orden) || 0) ||
            String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')
        );
        renderProductosTable(products);
    } catch (err) { console.error("Products load error:", err); }
};

function getRecipeAvailability(recipeItems, ingredientMap, useDoubleMultiplier = false) {
    if (!recipeItems.length) return { units: 0, missing: [] };
    let units = Number.POSITIVE_INFINITY;
    const missing = [];

    recipeItems.forEach(recipeItem => {
        const ingredient = ingredientMap.get(String(recipeItem.ingrediente_id));
        const baseQuantity = Number(recipeItem.cantidad);
        const storedDoubleMultiplier = recipeItem.doble_mult === undefined || recipeItem.doble_mult === null || recipeItem.doble_mult === ''
            ? 1
            : Number(recipeItem.doble_mult);
        const doubleMultiplier = useDoubleMultiplier ? storedDoubleMultiplier : 1;
        const requiredQuantity = baseQuantity * doubleMultiplier;
        if (!ingredient || !Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
            missing.push(recipeItem.nombre || recipeItem.ingrediente_id || 'Ingrediente desconocido');
            units = 0;
            return;
        }
        units = Math.min(units, Math.floor(Math.max(0, Number(ingredient.stock_actual) || 0) / requiredQuantity));
    });

    return { units: Number.isFinite(units) ? Math.max(0, units) : 0, missing };
}

function renderProductAvailability(product, category, ingredientMap) {
    const recipeItems = Array.isArray(product.receta?.ingredientes) ? product.receta.ingredientes : [];
    if (!recipeItems.length) {
        const directStock = Math.max(0, Math.floor(Number(product.stock) || 0));
        return directStock > 0
            ? `<strong>${directStock} u.</strong><br><small style="color:#888;">stock directo</small>`
            : '<strong style="color:var(--primary);">AGOTADO</strong><br><small style="color:#888;">stock directo</small>';
    }

    const simple = getRecipeAvailability(recipeItems, ingredientMap, false);
    if (simple.missing.length) {
        return `<strong style="color:var(--primary);">RECETA INCOMPLETA</strong><br><small title="${escapeAdminHtml(simple.missing.join(', '))}">${escapeAdminHtml(simple.missing.join(', '))}</small>`;
    }

    if (category?.tipo_venta === 'configurable') {
        const double = getRecipeAvailability(recipeItems, ingredientMap, true);
        const simpleLabel = simple.units > 0 ? simple.units : '<span style="color:var(--primary);">0</span>';
        const doubleLabel = double.units > 0 ? double.units : '<span style="color:var(--primary);">0</span>';
        return `<strong>Simple: ${simpleLabel}</strong><br><small>Doble: ${doubleLabel} / por receta</small>`;
    }

    return simple.units > 0
        ? `<strong>${simple.units} u.</strong><br><small style="color:#888;">por receta</small>`
        : '<strong style="color:var(--primary);">AGOTADO</strong><br><small style="color:#888;">por receta</small>';
}

function renderProductosTable(productos) {
    const tbody = document.getElementById('productos-table-body');
    if (!tbody) return;
    if (!productos.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#999;">Sin productos</td></tr>';
        return;
    }

    const ingredientMap = new Map(allIngredientesForRecipe.map(ingredient => [String(ingredient.id), ingredient]));
    tbody.innerHTML = productos.map(product => {
        const category = getProductCategory(product.categoria);
        const recipeItems = Array.isArray(product.receta?.ingredientes) ? product.receta.ingredientes : [];
        const recipeText = String(recipeItems.length
            ? recipeItems.map(item => item.nombre || 'Ingrediente eliminado').join(', ')
            : (product.ingredientes || ''));
        const categoryState = !category
            ? '<br><small style="color:var(--primary); font-weight:800;">CATEGORIA INEXISTENTE</small>'
            : (!category.activo ? '<br><small style="color:#b05d00; font-weight:800;">CATEGORIA INACTIVA</small>' : '');
        const statusBadge = product.activo
            ? '<span class="status-badge status-ok">ACTIVO</span>'
            : '<span class="status-badge status-inactive">INACTIVO</span>';
        const imageSource = safeAdminImageUrl(product.imagen_url || getProductImage(product.nombre));

        return `<tr>
            <td><img src="${escapeAdminHtml(imageSource)}" class="product-table-img" alt="${escapeAdminHtml(product.nombre)}"></td>
            <td>
                <strong style="font-family:'Archivo Black';">${escapeAdminHtml(product.nombre)}</strong>
                ${product.destacado ? ' &#11088;' : ''}
                ${recipeText ? `<br><small style="color:#888;">${escapeAdminHtml(recipeText.substring(0, 60))}${recipeText.length > 60 ? '...' : ''}</small>` : ''}
            </td>
            <td>${escapeAdminHtml(category?.nombre || product.categoria || 'SIN CATEGORIA')}${categoryState}</td>
            <td>$${(Number(product.precio_simple) || 0).toLocaleString('es-AR')}</td>
            <td>${Number(product.precio_doble) ? '$' + Number(product.precio_doble).toLocaleString('es-AR') : '&mdash;'}</td>
            <td>${Number(product.orden) || 0}</td>
            <td>${renderProductAvailability(product, category, ingredientMap)}</td>
            <td>${statusBadge}</td>
            <td style="white-space:nowrap;">
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="editProduct('${product.id}')">EDITAR</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="toggleProductActive('${product.id}', ${Boolean(product.activo)})">${product.activo ? 'DESACTIVAR' : 'ACTIVAR'}</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px; color:var(--primary);" onclick="deleteProduct('${product.id}')">ELIMINAR</button>
            </td>
        </tr>`;
    }).join('');
}

window.editProduct = async function (id) {
    if (!client) return;
    try {
        if (!allProductCategories.length) await loadProductCategories();
        const { data, error } = await client.from('productos').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('prod-edit-id').value = data.id;
        document.getElementById('prod-nombre').value = data.nombre || '';
        populateProductCategorySelect(data.categoria || '');
        document.getElementById('prod-precio-simple').value = data.precio_simple ?? '';
        document.getElementById('prod-precio-doble').value = data.precio_doble ?? '';
        document.getElementById('prod-descripcion').value = data.descripcion || '';
        currentRecipe = Array.isArray(data.receta?.ingredientes)
            ? data.receta.ingredientes.map(item => ({
                ...item,
                doble_mult: item.doble_mult === undefined || item.doble_mult === null || item.doble_mult === ''
                    ? 1
                    : Number(item.doble_mult)
            }))
            : [];
        renderRecipeList();
        document.getElementById('prod-stock').value = data.stock ?? 0;
        document.getElementById('prod-orden').value = data.orden ?? 0;
        document.getElementById('prod-destacado').checked = data.destacado || false;
        document.getElementById('prod-activo').checked = data.activo !== false;

        const preview = document.getElementById('prod-img-preview');
        if (data.imagen_url) {
            preview.src = data.imagen_url;
            preview.dataset.persistedUrl = data.imagen_url;
            preview.style.display = 'block';
        } else {
            delete preview.dataset.persistedUrl;
            preview.style.display = 'none';
        }
        document.getElementById('prod-imagen').value = '';
        const hint = document.getElementById('prod-img-hint');
        if (hint) hint.textContent = 'Seleccioná una nueva imagen para reemplazar la actual';

        toggleDoblePrice();
        document.getElementById('product-form-title').textContent = 'EDITAR PRODUCTO';
        document.getElementById('product-submit-btn').textContent = 'GUARDAR CAMBIOS';
        document.getElementById('product-cancel-btn').style.display = 'inline-block';

        document.getElementById('productos-section').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { console.error(err); showStatusToast('Error al cargar producto'); }
};

window.cancelProductEdit = function () {
    document.getElementById('product-form').reset();
    document.getElementById('prod-edit-id').value = '';
    currentRecipe = [];
    renderRecipeList();
    document.getElementById('prod-activo').checked = true;
    document.getElementById('prod-stock').value = 0;
    document.getElementById('prod-orden').value = 0;
    document.getElementById('recipe-ingredient-double-mult').value = 1;
    if (productPreviewObjectUrl) {
        URL.revokeObjectURL(productPreviewObjectUrl);
        productPreviewObjectUrl = null;
    }
    const preview = document.getElementById('prod-img-preview');
    preview.style.display = 'none';
    preview.removeAttribute('src');
    delete preview.dataset.persistedUrl;
    const hint = document.getElementById('prod-img-hint');
    if (hint) hint.textContent = 'Formatos: JPG, PNG, WEBP';
    document.getElementById('product-form-title').textContent = 'NUEVO PRODUCTO';
    document.getElementById('product-submit-btn').textContent = 'CREAR PRODUCTO';
    document.getElementById('product-cancel-btn').style.display = 'none';
    populateProductCategorySelect();
    toggleDoblePrice();
};

window.toggleProductActive = async function (id, currentActive) {
    try {
        const { error } = await client.from('productos').update({ activo: !currentActive }).eq('id', id);
        if (error) throw error;
        loadProductos();
        showStatusToast(currentActive ? 'PRODUCTO DESACTIVADO' : 'PRODUCTO ACTIVADO');
    } catch (err) { showStatusToast('Error al cambiar estado'); }
};

async function findOrderReferencingProduct(productId) {
    const containedResult = await client
        .from('pedidos')
        .select('id')
        .contains('items', [{ product_id: productId }])
        .limit(1);
    if (!containedResult.error) return containedResult.data?.[0] || null;

    // Fallback for projects where PostgREST cannot apply jsonb containment to this column.
    const { data, error } = await client.from('pedidos').select('id, items');
    if (error) throw error;
    return (data || []).find(order =>
        Array.isArray(order.items) && order.items.some(item => String(item.product_id) === String(productId))
    ) || null;
}

window.deleteProduct = async function (id) {
    try {
        const [{ data: product, error: productError }, orderReference] = await Promise.all([
            client.from('productos').select('id, nombre, imagen_url').eq('id', id).single(),
            findOrderReferencingProduct(id)
        ]);
        if (productError) throw productError;
        if (orderReference) {
            showStatusToast(`No se puede eliminar: aparece en el pedido ${orderReference.id}. Desactivalo.`);
            return;
        }
        if (!confirm(`Eliminar "${product.nombre}"? Esta accion no se puede deshacer.`)) return;

        const { error } = await client.from('productos').delete().eq('id', id);
        if (error) throw error;

        let imageCleanupFailed = false;
        try {
            await removeStoredProductImage(product.imagen_url);
        } catch (cleanupError) {
            imageCleanupFailed = true;
            console.error('Deleted product image cleanup error:', cleanupError);
        }

        await loadProductos();
        showStatusToast(imageCleanupFailed
            ? 'PRODUCTO ELIMINADO; NO SE PUDO BORRAR SU IMAGEN'
            : 'PRODUCTO ELIMINADO');
    } catch (error) {
        console.error('Product delete error:', error);
        showStatusToast('Error al verificar o eliminar el producto: ' + (error.message || ''));
    }
};

// ══════════════════════════════════
// GLOBAL NAVIGATION
// ══════════════════════════════════

window.showSection = function (e, sectionId) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    closeMobileMenu();

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });

    const target = document.getElementById(sectionId + '-section');
    if (target) { target.classList.add('active'); target.style.display = 'block'; }

    if (e && e.currentTarget) {
        e.currentTarget.classList.add('active');
    } else {
        document.querySelectorAll('.nav-link').forEach(l => {
            if (l.getAttribute('onclick') && l.getAttribute('onclick').includes(`'${sectionId}'`)) l.classList.add('active');
        });
    }

    if (sectionId === 'dashboard') loadDashboard();
    if (sectionId === 'stock') loadStockData();
    if (sectionId === 'orders') loadOrders();
    if (sectionId === 'marketing') loadMarketingData();
    if (sectionId === 'productos') refreshProductsModule();
    if (sectionId === 'configuracion') loadStoreHours();
    if (sectionId === 'crm') loadCRMData();

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.refreshAll = function () {
    loadDashboard();
    loadStockData();
    loadOrders();
    loadMarketingData();
    loadProductos();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

// ══════════════════════════════════
// ORDERS — KANBAN
// ══════════════════════════════════

function startOrdersAutoRefresh() {
    if (ordersAutoRefreshTimer) clearInterval(ordersAutoRefreshTimer);
    ordersAutoRefreshTimer = setInterval(() => {
        const sec = document.getElementById('orders-section');
        if (sec && sec.classList.contains('active')) loadOrders();
    }, 30000);
}

window.setOrdersFilter = function (e, filter) {
    ordersFilter = filter;
    document.getElementById('orders-custom-range').classList.remove('active');
    document.querySelectorAll('#orders-section .filter-btn').forEach(b => b.classList.remove('active'));
    if (e && e.target) {
        const btn = e.target.classList.contains('filter-btn') ? e.target : e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
    loadOrders();
};

window.toggleOrdersCustomRange = function () {
    document.getElementById('orders-custom-range').classList.toggle('active');
};

window.applyOrdersCustomFilter = function () {
    ordersFilter = 'custom';
    ordersCustomRange.from = document.getElementById('orders-date-from').value;
    ordersCustomRange.to = document.getElementById('orders-date-to').value;
    loadOrders();
};

window.manualRefreshOrders = function () {
    loadOrders();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

async function loadOrders() {
    if (!client) return;
    try {
        let query = client.from('pedidos').select('*, clientes(nombre, whatsapp, email)').order('created_at', { ascending: false });

        let startDate;
        if (ordersFilter === 'hoy') {
            startDate = new Date(new Date().setHours(0, 0, 0, 0));
        } else if (ordersFilter === 'semana') {
            startDate = new Date(); startDate.setDate(startDate.getDate() - 7);
        } else if (ordersFilter === 'quincena') {
            startDate = new Date(); startDate.setDate(startDate.getDate() - 15);
        } else if (ordersFilter === 'mes') {
            startDate = new Date(); startDate.setMonth(startDate.getMonth() - 1);
        } else if (ordersFilter === 'custom' && ordersCustomRange.from) {
            startDate = new Date(ordersCustomRange.from);
            if (ordersCustomRange.to) {
                const end = new Date(ordersCustomRange.to); end.setHours(23, 59, 59, 999);
                query = query.lte('created_at', end.toISOString());
            }
        }

        if (startDate) query = query.gte('created_at', startDate.toISOString());

        const [{ data: orders, error }] = await Promise.all([query, loadOrderBenefitCatalog()]);
        if (error) throw error;
        renderKanban(orders || []);
    } catch (err) { console.error("Orders Load Error:", err); }
}

function renderKanban(orders) {
    const nextLabel = { pendiente: 'CONFIRMAR PAGO', aprobado: 'EN PREPARACIÓN', preparacion: 'ENTREGADO ✓' };
    const prevLabel = { aprobado: '← Nuevo', preparacion: '← Pago OK', entregado: '← En prep.' };

    const grupos = {
        pendiente: orders.filter(o => !o.estado_pago || o.estado_pago === 'pendiente' || o.estado_pago === 'pendiente_efectivo' || o.estado_pago === 'pendiente_transferencia'),
        aprobado: orders.filter(o => o.estado_pago === 'aprobado'),
        preparacion: orders.filter(o => o.estado_pago === 'preparacion'),
        entregado: orders.filter(o => o.estado_pago === 'entregado')
    };

    for (const [estado, cards] of Object.entries(grupos)) {
        const container = document.getElementById(`cards-${estado}`);
        const countEl = document.getElementById(`count-${estado}`);
        const mTabCount = document.getElementById(`mtab-${estado}`);
        if (!container) continue;

        countEl.textContent = cards.length;
        if (mTabCount) mTabCount.textContent = cards.length;

        if (cards.length === 0) {
            container.innerHTML = '<div class="kanban-empty">Sin pedidos</div>';
            continue;
        }

        container.innerHTML = cards.map(o => {
            const nombre = o.clientes?.nombre || 'Cliente S/N';
            const tel = o.clientes?.whatsapp || '';
            const orderId = safeAdminId(o.id);
            const d = new Date(o.created_at);
            const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const items = (o.items || []).map(i => {
                const extrasStr = (i.extras && i.extras.length)
                    ? ` <small style="color:var(--primary); font-weight:700;">+ ${escapeAdminHtml(formatOrderExtras(i.extras))}</small>`
                    : '';
                const removedStr = formatOrderRemovedIngredients(i);
                const removedHtml = removedStr
                    ? `<small style="display:block; color:#B71C1C; font-weight:800;">SIN: ${escapeAdminHtml(removedStr)}</small>`
                    : '';
                return `<div>${Math.max(1, parseInt(i.qty) || 1)}x ${escapeAdminHtml(i.title)} <small style="color:#999;">(${escapeAdminHtml(i.type || '-')})</small>${extrasStr}${removedHtml}</div>`;
            }).join('');
            const entrega = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup'
                ? '🏠 Retiro'
                : `🛵 ${escapeAdminHtml(o.direccion_entrega || 'Delivery')}`;
            const horarioEntrega = escapeAdminHtml(formatScheduledDelivery(o.entrega_programada));
            const benefitText = orderBenefitText(o);
            const benefitBadge = benefitText
                ? `<div class="order-benefit-badge">${escapeAdminHtml(benefitText)} · -$${Number(o.monto_descuento || 0).toLocaleString('es-AR')}</div>`
                : '';

            const actionRow = orderId && estado !== 'entregado'
                ? `<div class="card-actions">
                    ${prevLabel[estado] ? `<button class="card-btn card-btn-back" onclick="retreatOrder('${orderId}','${estado}')">${prevLabel[estado]}</button>` : ''}
                    <button class="card-btn card-btn-advance" onclick="advanceOrder('${orderId}','${estado}')">${nextLabel[estado]} →</button>
                    <button class="card-btn card-btn-delete" title="Cancelar pedido" onclick="deleteKanbanOrder('${orderId}')"><i data-lucide="circle-x" style="width:12px;"></i></button>
                   </div>`
                : (orderId ? `<div class="card-actions">
                    <button class="card-btn card-btn-back" style="flex:1;" onclick="retreatOrder('${orderId}','${estado}')">${prevLabel[estado]}</button>
                   </div>` : '');

            return `<div class="kanban-card" ${orderId ? `onclick="openOrderDetail('${orderId}')"` : ''}>
                <div class="kanban-card-header">
                    <strong style="font-family:'Archivo Black'; font-size:0.88rem;">#${escapeAdminHtml(o.numero_pedido || '---')}</strong>
                    <small style="color:#888; white-space:nowrap;">${hora}</small>
                </div>
                <div style="font-size:0.83rem; font-weight:700;">${escapeAdminHtml(nombre)}</div>
                ${tel ? `<div style="font-size:0.75rem; color:#888;">${escapeAdminHtml(tel)}</div>` : ''}
                <div style="font-size:0.75rem; color:#666; margin-top:2px;">${entrega}</div>
                <div style="display:inline-block; margin-top:5px; padding:3px 6px; background:#FFF3CD; border:1px solid #111; font-family:'Archivo Black'; font-size:0.68rem;">⏰ ${horarioEntrega}</div>
                <div class="kanban-items">${items}</div>
                ${benefitBadge}
                <div class="kanban-total">$${Number(o.total || 0).toLocaleString('es-AR')}</div>
                <div onclick="event.stopPropagation()">${actionRow}</div>
            </div>`;
        }).join('');
    }

    // ── CALCULAR Y MOSTRAR MÉTRICAS ──
    updatePedidosMetrics(orders);

    // Guardar para acceso rápido del modal
    _lastKanbanOrders = orders;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── ORDER DETAIL MODAL ──
let _lastKanbanOrders = [];
let _currentModalOrder = null;

window.openOrderDetail = function (orderId) {
    const o = _lastKanbanOrders.find(x => x.id === orderId);
    if (!o) return;
    _currentModalOrder = o;

    const estadoLabels = {
        pendiente: { label: 'NUEVO', color: '#BF360C' },
        pendiente_efectivo: { label: 'NUEVO (EFECTIVO)', color: '#BF360C' },
        pendiente_transferencia: { label: 'NUEVO (TRANSF.)', color: '#BF360C' },
        aprobado: { label: 'PAGO OK', color: '#1B5E20' },
        preparacion: { label: 'EN PREPARACIÓN', color: '#0D47A1' },
        entregado: { label: 'ENTREGADO ✓', color: '#212121' }
    };
    const pagoLabels = {
        pendiente: 'Pendiente de confirmación',
        pendiente_efectivo: 'Efectivo — pendiente',
        pendiente_transferencia: 'Transferencia — pendiente',
        aprobado: 'Pago confirmado',
        preparacion: 'Pago confirmado',
        entregado: 'Pago confirmado'
    };

    const est = estadoLabels[o.estado_pago] || { label: o.estado_pago || 'NUEVO', color: '#111' };
    const d = new Date(o.created_at);
    const fecha = d.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' — ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');

    document.getElementById('od-numero').textContent = `#${o.numero_pedido || '---'}`;
    document.getElementById('od-fecha').textContent = fecha;

    const estadoEl = document.getElementById('od-estado');
    estadoEl.textContent = est.label;
    estadoEl.style.background = est.color;
    estadoEl.style.color = 'white';
    estadoEl.style.borderColor = 'rgba(255,255,255,0.4)';

    // Cliente
    const nombre = o.clientes?.nombre || 'Cliente S/N';
    const tel = o.clientes?.whatsapp || '';
    const email = o.clientes?.email || '';
    document.getElementById('od-cliente').textContent = nombre;
    document.getElementById('od-contacto').textContent = [tel, email].filter(Boolean).join('  ·  ') || '—';

    // Entrega
    const esRetiro = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup';
    document.getElementById('od-entrega').textContent = esRetiro ? '🏠 Retiro en local' : '🛵 Delivery';
    document.getElementById('od-direccion').textContent = esRetiro ? '' : (o.direccion_entrega || 'Sin dirección');
    document.getElementById('od-timbre').textContent = !esRetiro && o.timbre ? `Timbre/Depto: ${o.timbre}` : '';
    document.getElementById('od-horario').textContent = `⏰ ${formatScheduledDelivery(o.entrega_programada)}`;

    // Nota
    const notaWrap = document.getElementById('od-nota-wrap');
    if (o.nota) {
        notaWrap.style.display = 'block';
        document.getElementById('od-nota').textContent = o.nota;
    } else {
        notaWrap.style.display = 'none';
    }

    // Items
    const itemsHtml = (o.items || []).map(i => {
        const extrasCost = ((i.extras || []).length > 0) ? ` <span style="font-size:0.75rem; color:#999;">(+extras)</span>` : '';
        return `<div class="order-item-row">
            <div class="order-item-qty">${Math.max(1, parseInt(i.qty) || 1)}×</div>
            <div class="order-item-info">
                <div class="order-item-name">${escapeAdminHtml(i.title)}${extrasCost}</div>
                ${i.type ? `<div class="order-item-type">${escapeAdminHtml(i.type)}</div>` : ''}
                ${(i.extras && i.extras.length) ? `<div class="order-item-extras">+ ${escapeAdminHtml(formatOrderExtras(i.extras, ' · '))}</div>` : ''}
                ${formatOrderRemovedIngredients(i) ? `<div class="order-item-removed">SIN: ${escapeAdminHtml(formatOrderRemovedIngredients(i, ' · '))}</div>` : ''}
            </div>
            <div class="order-item-price">$${(Number(i.pricePerUnit || 0) * (parseInt(i.qty) || 1)).toLocaleString('es-AR')}</div>
        </div>`;
    }).join('');
    document.getElementById('od-items').innerHTML = itemsHtml || '<div style="color:#999;">Sin items</div>';

    // Pago
    document.getElementById('od-pago').textContent = pagoLabels[o.estado_pago] || '—';

    const benefit = getOrderBenefit(o);
    const benefitWrap = document.getElementById('od-benefit-wrap');
    if (benefitWrap) {
        benefitWrap.style.display = benefit ? 'block' : 'none';
        if (benefit) {
            document.getElementById('od-benefit-name').textContent = `${benefit.typeLabel}: ${benefit.label}`;
            document.getElementById('od-benefit-amount').textContent = `Descuento aplicado: -$${benefit.amount.toLocaleString('es-AR')}`;
        }
    }

    // Total
    document.getElementById('od-total').textContent = `$${(o.total || 0).toLocaleString()}`;

    // Botones de acción (duplicados del kanban pero dentro del modal)
    const nextLabel = { pendiente: 'CONFIRMAR PAGO', pendiente_efectivo: 'CONFIRMAR PAGO', pendiente_transferencia: 'CONFIRMAR PAGO', aprobado: 'EN PREPARACIÓN', preparacion: 'ENTREGADO ✓' };
    const prevLabel = { aprobado: '← Nuevo', preparacion: '← Pago OK', entregado: '← En prep.' };
    const estado = o.estado_pago || 'pendiente';
    const safeOrderId = safeAdminId(o.id);
    let actionsHtml = '';
    if (safeOrderId && prevLabel[estado]) {
        actionsHtml += `<button class="card-btn card-btn-back" style="flex:1;" onclick="retreatOrder('${safeOrderId}','${estado}'); closeOrderDetailModal();">${prevLabel[estado]}</button>`;
    }
    if (safeOrderId && nextLabel[estado]) {
        actionsHtml += `<button class="card-btn card-btn-advance" style="flex:2;" onclick="advanceOrder('${safeOrderId}','${estado}'); closeOrderDetailModal();">${nextLabel[estado]} →</button>`;
    }
    document.getElementById('od-actions').innerHTML = actionsHtml;

    document.getElementById('order-detail-modal').style.display = 'block';
    document.body.style.overflow = 'hidden';
};

window.closeOrderDetailModal = function (e) {
    if (e && e.target !== document.getElementById('order-detail-modal')) return;
    document.getElementById('order-detail-modal').style.display = 'none';
    document.body.style.overflow = '';
};

// ── MÉTRICAS DE PEDIDOS ──
let _lastOrdersForReport = [];

function updatePedidosMetrics(orders) {
    _lastOrdersForReport = orders;

    const totalPedidos = orders.length;
    const entregados = orders.filter(o => o.estado_pago === 'entregado').length;
    const enProceso = orders.filter(o => o.estado_pago === 'aprobado' || o.estado_pago === 'preparacion').length;

    // Contar burgers (solo categoría burgers, no nuggets/papas)
    let totalBurgers = 0;
    let detalleItems = Object.create(null);
    orders.forEach(o => {
        (o.items || []).forEach(i => {
            const title = i.title || '';
            const qty = parseInt(i.qty) || 1;
            // Contar burgers: excluir Nuggets y Papas
            const isBurger = !title.toLowerCase().includes('nuggets') && !title.toLowerCase().includes('papas');
            if (isBurger) totalBurgers += qty;
            // Detalle para resumen
            detalleItems[title] = (detalleItems[title] || 0) + qty;
        });
    });

    // Facturación: solo pedidos confirmados (aprobado, preparacion, entregado)
    const confirmados = orders.filter(o => ['aprobado', 'preparacion', 'entregado'].includes(o.estado_pago));
    const facturado = confirmados.reduce((sum, o) => sum + (o.total || 0), 0);
    const ticket = confirmados.length > 0 ? Math.round(facturado / confirmados.length) : 0;
    const benefitSummary = summarizeOrderBenefits(orders);

    // Actualizar DOM
    const el = id => document.getElementById(id);
    el('pm-pedidos').textContent = totalPedidos;
    el('pm-pedidos-sub').textContent = `${entregados} entregados · ${enProceso} en proceso`;

    el('pm-burgers').textContent = totalBurgers;
    // Top 2 burgers más vendidas (excluir nuggets/papas del sub)
    const burgerItems = Object.entries(detalleItems)
        .filter(([k]) => !k.toLowerCase().includes('nuggets') && !k.toLowerCase().includes('papas'))
        .sort((a, b) => b[1] - a[1]).slice(0, 2);
    el('pm-burgers-sub').textContent = burgerItems.map(([k, v]) => `${v}x ${k}`).join(' · ') || '—';

    el('pm-facturado').textContent = `$${facturado.toLocaleString()}`;
    el('pm-facturado-sub').textContent = `${confirmados.length} pedidos confirmados`;

    el('pm-ticket').textContent = `$${ticket.toLocaleString()}`;
    el('pm-ticket-sub').textContent = confirmados.length > 0 ? `sobre ${confirmados.length} pedidos` : '—';

    el('pm-benefits').textContent = benefitSummary.orders;
    el('pm-benefits-sub').textContent = benefitMetricsText(benefitSummary);
}

// ── WHATSAPP SHARE ──
window.shareOrdersWhatsApp = function () {
    const orders = _lastOrdersForReport;
    if (!orders.length) { showStatusToast('No hay pedidos para compartir'); return; }

    const confirmados = orders.filter(o => ['aprobado', 'preparacion', 'entregado'].includes(o.estado_pago));
    const facturado = confirmados.reduce((sum, o) => sum + (o.total || 0), 0);
    const ticket = confirmados.length > 0 ? Math.round(facturado / confirmados.length) : 0;
    const benefitSummary = summarizeOrderBenefits(orders);

    let totalBurgers = 0;
    let detalleItems = Object.create(null);
    orders.forEach(o => {
        (o.items || []).forEach(i => {
            const qty = parseInt(i.qty) || 1;
            const title = i.title || '';
            if (!title.toLowerCase().includes('nuggets') && !title.toLowerCase().includes('papas')) totalBurgers += qty;
            detalleItems[title] = (detalleItems[title] || 0) + qty;
        });
    });

    const filterLabel = { hoy: 'Hoy', semana: 'Última semana', quincena: 'Última quincena', mes: 'Último mes', custom: 'Rango personalizado' };
    const periodo = filterLabel[ordersFilter] || ordersFilter;

    let msg = `🍔 *RIOH. — Reporte de Pedidos*\n`;
    msg += `📅 Período: ${periodo}\n\n`;
    msg += `📊 *MÉTRICAS*\n`;
    msg += `• Pedidos totales: *${orders.length}*\n`;
    msg += `• Burgers vendidas: *${totalBurgers}*\n`;
    msg += `• Facturado: *$${facturado.toLocaleString()}*\n`;
    msg += `• Ticket promedio: *$${ticket.toLocaleString()}*\n`;
    msg += `• Beneficios: *${benefitSummary.orders}* (${benefitMetricsText(benefitSummary)})\n\n`;

    msg += `📋 *DETALLE DE ITEMS*\n`;
    Object.entries(detalleItems).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        msg += `• ${v}x ${k}\n`;
    });

    msg += `\n📦 *ESTADOS*\n`;
    const pendientes = orders.filter(o => !o.estado_pago || o.estado_pago.startsWith('pendiente')).length;
    const aprobados = orders.filter(o => o.estado_pago === 'aprobado').length;
    const preparacion = orders.filter(o => o.estado_pago === 'preparacion').length;
    const entregados = orders.filter(o => o.estado_pago === 'entregado').length;
    msg += `• Nuevos: ${pendientes}\n`;
    msg += `• Pago OK: ${aprobados}\n`;
    msg += `• En prep: ${preparacion}\n`;
    msg += `• Entregados: ${entregados}\n`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
};

// ── PDF DOWNLOAD ──
window.downloadOrdersPDF = function () {
    const orders = _lastOrdersForReport;
    if (!orders.length) { showStatusToast('No hay pedidos para exportar'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    // ── Colores RIOH
    const RED = [227, 28, 37];       // #E31C25
    const DARK = [17, 17, 17];       // #111
    const GRAY = [100, 100, 100];
    const LIGHTGRAY = [244, 244, 244];

    // ── Header con fondo negro
    doc.setFillColor(...DARK);
    doc.rect(0, 0, pageW, 38, 'F');

    // Línea roja decorativa
    doc.setFillColor(...RED);
    doc.rect(0, 38, pageW, 3, 'F');

    // Logo RIOH.
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(28);
    doc.setTextColor(255, 255, 255);
    doc.text('RIOH.', 15, 22);

    // Subtítulo
    doc.setFontSize(10);
    doc.setTextColor(180, 180, 180);
    doc.text('REPORTE DE PEDIDOS', 15, 31);

    // Fecha
    const filterLabel = { hoy: 'Hoy', semana: 'Última semana', quincena: 'Última quincena', mes: 'Último mes', custom: 'Rango personalizado' };
    const periodo = filterLabel[ordersFilter] || ordersFilter;
    const ahora = new Date();
    const fechaStr = `${ahora.toLocaleDateString('es-AR')} — ${periodo}`;
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(fechaStr, pageW - 15, 31, { align: 'right' });

    // ── Métricas calculadas
    const confirmados = orders.filter(o => ['aprobado', 'preparacion', 'entregado'].includes(o.estado_pago));
    const facturado = confirmados.reduce((sum, o) => sum + (o.total || 0), 0);
    const ticket = confirmados.length > 0 ? Math.round(facturado / confirmados.length) : 0;
    let totalBurgers = 0;
    let detalleItems = Object.create(null);
    orders.forEach(o => {
        (o.items || []).forEach(i => {
            const qty = parseInt(i.qty) || 1;
            const title = i.title || '';
            if (!title.toLowerCase().includes('nuggets') && !title.toLowerCase().includes('papas')) totalBurgers += qty;
            detalleItems[title] = (detalleItems[title] || 0) + qty;
        });
    });

    // ── Cards de métricas
    let y = 50;
    const cardW = (pageW - 30 - 15) / 4;  // 4 cards con gaps
    const metrics = [
        { label: 'PEDIDOS', value: String(orders.length), sub: `${confirmados.length} confirmados` },
        { label: 'BURGERS VENDIDAS', value: String(totalBurgers), sub: 'unidades' },
        { label: 'FACTURADO', value: `$${facturado.toLocaleString()}`, sub: `${confirmados.length} pedidos` },
        { label: 'TICKET PROMEDIO', value: `$${ticket.toLocaleString()}`, sub: `sobre ${confirmados.length}` }
    ];

    metrics.forEach((m, idx) => {
        const x = 15 + idx * (cardW + 5);
        // Card background
        doc.setFillColor(...LIGHTGRAY);
        doc.roundedRect(x, y, cardW, 28, 2, 2, 'F');
        // Border top roja
        doc.setFillColor(...RED);
        doc.rect(x, y, cardW, 2, 'F');
        // Label
        doc.setFontSize(6.5);
        doc.setTextColor(...GRAY);
        doc.setFont('helvetica', 'normal');
        doc.text(m.label, x + 4, y + 9);
        // Value
        doc.setFontSize(14);
        doc.setTextColor(...DARK);
        doc.setFont('helvetica', 'bold');
        doc.text(m.value, x + 4, y + 19);
        // Sub
        doc.setFontSize(6);
        doc.setTextColor(...GRAY);
        doc.setFont('helvetica', 'normal');
        doc.text(m.sub, x + 4, y + 25);
    });

    y += 38;

    // ── Detalle de items vendidos
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'bold');
    doc.text('ITEMS VENDIDOS', 15, y);
    y += 6;

    const itemRows = Object.entries(detalleItems).sort((a, b) => b[1] - a[1]);
    doc.autoTable({
        startY: y,
        head: [['Producto', 'Cantidad']],
        body: itemRows.map(([k, v]) => [k, `${v} uds.`]),
        margin: { left: 15, right: 15 },
        styles: { fontSize: 8, cellPadding: 3, lineColor: DARK, lineWidth: 0.3 },
        headStyles: { fillColor: DARK, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        columnStyles: { 1: { halign: 'center', cellWidth: 30 } }
    });

    y = doc.lastAutoTable.finalY + 10;

    // ── Tabla de pedidos
    if (y > pageH - 60) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setTextColor(...DARK);
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLE DE PEDIDOS', 15, y);
    y += 6;

    const estadoLabel = { pendiente: 'Nuevo', pendiente_efectivo: 'Nuevo (Efect.)', pendiente_transferencia: 'Nuevo (Transf.)', aprobado: 'Pago OK', preparacion: 'En prep.', entregado: 'Entregado' };
    const pedidoRows = orders.map(o => {
        const d = new Date(o.created_at);
        const fecha = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const nombre = o.clientes?.nombre || 'S/N';
        const itemsStr = (o.items || []).map(i => {
            let s = `${i.qty}x ${i.title}`;
            if (i.type) s += ` (${i.type})`;
            if (i.extras && i.extras.length) s += ` +${formatOrderExtras(i.extras)}`;
            return s;
        }).join(' | ');
        const estado = estadoLabel[o.estado_pago] || o.estado_pago || 'Nuevo';
        return [`#${o.numero_pedido || '—'}`, fecha, nombre, itemsStr, estado, `$${(o.total || 0).toLocaleString()}`];
    });

    doc.autoTable({
        startY: y,
        head: [['#', 'Fecha', 'Cliente', 'Items', 'Estado', 'Total']],
        body: pedidoRows,
        margin: { left: 15, right: 15 },
        styles: { fontSize: 7, cellPadding: 2.5, lineColor: DARK, lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: RED, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [252, 252, 252] },
        columnStyles: {
            0: { cellWidth: 14, fontStyle: 'bold' },
            1: { cellWidth: 22 },
            2: { cellWidth: 22 },
            3: { cellWidth: 'auto' },
            4: { cellWidth: 22, halign: 'center' },
            5: { cellWidth: 22, halign: 'right', fontStyle: 'bold' }
        }
    });

    // ── Footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        // Línea roja
        doc.setFillColor(...RED);
        doc.rect(0, pageH - 12, pageW, 1, 'F');
        // Footer text
        doc.setFontSize(7);
        doc.setTextColor(...GRAY);
        doc.setFont('helvetica', 'normal');
        doc.text(`RIOH. — Reporte generado el ${ahora.toLocaleDateString('es-AR')} a las ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`, 15, pageH - 6);
        doc.text(`Página ${p} de ${totalPages}`, pageW - 15, pageH - 6, { align: 'right' });
    }

    // ── Save
    const fileName = `RIOH_Pedidos_${ahora.toISOString().slice(0, 10)}.pdf`;
    doc.save(fileName);
    showStatusToast(`PDF descargado: ${fileName}`);
};

// ── MOBILE KANBAN TABS ──
window.showKanbanTab = function (estado, btn) {
    document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('mob-active'));
    document.getElementById(`kcol-${estado}`)?.classList.add('mob-active');
    document.querySelectorAll('.kmt-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = '#eee';
        b.style.color = '#333';
    });
    btn.classList.add('active');
    const colors = { pendiente: '#BF360C', aprobado: '#1B5E20', preparacion: '#0D47A1', entregado: '#212121' };
    btn.style.background = colors[estado] || '#111';
    btn.style.color = 'white';
};

window.advanceOrder = async function (id, _uiState) {
    try {
        const { data, error } = await client.rpc('avanzar_pedido_seguro', { p_pedido_id: id });
        if (error) throw error;

        const previousState = data?.estado_anterior;
        const nextState = data?.estado;
        const deductedNow = Boolean(data?.stock_descontado_ahora);
        await loadOrders();
        if (deductedNow && document.getElementById('stock-section')?.classList.contains('active')) {
            await loadStockData();
        }
        showStatusToast(deductedNow
            ? 'PAGO CONFIRMADO — STOCK DESCONTADO'
            : `Pedido movido a ${String(nextState || '').toUpperCase()}`);

        if (nextState === 'aprobado') {
            const metodoPago = {
                pendiente: 'Efectivo',
                pendiente_efectivo: 'Efectivo',
                pendiente_transferencia: 'Transferencia bancaria'
            }[previousState] || 'Efectivo';
            client.from('pedidos')
                .select('*, clientes(nombre, whatsapp, email)')
                .eq('id', id).single()
                .then(({ data: fullOrder }) => { if (fullOrder) printTicket(fullOrder, metodoPago); });
        }
    } catch (err) {
        console.error("Error advancing order:", err);
        showStatusToast(err.message || 'Error al actualizar pedido');
    }
};

window.retreatOrder = async function (id, _uiState) {
    try {
        const { data, error } = await client.rpc('retroceder_pedido_seguro', { p_pedido_id: id });
        if (error) throw error;
        await loadOrders();
        if (data?.stock_reintegrado && document.getElementById('stock-section')?.classList.contains('active')) {
            await loadStockData();
        }
        showStatusToast(data?.stock_reintegrado
            ? `PEDIDO RETROCEDIDO — STOCK REINTEGRADO`
            : `Pedido retrocedido a ${String(data?.estado || '').toUpperCase()}`);
    } catch (err) {
        console.error('Error retreating order:', err);
        showStatusToast(err.message || 'Error al actualizar pedido');
    }
};

window.deleteKanbanOrder = async function (id) {
    if (!confirm('¿Cancelar este pedido? Se conservará el registro y, si corresponde, se reintegrará el stock.')) return;
    const motivo = prompt('Motivo de la cancelación:', 'Cancelado desde el panel');
    if (motivo === null) return;
    try {
        const { data, error } = await client.rpc('cancelar_pedido_seguro', {
            p_pedido_id: id,
            p_motivo: motivo.trim() || 'Cancelado desde el panel'
        });
        if (error) throw error;
        await loadOrders();
        if (data?.stock_reintegrado && document.getElementById('stock-section')?.classList.contains('active')) {
            await loadStockData();
        }
        showStatusToast(data?.stock_reintegrado
            ? 'PEDIDO CANCELADO — STOCK REINTEGRADO'
            : 'PEDIDO CANCELADO');
    } catch (err) {
        console.error('Error cancelling order:', err);
        showStatusToast(err.message || 'Error al cancelar pedido');
    }
};

// ══════════════════════════════════
// DASHBOARD
// ══════════════════════════════════

window.setFilter = function (e, filter) {
    if (e) e.preventDefault();
    currentFilter = filter;
    document.getElementById('custom-range-row').classList.remove('active');
    document.querySelectorAll('#dashboard-section .filter-btn').forEach(b => b.classList.remove('active'));
    if (e && e.target) {
        const btn = e.target.classList.contains('filter-btn') ? e.target : e.target.closest('.filter-btn');
        if (btn) btn.classList.add('active');
    }
    loadDashboard();
};

window.toggleCustomRange = function () {
    document.getElementById('custom-range-row').classList.toggle('active');
};

window.applyCustomFilter = function () {
    currentFilter = 'custom';
    customDateRange.from = document.getElementById('date-from').value;
    customDateRange.to = document.getElementById('date-to').value;
    loadDashboard();
};

async function loadDashboard() {
    if (!client) return;
    try {
        // Precargar productos para obtener imágenes del ranking
        const { data: productosData } = await client.from('productos').select('id, nombre, imagen_url');
        const productoImgMap = new Map();
        (productosData || []).forEach(p => {
            productoImgMap.set(String(p.nombre || ''), safeAdminImageUrl(p.imagen_url || getProductImage(p.nombre)));
        });

        // Query pedidos WITH client data, filtered by date
        let query = client.from('pedidos').select('*, clientes(id, user_id, nombre, whatsapp, email)').order('created_at', { ascending: false });
        let startDate, labelSuffix = 'Hoy';

        if (currentFilter === 'hoy') {
            startDate = new Date(new Date().setHours(0, 0, 0, 0));
        } else if (currentFilter === 'semana') {
            startDate = new Date(); startDate.setDate(startDate.getDate() - 7); labelSuffix = 'Semana';
        } else if (currentFilter === 'mes') {
            startDate = new Date(); startDate.setMonth(startDate.getMonth() - 1); labelSuffix = 'Mes';
        } else if (currentFilter === 'trimestre') {
            startDate = new Date(); startDate.setMonth(startDate.getMonth() - 3); labelSuffix = 'Trimestre';
        } else if (currentFilter === 'semestre') {
            startDate = new Date(); startDate.setMonth(startDate.getMonth() - 6); labelSuffix = 'Semestre';
        } else if (currentFilter === 'custom' && customDateRange.from) {
            startDate = new Date(customDateRange.from); labelSuffix = 'Rango';
            if (customDateRange.to) {
                const end = new Date(customDateRange.to); end.setHours(23, 59, 59, 999);
                query = query.lte('created_at', end.toISOString());
            }
        }

        if (startDate) query = query.gte('created_at', startDate.toISOString());

        const [{ data: pedidos, error }] = await Promise.all([query, loadOrderBenefitCatalog()]);
        if (error) throw error;

        // ── MÉTRICAS: calcular todo desde los pedidos reales ──
        const pedidosVigentes = pedidos.filter(p => p.estado_pago !== 'cancelado');
        const totalPedidos = pedidosVigentes.length;
        const entregados = pedidosVigentes.filter(p => p.estado_pago === 'entregado').length;
        const confirmados = pedidosVigentes.filter(p => ['aprobado', 'preparacion', 'entregado'].includes(p.estado_pago));

        const totalSales = confirmados.reduce((acc, p) => acc + (p.total || 0), 0);
        const avgTicket = confirmados.length > 0 ? Math.round(totalSales / confirmados.length) : 0;
        const benefitSummary = summarizeOrderBenefits(pedidosVigentes);

        // Contar burgers y items
        let totalBurgers = 0;
        const itemCounts = new Map();
        confirmados.forEach(p => {
            (p.items || []).forEach(i => {
                const title = i.title || '';
                const qty = parseInt(i.qty) || 1;
                const isBurger = !title.toLowerCase().includes('nuggets') && !title.toLowerCase().includes('papas');
                if (isBurger) totalBurgers += qty;
                itemCounts.set(title, (itemCounts.get(title) || 0) + qty);
            });
        });

        // Top 2 burgers para subtítulo
        const topBurgers = [...itemCounts.entries()]
            .filter(([k]) => !k.toLowerCase().includes('nuggets') && !k.toLowerCase().includes('papas'))
            .sort((a, b) => b[1] - a[1]).slice(0, 2);

        // ── Actualizar DOM de métricas ──
        document.getElementById('stats-orders-count').innerText = totalPedidos;
        document.getElementById('stats-orders-sub').innerText = `${entregados} entregados · ${labelSuffix}`;

        document.getElementById('stats-burgers-count').innerText = totalBurgers;
        document.getElementById('stats-burgers-sub').innerText = topBurgers.map(([k, v]) => `${v}x ${k}`).join(' · ') || '—';

        document.getElementById('stats-total-sales').innerText = `$${totalSales.toLocaleString()}`;
        document.getElementById('stats-sales-sub').innerText = `${confirmados.length} confirmados · ${labelSuffix}`;

        document.getElementById('stats-avg-ticket').innerText = `$${avgTicket.toLocaleString()}`;
        document.getElementById('stats-ticket-sub').innerText = confirmados.length > 0 ? `sobre ${confirmados.length} confirmados` : '—';

        document.getElementById('stats-benefits-count').innerText = benefitSummary.orders;
        document.getElementById('stats-benefits-sub').innerText = `${benefitMetricsText(benefitSummary)} · ${labelSuffix}`;

        // ── Ranking Burgers con imágenes ──
        const sorted = [...itemCounts.entries()].sort((a, b) => b[1] - a[1]);
        document.getElementById('best-sellers-list').innerHTML = sorted.map(([name, qty], i) => {
            const img = productoImgMap.get(name) || safeAdminImageUrl(getProductImage(name));
            const highlight = i === 0 ? 'background:#FFF9C4; border:1px solid #FBC02D;' : '';
            return `<div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid #eee; ${highlight}">
                <img src="${escapeAdminHtml(img)}" alt="${escapeAdminHtml(name)}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid #111; flex-shrink:0;">
                <span style="flex:1;">${i + 1}. ${escapeAdminHtml(name)}</span>
                <span style="font-weight:900; font-family:'Archivo Black'; white-space:nowrap;">${qty} U.</span>
            </div>`;
        }).join('') || '<div style="color:#999; padding:20px;">SIN DATOS</div>';

        // ── Últimas Ventas ──
        document.getElementById('recent-sales-log').innerHTML = pedidosVigentes.slice(0, 10).map(p => {
            const itemsStr = (p.items || []).map(i => {
                let s = `${i.qty}x ${i.title}`;
                if (i.extras && i.extras.length) s += ` +${formatOrderExtras(i.extras)}`;
                return s;
            }).join(', ');
            const benefitText = orderBenefitText(p);
            return `<div style="border-bottom: 1px dashed #eee; padding: 10px 0;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>#${escapeAdminHtml(p.numero_pedido || 'S/N')}</strong>
                    <span style="font-weight:900;">$${Number(p.total || 0).toLocaleString('es-AR')}</span>
                </div>
                <div style="font-size:0.75rem; color:#555; margin-top:2px;">${escapeAdminHtml(itemsStr)}</div>
                ${benefitText ? `<div class="recent-benefit-label">${escapeAdminHtml(benefitText)} · -$${Number(p.monto_descuento || 0).toLocaleString('es-AR')}</div>` : ''}
                <small style="color:#888;">${escapeAdminHtml(new Date(p.created_at).toLocaleString('es-AR'))} · ${escapeAdminHtml(p.clientes?.nombre || 'S/N')}</small>
            </div>`;
        }).join('') || '<div style="color:#999; padding:20px;">SIN VENTAS</div>';

        // ── Ranking de Clientes: computado desde los pedidos filtrados ──
        renderCustomerRanking(pedidos);

    } catch (err) { console.error("Dashboard Load Error:", err); }
}

function renderCustomerRanking(pedidos) {
    // Agrupar pedidos por cliente, usando cliente_id o user_id
    const clientMap = new Map();

    pedidos.forEach(p => {
        const clienteData = p.clientes;
        const key = clienteData?.id || p.user_id || p.cliente_id || null;
        if (!key) return;

        if (!clientMap.has(key)) {
            clientMap.set(key, {
                id: clienteData?.id || key,
                user_id: clienteData?.user_id || p.user_id || '',
                nombre: clienteData?.nombre || 'S/N',
                whatsapp: clienteData?.whatsapp || '',
                email: clienteData?.email || '',
                pedidos: 0,
                burgers: 0,
                total: 0
            });
        }

        const clientEntry = clientMap.get(key);
        clientEntry.pedidos++;
        clientEntry.total += (p.total || 0);

        (p.items || []).forEach(i => {
            const t = (i.type || '').toLowerCase();
            if (t === 'simple' || t === 'doble') {
                clientEntry.burgers += (parseInt(i.qty) || 1);
            }
        });
    });

    // Ordenar por total gastado descendente
    const ranked = [...clientMap.values()].sort((a, b) => b.total - a.total);

    const tbody = document.getElementById('customer-ranking-body');
    if (!tbody) return;

    tbody.innerHTML = ranked.map((c, i) => {
        const ticket = c.pedidos > 0 ? Math.round(c.total / c.pedidos) : 0;
        const top = i === 0 ? 'background:#FFF9C4;' : '';
        const cid = safeAdminId(c.id);
        return `<tr style="${top}">
            <td style="font-family:'Archivo Black';">${i + 1}</td>
            <td style="font-weight:700;">${escapeAdminHtml(c.nombre)}</td>
            <td>${c.pedidos}</td>
            <td style="font-weight:900;">${c.burgers}</td>
            <td style="font-weight:900;">$${c.total.toLocaleString()}</td>
            <td>$${ticket.toLocaleString()}</td>
            <td>${cid ? `<button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="openCustomerProfileById('${cid}')">VER</button>` : ''}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">Sin datos de clientes</td></tr>';
}

// ── CUSTOMER PROFILE MODAL ──
window.openCustomerProfileById = function (clientId) {
    const client = allCRMClients.find(item => String(item.id) === String(clientId));
    if (client) return openCustomerProfile(client.id, client.nombre, client.whatsapp, client.email);
    return openCustomerProfile(clientId, 'Cliente', '', '');
};

window.openCustomerProfile = async function (userId, nombre, whatsapp, email) {
    document.getElementById('customer-modal').style.display = 'block';
    document.getElementById('profile-name').textContent = nombre || 'Cliente';
    document.getElementById('profile-info').textContent =
        [whatsapp ? `📱 ${whatsapp}` : '', email ? `✉️ ${email}` : ''].filter(Boolean).join(' | ');
    document.getElementById('profile-stats').innerHTML = '<div style="color:#999; font-size:0.85rem; grid-column:1/-1;">Cargando historial...</div>';
    document.getElementById('profile-orders').innerHTML = '';
    const burgersReset = document.getElementById('profile-burgers');
    if (burgersReset) burgersReset.innerHTML = '';

    if (!client || !userId || userId === 'null' || userId === 'undefined') {
        document.getElementById('profile-stats').innerHTML = '<div style="color:#999; grid-column:1/-1;">Sin cliente asociado.</div>';
        return;
    }

    try {
        // Buscar por cliente_id primero (es el FK real en pedidos)
        let { data: pedidos, error } = await client
            .from('pedidos')
            .select('*')
            .eq('cliente_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Si no encontró por cliente_id, intentar por user_id
        if (!pedidos || pedidos.length === 0) {
            const res2 = await client
                .from('pedidos')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (res2.error) throw res2.error;
            pedidos = res2.data || [];
        }

        if (error) throw error;

        const pedidosConfirmados = pedidos.filter(p => ['aprobado', 'preparacion', 'entregado'].includes(p.estado_pago));
        const pedidosVigentes = pedidos.filter(p => p.estado_pago !== 'cancelado');
        const totalGastado = pedidosConfirmados.reduce((a, p) => a + (p.total || 0), 0);
        const totalBurgers = pedidosConfirmados.reduce((a, p) => {
            (p.items || []).forEach(i => { if (i.type === 'Simple' || i.type === 'Doble') a += (i.qty || 1); });
            return a;
        }, 0);

        const avgTicket = pedidosConfirmados.length > 0 ? Math.round(totalGastado / pedidosConfirmados.length) : 0;

        document.getElementById('profile-stats').innerHTML = `
            <div class="profile-stat"><div class="ps-label">Pedidos</div><div class="ps-value">${pedidosVigentes.length}</div></div>
            <div class="profile-stat"><div class="ps-label">Ticket Promedio</div><div class="ps-value" style="font-size:1rem;">$${avgTicket.toLocaleString()}</div></div>
            <div class="profile-stat"><div class="ps-label">Total Gastado</div><div class="ps-value" style="font-size:1rem;">$${totalGastado.toLocaleString()}</div></div>
        `;

        document.getElementById('profile-orders').innerHTML = pedidos.length === 0
            ? '<div style="color:#999; text-align:center; padding:20px;">Sin pedidos registrados</div>'
            : pedidos.map(p => {
                const fecha = new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const hora = new Date(p.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
                const items = (p.items || []).map(i => `${i.qty}x ${i.title} (${i.type})`).join(', ');
                const estadoColor = { pendiente: '#FF6B35', aprobado: '#2E7D32', preparacion: '#1565C0', entregado: '#424242' };
                return `<div class="profile-order">
                    <div class="profile-order-header">
                        <strong style="font-family:'Archivo Black';">#${escapeAdminHtml(p.numero_pedido || 'S/N')} — ${fecha} ${hora}</strong>
                        <span style="font-size:0.7rem; font-weight:700; color:${estadoColor[p.estado_pago] || '#999'}; text-transform:uppercase;">${escapeAdminHtml(p.estado_pago || 'pendiente')}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#555; margin-bottom:4px;">${escapeAdminHtml(items)}</div>
                    <div style="text-align:right; font-family:'Archivo Black';">$${(p.total || 0).toLocaleString()}</div>
                </div>`;
            }).join('');

        // Burger ranking
        const burgerCounts = new Map();
        pedidos.forEach(p => {
            (p.items || []).forEach(i => {
                if (i.title) {
                    const key = i.title;
                    burgerCounts.set(key, (burgerCounts.get(key) || 0) + (i.qty || 1));
                }
            });
        });
        const sortedBurgers = [...burgerCounts.entries()].sort((a, b) => b[1] - a[1]);

        const burgersEl = document.getElementById('profile-burgers');
        if (burgersEl) {
            if (sortedBurgers.length > 0) {
                burgersEl.innerHTML =
                    `<h3 style="font-family:'Archivo Black'; font-size:0.85rem; text-transform:uppercase; margin:1.5rem 0 0.8rem; padding-bottom:0.5rem; border-bottom:3px solid #111;">
                        Ranking de Favoritos
                    </h3>` +
                    sortedBurgers.map(([name, count], idx) =>
                        `<div class="profile-burger-rank${idx === 0 ? ' top-burger' : ''}">
                            <span class="rank-name">${idx === 0 ? '&#127942; ' : (idx + 1) + '. '}${escapeAdminHtml(name)}</span>
                            <span class="rank-count">${count}x</span>
                        </div>`
                    ).join('');
            } else {
                burgersEl.innerHTML = '';
            }
        }

    } catch (err) { console.error("Profile error:", err); }
};

window.closeCustomerModal = function () {
    document.getElementById('customer-modal').style.display = 'none';
};

// ══════════════════════════════════
// STOCK / INSUMOS
// ══════════════════════════════════

async function loadStockData() {
    if (!client) return;
    try {
        const { data, error } = await client.from('insumos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        allInsumos = data || [];

        const tbody = document.getElementById('stock-table-body');
        if (!tbody) return;

        tbody.innerHTML = data.map(i => {
            let sClass = 'status-ok', sText = 'NORMAL';
            if (i.stock_actual <= 0) { sClass = 'status-critical'; sText = 'AGOTADO'; }
            else if (i.stock_actual <= i.stock_minimo) { sClass = 'status-low'; sText = 'BAJO'; }
            const ingredientId = safeAdminId(i.id);
            return `<tr>
                <td><strong>${escapeAdminHtml(i.nombre)}</strong></td>
                <td style="font-size:1.1rem; font-weight:900;">${Number(i.stock_actual) || 0} <small style="color:#888;">${escapeAdminHtml(i.unidad)}</small></td>
                <td>${Number(i.stock_minimo) || 0}</td>
                <td><span class="status-badge ${sClass}">${sText}</span></td>
                <td style="white-space:nowrap;">
                    <button class="qty-btn" style="padding:7px 10px;" onclick="quickUpdateStock('${ingredientId}', 1)" title="Sumar 1">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px;" onclick="quickUpdateStock('${ingredientId}', -1)" title="Restar 1">
                        <i data-lucide="minus" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px;" onclick="editInsumoMinimo('${ingredientId}', ${Number(i.stock_minimo) || 0})" title="Editar mínimo">
                        <i data-lucide="pencil" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px; color:var(--primary);" onclick="deleteInsumo('${ingredientId}')" title="Eliminar">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                    </button>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">Sin insumos cargados</td></tr>';

        const select = document.getElementById('stock-insumo-select');
        if (select) select.innerHTML = '<option value="">Seleccionar insumo...</option>' + data.map(i => `<option value="${safeAdminId(i.id)}">${escapeAdminHtml(i.nombre)} (${escapeAdminHtml(i.unidad)})</option>`).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) { console.error("Stock Load Error:", err); }
}

// Crear nuevo insumo
window.handleNewInsumo = async function (e) {
    e.preventDefault();
    const nombre = document.getElementById('new-insumo-nombre').value.trim();
    const unidad = document.getElementById('new-insumo-unidad').value;
    const stock_actual = Number(document.getElementById('new-insumo-stock').value);
    const stock_minimo = Number(document.getElementById('new-insumo-minimo').value);
    if (!Number.isFinite(stock_actual) || stock_actual < 0 || !Number.isFinite(stock_minimo) || stock_minimo < 0) {
        showStatusToast('El stock y el minimo deben ser numeros no negativos');
        return;
    }
    if (!nombre) { showStatusToast('Ingresá un nombre'); return; }

    try {
        const { error } = await client.from('insumos').insert({ nombre, unidad, stock_actual, stock_minimo });
        if (error) throw error;
        showStatusToast('INSUMO CREADO');
        e.target.reset();
        loadStockData();
        loadIngredientesForRecipe();
    } catch (err) {
        console.error(err);
        showStatusToast('Error: ' + (err.message || 'No se pudo crear'));
    }
};

// Actualizar stock existente
async function handleStockSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('stock-insumo-select').value;
    const qty = parseFloat(document.getElementById('stock-qty').value);
    const action = document.getElementById('stock-action').value;
    if (!Number.isFinite(qty) || qty < 0) { showStatusToast('La cantidad no puede ser negativa'); return; }
    if (!id || isNaN(qty)) { showStatusToast('Seleccioná insumo y cantidad'); return; }

    try {
        let newQty = qty;
        if (action === 'add') {
            const current = allInsumos.find(i => String(i.id) === String(id));
            newQty = Number(current?.stock_actual || 0) + qty;
        } else if (action === 'subtract') {
            const current = allInsumos.find(i => String(i.id) === String(id));
            newQty = Math.max(0, Number(current?.stock_actual || 0) - qty);
        }
        const { error } = await client.from('insumos').update({ stock_actual: newQty }).eq('id', id);
        if (error) throw error;
        showStatusToast('STOCK ACTUALIZADO');
        e.target.reset();
        loadStockData();
    } catch (err) { showStatusToast('Error al actualizar stock'); }
}

// Quick +/- buttons
window.quickUpdateStock = async function (id, change) {
    const item = allInsumos.find(i => String(i.id) === String(id));
    if (!item) return;
    try {
        const newVal = Math.max(0, Number(item.stock_actual || 0) + Number(change || 0));
        const { error } = await client.from('insumos').update({ stock_actual: newVal }).eq('id', id);
        if (error) throw error;
        loadStockData();
    } catch (err) { console.error(err); }
};

// Editar stock mínimo
window.editInsumoMinimo = async function (id, currentMin) {
    const newMin = prompt('Nuevo stock mínimo:', currentMin);
    if (newMin === null) return;
    const val = parseFloat(newMin);
    if (isNaN(val) || val < 0) { showStatusToast('Valor inválido'); return; }
    try {
        const { error } = await client.from('insumos').update({ stock_minimo: val }).eq('id', id);
        if (error) throw error;
        showStatusToast('MÍNIMO ACTUALIZADO');
        loadStockData();
    } catch (err) { showStatusToast('Error al actualizar'); }
};

// Eliminar insumo
window.deleteInsumo = async function (id) {
    try {
        const { data: products, error: productsError } = await client
            .from('productos')
            .select('id, nombre, receta');
        if (productsError) throw productsError;

        const referencedBy = (products || []).filter(product =>
            Array.isArray(product.receta?.ingredientes) &&
            product.receta.ingredientes.some(item => String(item.ingrediente_id) === String(id))
        );
        const referencedInCurrentEdit = currentRecipe.some(item => String(item.ingrediente_id) === String(id));
        if (referencedBy.length || referencedInCurrentEdit) {
            const productNames = referencedBy.map(product => product.nombre).slice(0, 4).join(', ');
            showStatusToast(`No se puede eliminar: se usa en ${productNames || 'la receta que estas editando'}`);
            return;
        }

        const ingredient = allInsumos.find(item => String(item.id) === String(id));
        if (!confirm(`Eliminar el insumo "${ingredient?.nombre || id}"? Esta accion no se puede deshacer.`)) return;

        const { error } = await client.from('insumos').delete().eq('id', id);
        if (error) throw error;
        showStatusToast('INSUMO ELIMINADO');
        await Promise.all([loadStockData(), loadIngredientesForRecipe()]);
        if (document.getElementById('productos-section')?.classList.contains('active')) await loadProductos();
    } catch (error) {
        console.error('Ingredient delete error:', error);
        showStatusToast('Error al verificar o eliminar el insumo: ' + (error.message || ''));
    }
};

// ══════════════════════════════════
// MARKETING
// ══════════════════════════════════

window.toggleMarketingFields = function () {
    const applyType = document.getElementById('m-apply-type').value;
    const benefitType = document.getElementById('m-benefit-type').value;
    document.getElementById('m-field-code').style.display = applyType === 'coupon' ? 'block' : 'none';
    document.getElementById('m-field-value').style.display = (benefitType === 'percent' || benefitType === 'fixed') ? 'block' : 'none';
    document.getElementById('m-fields-multi').style.display = benefitType === 'multi_buy' ? 'flex' : 'none';
    document.getElementById('m-field-second').style.display = benefitType === 'second_unit' ? 'block' : 'none';
};

async function loadMarketingData() {
    if (!client) return;
    try {
        const [promos, coupons] = await Promise.all([
            client.from('promociones').select('*').order('created_at', { ascending: false }),
            client.from('cupones').select('*').order('created_at', { ascending: false })
        ]);

        const tbody = document.getElementById('marketing-table-body');
        if (!tbody) return;

        let html = '';
        if (promos.data) html += promos.data.map(p => renderMarketingRow(p, 'PROMO')).join('');
        if (coupons.data) html += coupons.data.map(c => renderMarketingRow(c, 'CUPÓN')).join('');

        tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center; padding:20px;">SIN OFERTAS ACTIVAS</td></tr>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) { console.error("Marketing Load Error:", err); }
}

function renderMarketingRow(item, rowType) {
    const type = item.tipo || 'percent';
    const val = item.valor || 0;
    let beneficio = '';
    if (type === 'percent') beneficio = `${val}% OFF`;
    if (type === 'fixed') beneficio = `$${val.toLocaleString()} OFF`;
    if (type === 'multi_buy') beneficio = `${item.buy_qty}x${item.get_qty}`;
    if (type === 'second_unit') beneficio = `${item.second_unit_percent}% en 2da`;

    const label = rowType === 'CUPÓN'
        ? `<span style="color:var(--primary)">🎫 ${escapeAdminHtml(item.codigo)}</span>`
        : `⚡ ${escapeAdminHtml(item.nombre)}`;
    const usos = rowType === 'CUPÓN'
        ? `${item.usos_actuales || 0} / ${item.limite_usos || '∞'}`
        : `${item.usos_totales || 0} / ${item.limite_usos || '∞'}`;
    const tableSource = rowType === 'CUPÓN' ? 'cupones' : 'promociones';
    const offerId = safeAdminId(item.id);
    const isActive = item.activo !== false;

    return `<tr>
        <td style="font-family:'Archivo Black'; font-size:1rem;">${label}</td>
        <td><small>${rowType}</small></td>
        <td>${beneficio}</td>
        <td>${usos}</td>
        <td><span class="status-badge ${isActive ? 'status-ok' : 'status-critical'}">${isActive ? 'ACTIVA' : 'HISTÓRICA'}</span></td>
        <td>${offerId && isActive ? `<button class="qty-btn" title="Desactivar oferta" onclick="deleteOffer('${offerId}', '${tableSource}')"><i data-lucide="power" style="width:14px;"></i></button>` : ''}</td>
    </tr>`;
}

async function handleMarketingSubmit(e) {
    e.preventDefault();
    const applyType = document.getElementById('m-apply-type').value;
    const nombre = document.getElementById('m-name').value;
    const codigo = document.getElementById('m-coupon-code').value.toUpperCase();
    const benefitType = document.getElementById('m-benefit-type').value;
    const valor = parseFloat(document.getElementById('m-value').value) || 0;
    const buy_qty = parseInt(document.getElementById('m-buy').value) || 0;
    const get_qty = parseInt(document.getElementById('m-pay').value) || 0;
    const second_unit_percent = parseFloat(document.getElementById('m-second-value').value) || 0;
    const limite = parseInt(document.getElementById('m-limit').value) || 100;

    const payload = { tipo: benefitType, valor, buy_qty, get_qty, second_unit_percent, limite_usos: limite };

    try {
        if (applyType === 'coupon') {
            payload.codigo = codigo;
            await client.from('cupones').insert(payload);
        } else {
            payload.nombre = nombre;
            await client.from('promociones').insert(payload);
        }
        showStatusToast("¡Oferta creada!");
        e.target.reset();
        window.toggleMarketingFields();
        loadMarketingData();
    } catch (err) { console.error(err); showStatusToast("Error al crear. ¿Código duplicado?"); }
}

window.deleteOffer = async function (id, table) {
    if (!confirm("¿Desactivar esta oferta? Si todavía no se usó, se eliminará.")) return;
    if (!['cupones', 'promociones'].includes(table) || !safeAdminId(id)) return;
    try {
        const referenceColumn = table === 'cupones' ? 'cupon_id' : 'promo_id';
        const { count, error: countError } = await client
            .from('pedidos')
            .select('id', { count: 'exact', head: true })
            .eq(referenceColumn, id);
        if (countError) throw countError;

        const operation = count > 0
            ? client.from(table).update({ activo: false }).eq('id', id)
            : client.from(table).delete().eq('id', id);
        const { error } = await operation;
        if (error) throw error;
        showStatusToast(count > 0 ? 'OFERTA DESACTIVADA · HISTORIAL CONSERVADO' : 'OFERTA SIN USOS ELIMINADA');
        loadMarketingData();
    } catch (err) { console.error(err); }
};

// ══════════════════════════════════
// CRM — CLIENTES
// ══════════════════════════════════

let allCRMClients = [];

async function loadCRMData() {
    if (!client) return;
    try {
        // Cargar clientes Y todos los pedidos para computar datos reales
        const [clientesRes, pedidosRes] = await Promise.all([
            client.from('clientes').select('*').order('created_at', { ascending: false }),
            client.from('pedidos').select('id, cliente_id, user_id, total, items, created_at, estado_pago')
        ]);

        if (clientesRes.error) throw clientesRes.error;
        const clientes = clientesRes.data || [];
        const pedidos = pedidosRes.data || [];

        // Agrupar pedidos por cliente_id
        const pedidosByClient = {};
        pedidos.forEach(p => {
            const key = p.cliente_id || p.user_id;
            if (!key) return;
            if (!pedidosByClient[key]) pedidosByClient[key] = [];
            pedidosByClient[key].push(p);
        });

        // Enriquecer cada cliente con datos computados
        allCRMClients = clientes.map(c => {
            const clientPedidosAll = pedidosByClient[c.id] || pedidosByClient[c.user_id] || [];
            const clientPedidos = clientPedidosAll.filter(p => ['aprobado', 'preparacion', 'entregado'].includes(p.estado_pago));
            const totalGastado = clientPedidos.reduce((a, p) => a + (p.total || 0), 0);
            const pedidosCount = clientPedidos.length;

            // Burger favorita
            const burgerCounts = new Map();
            let lastOrderDate = null;
            clientPedidos.forEach(p => {
                if (p.created_at) {
                    const d = new Date(p.created_at);
                    if (!lastOrderDate || d > lastOrderDate) lastOrderDate = d;
                }
                (p.items || []).forEach(i => {
                    const t = (i.type || '').toLowerCase();
                    if (t === 'simple' || t === 'doble') {
                        const title = String(i.title || '');
                        burgerCounts.set(title, (burgerCounts.get(title) || 0) + (parseInt(i.qty) || 1));
                    }
                });
            });
            const favBurger = [...burgerCounts.entries()].sort((a, b) => b[1] - a[1])[0];

            return {
                ...c,
                _pedidos: pedidosCount,
                _total: totalGastado,
                _ticket: pedidosCount > 0 ? Math.round(totalGastado / pedidosCount) : 0,
                _lastOrder: lastOrderDate,
                _favBurger: favBurger ? favBurger[0] : null,
                _favBurgerQty: favBurger ? favBurger[1] : 0,
                _burgerNames: [...burgerCounts.keys()]
            };
        });

        // Stats cards
        const total = allCRMClients.length;
        const withOrders = allCRMClients.filter(c => c._pedidos > 0).length;
        const totalGastadoAll = allCRMClients.reduce((a, c) => a + c._total, 0);
        const totalPedidosAll = allCRMClients.reduce((a, c) => a + c._pedidos, 0);
        const avgTicket = totalPedidosAll > 0 ? Math.round(totalGastadoAll / totalPedidosAll) : 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newClients = allCRMClients.filter(c => c.created_at && new Date(c.created_at) >= thirtyDaysAgo).length;

        document.getElementById('crm-total-clients').textContent = total;
        document.getElementById('crm-with-orders').textContent = withOrders;
        document.getElementById('crm-avg-ticket').textContent = `$${avgTicket.toLocaleString()}`;
        document.getElementById('crm-new-30d').textContent = newClients;

        // Poblar filtro de burgers
        const allBurgerNames = new Set();
        allCRMClients.forEach(c => (c._burgerNames || []).forEach(b => allBurgerNames.add(b)));
        const burgerSelect = document.getElementById('crm-filter-burger');
        if (burgerSelect) {
            const current = burgerSelect.value;
            burgerSelect.innerHTML = '<option value="">Todas las burgers</option>' +
                [...allBurgerNames].sort().map(b => `<option value="${escapeAdminHtml(b)}">${escapeAdminHtml(b)}</option>`).join('');
            burgerSelect.value = current;
        }

        filterCRMTable();
    } catch (err) {
        console.error("CRM Load Error:", err);
        showStatusToast("Error cargando CRM");
    }
}

function renderCRMTable(clientes) {
    const tbody = document.getElementById('crm-table-body');
    if (!tbody) return;

    if (!clientes.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px; color:#999;">Sin clientes registrados</td></tr>';
        return;
    }

    tbody.innerHTML = clientes.map((c, i) => {
        const lastOrder = c._lastOrder
            ? c._lastOrder.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const alta = c.created_at
            ? new Date(c.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const nombre = c.nombre || 'S/N';
        const cid = safeAdminId(c.id);
        return `<tr>
            <td style="font-family:'Archivo Black'; text-align:center;">${i + 1}</td>
            <td style="font-weight:700;">${escapeAdminHtml(nombre)}</td>
            <td>${escapeAdminHtml(c.whatsapp || '—')}</td>
            <td style="font-size:0.82rem;">${escapeAdminHtml(c.email || '—')}</td>
            <td style="font-weight:900; text-align:center;">${c._pedidos}</td>
            <td style="font-weight:900; font-family:'Archivo Black';">$${c._total.toLocaleString()}</td>
            <td style="font-size:0.78rem;">${c._favBurger ? `🍔 ${escapeAdminHtml(c._favBurger)}` : '—'}</td>
            <td style="font-size:0.78rem;">${alta}</td>
            <td style="font-size:0.82rem;">${lastOrder}</td>
            <td>
                ${cid ? `<button class="qty-btn" style="font-size:0.7rem; padding:6px 14px;" onclick="openCustomerProfileById('${cid}')">
                    <i data-lucide="eye" style="width:14px; height:14px; vertical-align:middle;"></i> VER
                </button>` : ''}
            </td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.filterCRMTable = function () {
    const query = (document.getElementById('crm-search')?.value || '').toLowerCase().trim();
    const burgerFilter = document.getElementById('crm-filter-burger')?.value || '';
    const pedidosMin = parseInt(document.getElementById('crm-filter-pedidos')?.value) || 0;
    const gastoMin = parseInt(document.getElementById('crm-filter-gasto')?.value) || 0;
    const sortBy = document.getElementById('crm-sort')?.value || 'total';

    let filtered = [...allCRMClients];

    // Filtro texto
    if (query) {
        filtered = filtered.filter(c =>
            (c.nombre || '').toLowerCase().includes(query) ||
            (c.email || '').toLowerCase().includes(query) ||
            (c.whatsapp || '').includes(query)
        );
    }

    // Filtro burger favorita
    if (burgerFilter) {
        filtered = filtered.filter(c => (c._burgerNames || []).includes(burgerFilter));
    }

    // Filtro pedidos mínimos
    if (pedidosMin > 0) {
        filtered = filtered.filter(c => c._pedidos >= pedidosMin);
    }

    // Filtro gasto mínimo
    if (gastoMin > 0) {
        filtered = filtered.filter(c => c._total >= gastoMin);
    }

    // Ordenar
    if (sortBy === 'total') {
        filtered.sort((a, b) => b._total - a._total);
    } else if (sortBy === 'pedidos') {
        filtered.sort((a, b) => b._pedidos - a._pedidos);
    } else if (sortBy === 'reciente') {
        filtered.sort((a, b) => (b._lastOrder || 0) - (a._lastOrder || 0));
    } else if (sortBy === 'alta') {
        filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }

    renderCRMTable(filtered);
};

// ══════════════════════════════════════════════════════════
// 🖨️  TICKETERA — IMPRESIÓN DE TICKETS PARA IMPRESORA TÉRMICA
// ══════════════════════════════════════════════════════════

const APPROVED_TICKET_FORMAT_VERSION = '20260829.1';

// Modelo único aprobado: lo consumen tanto QZ/ESC-POS como la impresión del navegador.
function buildApprovedTicketLines(o) {
    const esRetiro = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup';
    const direccion = esRetiro ? 'RETIRO EN LOCAL' : (o.direccion_entrega || 'SIN DIRECCIÓN');
    const timbre = esRetiro ? '' : String(o.timbre || '').trim();
    const horario = formatScheduledDelivery(o.entrega_programada).replace(/\s*hs$/i, '');
    const lines = [
        { text: `NOM: ${o.clientes?.nombre || 'CLIENTE S/N'}` },
        { text: `HOR: ${horario}` },
        { text: `DIR: ${direccion}` }
    ];

    if (timbre) lines.push({ text: `T/D: ${timbre}` });
    lines.push({ gap: true }, { text: 'PEDIDO:' }, { gap: true });

    for (const item of (o.items || [])) {
        const qty = Math.max(1, parseInt(item.qty) || 1);
        lines.push({ text: `${qty} ${getComandaProductName(item)} ${getComandaSize(item)}` });
        const extraDetails = getComandaExtraDetails(item);
        if (extraDetails.length) {
            lines.push({ text: `+ ${formatOrderExtras(extraDetails)}`, detail: true });
        }
        const removedIngredients = formatOrderRemovedIngredients(item);
        if (removedIngredients) lines.push({ text: `SIN: ${removedIngredients}`, detail: true });
    }

    if (o.nota) lines.push({ gap: true }, { text: `OBS: ${o.nota}` });
    const benefit = getOrderBenefit(o);
    if (benefit) {
        lines.push(
            { gap: true },
            { text: `${benefit.typeLabel}: ${benefit.label}` },
            { text: `DTO: -$${benefit.amount.toLocaleString('es-AR')}` }
        );
    }
    lines.push(
        { gap: true },
        { text: `TOTAL: $${Number(o.total || 0).toLocaleString('es-AR')}` },
        { text: 'ALIAS: RIOH.BURGERS' }
    );
    return lines;
}

// Imprimir el pedido actualmente abierto en el modal
window.printCurrentOrderTicket = function () {
    if (_currentModalOrder) printTicket(_currentModalOrder);
    else showStatusToast('No hay pedido seleccionado');
};

// Router principal: QZ Tray si está disponible, sino ventana emergente
window.printTicket = function (order, metodoPagoOverride) {
    if (_qzConnected && typeof qz !== 'undefined' && qz.websocket.isActive()) {
        printTicketWithQZ(order, metodoPagoOverride);
    } else {
        printTicketBrowser(order, metodoPagoOverride);
    }
};

// ── MODO QZ TRAY (impresión silenciosa ESC/POS) ──
async function printTicketWithQZ(order, metodoPagoOverride) {
    try {
        if (!qz.websocket.isActive()) {
            await qz.websocket.connect({ retries: 2, delay: 1000 });
            _qzConnected = true;
            updateQZStatusUI(true);
        }
        const printer = _selectedPrinter || await qz.printers.getDefault();
        const config = qz.configs.create(printer);
        const data = buildESCPOSTicket(order, metodoPagoOverride);
        await qz.print(config, [{ type: 'raw', format: 'plain', data }]);
        showStatusToast('🖨️ Ticket enviado → ' + printer);
    } catch (err) {
        console.error('[QZ] Error al imprimir:', err);
        _qzConnected = false;
        updateQZStatusUI(false);
        showStatusToast('⚠ QZ Tray error — usando ventana emergente');
        printTicketBrowser(order, metodoPagoOverride);
    }
}

// ── MODO BROWSER (ventana emergente + window.print) ──
function printTicketBrowser(order, metodoPagoOverride) {
    const html = buildReceiptHTML(order, metodoPagoOverride);
    const win = window.open('about:blank', '_blank', 'width=360,height=720,toolbar=0,menubar=0,scrollbars=1,status=0,resizable=1');
    if (!win) {
        showStatusToast('⚠ Habilitá los popups para imprimir tickets');
        return;
    }
    win.opener = null;
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => { if (win && !win.closed) { win.focus(); win.print(); } }, 500);
}

// ── ESC/POS TICKET BUILDER ──
function buildESCPOSTicket(o, metodoPagoOverride) {
    const E = '\x1B'; const G = '\x1D';
    const INIT        = E + '\x40';
    const LEFT        = E + '\x61\x00';
    const BOLD_ON     = E + '\x45\x01';
    const BOLD_OFF    = E + '\x45\x00';
    const FONT_A      = E + '\x4D\x00';
    const LARGE       = G + '\x21\x11';   // ESC/POS: doble ancho y alto, equivalente legible a la referencia de 50px
    const NORMAL      = G + '\x21\x00';   // tamaño normal
    const CUT         = G + '\x56\x41\x05'; // corte parcial + feed 5mm
    const FEED        = E + '\x64\x04';   // avance 4 líneas

    const W = 24; // Font A doble: usa el ancho completo del papel de 80mm sin deformar las letras

    function safe(s) {
        return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
    }

    function wrapLine(value) {
        const words = safe(value).toUpperCase().split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';
        for (const word of words) {
            if (word.length > W) {
                if (line) { lines.push(line); line = ''; }
                for (let start = 0; start < word.length; start += W) lines.push(word.slice(start, start + W));
                continue;
            }
            const candidate = line ? `${line} ${word}` : word;
            if (candidate.length > W) {
                if (line) lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        if (line) lines.push(line);
        return (lines.length ? lines : ['']).map(current => `${current}\n`).join('');
    }

    let t = INIT + LEFT + FONT_A + LARGE + BOLD_ON;
    for (const line of buildApprovedTicketLines(o)) {
        t += line.gap ? '\n' : wrapLine(line.text);
    }
    t += BOLD_OFF + NORMAL + FONT_A + FEED + CUT;

    return t;
}

// Construye el HTML del ticket para 80mm de papel térmico
function buildReceiptHTML(o, metodoPagoOverride) {
    const h = escapeAdminHtml;
    const ticketLinesHtml = buildApprovedTicketLines(o).map(line => {
        if (line.gap) return '<div class="ticket-gap" aria-hidden="true"></div>';
        return `<div class="ticket-line${line.detail ? ' ticket-detail' : ''}">${h(String(line.text).toUpperCase())}</div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Ticket RIOH. #${h(o.numero_pedido || '')}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  @media print {
    body { width: 80mm !important; }
    .no-print { display: none !important; }
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 80mm;
    background: #fff;
    color: #000;
    overflow: hidden;
  }
  .ticket-sheet {
    width: 720px;
    padding: 38px 40px 46px;
    font-family: Arial, Helvetica, sans-serif;
    zoom: .42;
  }
  .ticket-line {
    width: 100%;
    font-size: 50px;
    font-weight: 900;
    line-height: 1.12;
    letter-spacing: -.25px;
    overflow-wrap: break-word;
  }
  .ticket-detail { padding-left: 24px; }
  .ticket-gap { height: 34px; }
</style>
</head>
<body>
<main class="ticket-sheet" data-ticket-format="${APPROVED_TICKET_FORMAT_VERSION}">
${ticketLinesHtml}
</main>
</body>
</html>`;
}
