// RIOH. ADMIN ENGINE

// Credenciales (usuario de prueba hasta producción)
const ADMIN_USERS = {
    admin: 'riohadmin2025'
};
const SESSION_KEY = 'rioh_admin_v2';

// ── LOGIN SYSTEM ──
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
        showAdminApp();
    }
    // Otherwise login overlay stays visible (default)
});

window.doLogin = function () {
    const user = (document.getElementById('login-user').value || '').trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');

    if (!user || !pass) {
        errorEl.textContent = 'Completá usuario y contraseña';
        return;
    }

    if (ADMIN_USERS[user] && ADMIN_USERS[user] === pass) {
        sessionStorage.setItem(SESSION_KEY, '1');
        document.getElementById('login-overlay').classList.add('hidden');
        showAdminApp();
    } else {
        errorEl.textContent = 'Usuario o contraseña incorrectos';
        document.getElementById('login-pass').value = '';
        document.getElementById('login-pass').focus();
    }
};

window.doLogout = function () {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
};

function showAdminApp() {
    document.getElementById('main-content').style.display = 'block';
    initApp();
}

const SUPABASE_URL = 'https://xjoyrjzvdfwavnvnfnvt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhqb3lyanp2ZGZ3YXZudm5mbnZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NzIxMDYsImV4cCI6MjA4NjQ0ODEwNn0.Uw0MwDvBPtRjyMCt2ZA-kMYvVmIhUPXPP52AJo4a14Y';

let client = null;
let allInsumos = [];
let currentFilter = 'hoy';
let customDateRange = { from: null, to: null };

// Orders state
let ordersFilter = 'hoy';
let ordersCustomRange = { from: null, to: null };
let ordersAutoRefreshTimer = null;

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

// ── APP INITIALIZATION (called after login) ──
async function initApp() {
    if (typeof window.supabase !== 'undefined') {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        loadOrders();
        initRealtime();
        initForms();
        startOrdersAutoRefresh();
        initDemoBtn();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } else {
        alert("ERROR CRÍTICO: Supabase SDK no encontrado.");
    }
}

function initForms() {
    const stockForm = document.getElementById('stock-form');
    if (stockForm) stockForm.onsubmit = handleStockSubmit;

    const marketingForm = document.getElementById('marketing-form');
    if (marketingForm) marketingForm.onsubmit = handleMarketingSubmit;
}

// ── CASH REGISTER SOUND (Web Audio API) ──
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
    } catch (e) {
        console.log("Audio error:", e);
    }
}

function initRealtime() {
    client
        .channel('schema-db-changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos' }, (payload) => {
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
    toast.innerHTML = `¡NUEVO PEDIDO ENTRANDO!`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.5s forwards';
        setTimeout(() => toast.remove(), 500);
    }, 5000);
}

// ── EXPORT: WHATSAPP ──
window.exportToWhatsApp = function () {
    const total    = document.getElementById('stats-total-sales')?.innerText || '$0';
    const pedidos  = document.getElementById('stats-orders-count')?.innerText || '0';
    const ticket   = document.getElementById('stats-avg-ticket')?.innerText || '$0';

    const filters  = { hoy: 'Hoy', semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre', semestre: 'Semestre', custom: 'Rango personalizado' };
    const periodo  = filters[currentFilter] || currentFilter;

    let sellers = '';
    const bestEl = document.getElementById('best-sellers-list');
    if (bestEl) {
        const rows = bestEl.querySelectorAll('div');
        rows.forEach((r, i) => { if (i < 3) sellers += `  ${r.textContent.trim()}\n`; });
    }

    const text = `🍔 *RIOH. Burgers — Resumen ${periodo}*\n\n💰 Ventas: *${total}*\n📦 Pedidos: *${pedidos}*\n🎯 Ticket promedio: *${ticket}*\n\n🏆 Top productos:\n${sellers || '  Sin datos'}\n\n_Panel RIOH.ADMIN_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
};

// ── EXPORT: PDF ──
window.exportToPDF = function () {
    window.print();
};

window.toggleDemoMode = function () {
    const isDemo = localStorage.getItem('rioh_demo') === '1';
    if (isDemo) {
        localStorage.removeItem('rioh_demo');
        showStatusToast("MODO DEMO DESACTIVADO");
        updateDemoBtn(false);
    } else {
        localStorage.setItem('rioh_demo', '1');
        showStatusToast("MODO DEMO ACTIVADO — la web está abierta para pruebas");
        updateDemoBtn(true);
    }
};

function updateDemoBtn(isActive) {
    const btn = document.getElementById('demo-mode-btn');
    if (!btn) return;
    if (isActive) {
        btn.style.background = '#FFD600';
        btn.style.color = '#111';
        btn.style.borderColor = '#111';
        btn.textContent = '⚡ MODO DEMO: ON';
    } else {
        btn.style.background = 'var(--primary)';
        btn.style.color = 'white';
        btn.style.borderColor = 'white';
        btn.textContent = '⚡ MODO DEMO: OFF';
    }
}

function initDemoBtn() {
    updateDemoBtn(localStorage.getItem('rioh_demo') === '1');
}

let showingDemoOrders = false;

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

// ── GLOBAL NAVIGATION ──
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.refreshAll = function () {
    loadDashboard();
    loadStockData();
    loadOrders();
    loadMarketingData();
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

// ── ORDERS — KANBAN ──
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
        let query = client.from('pedidos').select('*, clientes(nombre, whatsapp)').order('created_at', { ascending: false });

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

        const { data: orders, error } = await query;
        if (error) throw error;
        renderKanban(orders, false);
    } catch (err) { console.error("Orders Load Error:", err); }
}

function renderKanban(orders, isDemo) {
    const nextLabel = { pendiente: 'CONFIRMAR PAGO', aprobado: 'EN PREPARACIÓN', preparacion: 'ENTREGADO ✓' };
    const prevLabel = { aprobado: '← Nuevo', preparacion: '← Pago OK', entregado: '← En prep.' };

    const grupos = {
        pendiente:   orders.filter(o => !o.estado_pago || o.estado_pago === 'pendiente'),
        aprobado:    orders.filter(o => o.estado_pago === 'aprobado'),
        preparacion: orders.filter(o => o.estado_pago === 'preparacion'),
        entregado:   orders.filter(o => o.estado_pago === 'entregado')
    };

    for (const [estado, cards] of Object.entries(grupos)) {
        const container = document.getElementById(`cards-${estado}`);
        const countEl   = document.getElementById(`count-${estado}`);
        const mTabCount = document.getElementById(`mtab-${estado}`);
        if (!container) continue;

        countEl.textContent = cards.length;
        if (mTabCount) mTabCount.textContent = cards.length;

        if (cards.length === 0) {
            container.innerHTML = '<div class="kanban-empty">Sin pedidos</div>';
            continue;
        }

        container.innerHTML = cards.map(o => {
            const nombre  = o.clientes?.nombre || 'Cliente S/N';
            const tel     = o.clientes?.whatsapp || '';
            const d       = new Date(o.created_at);
            const hora    = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const items   = (o.items || []).map(i => `<div>${i.qty}x ${i.title} <small style="color:#999;">(${i.type})</small></div>`).join('');
            const entrega = o.metodo_entrega === 'takeaway' ? '🏠 Retiro' : `🛵 ${o.direccion_entrega || 'Delivery'}`;
            const demoBadge = isDemo ? '<span style="font-size:0.55rem; background:#FFD600; color:#111; padding:1px 5px; font-weight:900; vertical-align:middle;">EJEMPLO</span> ' : '';

            const advFn = isDemo ? `advanceDemoOrder('${o.id}','${estado}')` : `advanceOrder('${o.id}','${estado}')`;
            const retFn = isDemo ? `retreatDemoOrder('${o.id}','${estado}')` : `retreatOrder('${o.id}','${estado}')`;
            const delFn = isDemo ? `deleteDemoOrder('${o.id}')` : `deleteKanbanOrder('${o.id}')`;

            const actionRow = estado !== 'entregado'
                ? `<div class="card-actions">
                    ${prevLabel[estado] ? `<button class="card-btn card-btn-back" onclick="${retFn}">${prevLabel[estado]}</button>` : ''}
                    <button class="card-btn card-btn-advance" onclick="${advFn}">${nextLabel[estado]} →</button>
                   </div>`
                : `<div class="card-actions">
                    <button class="card-btn card-btn-back" style="flex:1;" onclick="${retFn}">${prevLabel[estado]}</button>
                   </div>`;

            return `<div class="kanban-card">
                <div class="kanban-card-header">
                    <strong style="font-family:'Archivo Black'; font-size:0.88rem;">${demoBadge}#${o.numero_pedido || '---'}</strong>
                    <small style="color:#888; white-space:nowrap;">${hora}</small>
                </div>
                <div style="font-size:0.83rem; font-weight:700;">${nombre}</div>
                ${tel ? `<div style="font-size:0.75rem; color:#888;">${tel}</div>` : ''}
                <div style="font-size:0.75rem; color:#666; margin-top:2px;">${entrega}</div>
                <div class="kanban-items">${items}</div>
                <div class="kanban-total">$${(o.total || 0).toLocaleString()}</div>
                ${actionRow}
            </div>`;
        }).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

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
    const colors = { pendiente:'#BF360C', aprobado:'#1B5E20', preparacion:'#0D47A1', entregado:'#212121' };
    btn.style.background = colors[estado] || '#111';
    btn.style.color = 'white';
};


window.advanceOrder = async function (id, currentState) {
    const next = { pendiente:'aprobado', aprobado:'preparacion', preparacion:'entregado' };
    if (!next[currentState]) return;
    try {
        const { error } = await client.from('pedidos').update({ estado_pago: next[currentState] }).eq('id', id);
        if (error) throw error;
        loadOrders();
    } catch (err) { showStatusToast("Error al actualizar pedido"); }
};

window.retreatOrder = async function (id, currentState) {
    const prev = { aprobado:'pendiente', preparacion:'aprobado', entregado:'preparacion' };
    if (!prev[currentState]) return;
    try {
        const { error } = await client.from('pedidos').update({ estado_pago: prev[currentState] }).eq('id', id);
        if (error) throw error;
        loadOrders();
    } catch (err) { showStatusToast("Error al actualizar pedido"); }
};

window.deleteKanbanOrder = async function (id) {
    if (!confirm('¿Eliminar este pedido? Esta acción no se puede deshacer.')) return;
    try {
        const { error } = await client.from('pedidos').delete().eq('id', id);
        if (error) throw error;
        loadOrders();
    } catch (err) { showStatusToast("Error al eliminar pedido"); }
};

// ── DASHBOARD ──
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

    const refreshIcon = document.querySelector('#dashboard-section i[data-lucide="refresh-cw"]');
    if (refreshIcon) {
        refreshIcon.style.transition = 'transform 0.6s ease';
        refreshIcon.style.transform = 'rotate(360deg)';
        setTimeout(() => { refreshIcon.style.transform = 'rotate(0deg)'; refreshIcon.style.transition = 'none'; }, 600);
    }

    try {
        let query = client.from('pedidos').select('*');
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

        const { data: pedidos, error } = await query;
        if (error) throw error;

        const totalSales = pedidos.reduce((acc, p) => acc + (p.total || 0), 0);
        const avgTicket = pedidos.length > 0 ? Math.round(totalSales / pedidos.length) : 0;

        document.getElementById('stats-total-sales').innerText = `$${totalSales.toLocaleString()}`;
        document.getElementById('stats-orders-count').innerText = pedidos.length;
        document.getElementById('stats-avg-ticket').innerText = `$${avgTicket.toLocaleString()}`;

        const ordersTitle = document.getElementById('stats-orders-count')?.previousElementSibling;
        if (ordersTitle) ordersTitle.innerText = `Pedidos (${labelSuffix})`;

        // Últimas ventas
        document.getElementById('recent-sales-log').innerHTML = pedidos.slice(0, 10).map(p => `
            <div style="border-bottom: 1px dashed #eee; padding: 10px 0;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>#${p.numero_pedido || 'S/N'}</strong>
                    <span>$${(p.total || 0).toLocaleString()}</span>
                </div>
                <small style="color:#888;">${new Date(p.created_at).toLocaleString('es-AR')}</small>
            </div>
        `).join('') || '<div style="color:#999; padding:20px;">SIN VENTAS</div>';

        // Ranking burgers
        const counts = {};
        pedidos.forEach(p => {
            if (p.items) p.items.forEach(i => counts[i.title] = (counts[i.title] || 0) + (i.qty || 1));
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        document.getElementById('best-sellers-list').innerHTML = sorted.map(([name, qty], i) => `
            <div style="display:flex; justify-content:space-between; padding:10px; border-bottom:1px solid #eee; ${i === 0 ? 'background:#FFF9C4; border:1px solid #FBC02D;' : ''}">
                <span>${i + 1}. ${name}</span>
                <span style="font-weight:900;">${qty} U.</span>
            </div>
        `).join('') || '<div style="color:#999; padding:20px;">SIN DATOS</div>';

        // Customer ranking
        loadCustomerRanking();

    } catch (err) { console.error("Dashboard Load Error:", err); }
}

async function loadCustomerRanking() {
    if (!client) return;
    try {
        const [clientesRes, pedidosRes] = await Promise.all([
            client.from('clientes').select('id, user_id, nombre, whatsapp, email, pedidos_count, total_gastado').order('total_gastado', { ascending: false }).limit(30),
            client.from('pedidos').select('user_id, items')
        ]);

        if (clientesRes.error) throw clientesRes.error;
        const clientes = clientesRes.data || [];
        const pedidos  = pedidosRes.data  || [];

        // Burger count per user_id (items where type = Simple or Doble)
        const burgerMap = {};
        pedidos.forEach(p => {
            if (!p.user_id) return;
            if (!burgerMap[p.user_id]) burgerMap[p.user_id] = 0;
            (p.items || []).forEach(i => {
                if (i.type === 'Simple' || i.type === 'Doble') {
                    burgerMap[p.user_id] += (i.qty || 1);
                }
            });
        });

        const tbody = document.getElementById('customer-ranking-body');
        if (!tbody) return;

        tbody.innerHTML = clientes.map((c, i) => {
            const ticket  = c.pedidos_count > 0 ? Math.round((c.total_gastado || 0) / c.pedidos_count) : 0;
            const burgers = burgerMap[c.user_id] || 0;
            const top     = i === 0 ? 'background:#FFF9C4;' : '';
            return `<tr style="${top}">
                <td style="font-family:'Archivo Black';">${i + 1}</td>
                <td style="font-weight:700;">${c.nombre || 'S/N'}</td>
                <td>${c.pedidos_count || 0}</td>
                <td style="font-weight:900;">${burgers}</td>
                <td style="font-weight:900;">$${(c.total_gastado || 0).toLocaleString()}</td>
                <td>$${ticket.toLocaleString()}</td>
                <td><button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="openCustomerProfile('${c.user_id}','${c.nombre}','${c.whatsapp || ''}','${c.email || ''}')">VER</button></td>
            </tr>`;
        }).join('') || `<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">Sin datos de clientes</td></tr>`;

    } catch (err) { console.error("Customer Ranking Error:", err); }
}

// ── CUSTOMER PROFILE MODAL ──
window.openCustomerProfile = async function (userId, nombre, whatsapp, email) {
    document.getElementById('customer-modal').style.display = 'block';
    document.getElementById('profile-name').textContent = nombre || 'Cliente';
    document.getElementById('profile-info').innerHTML =
        `${whatsapp ? `📱 ${whatsapp}` : ''} ${email ? `&nbsp;|&nbsp; ✉️ ${email}` : ''}`;
    document.getElementById('profile-stats').innerHTML = '<div style="color:#999; font-size:0.85rem; grid-column:1/-1;">Cargando historial...</div>';
    document.getElementById('profile-orders').innerHTML = '';

    if (!client || !userId || userId === 'null') {
        document.getElementById('profile-stats').innerHTML = '<div style="color:#999; grid-column:1/-1;">Sin user_id asociado.</div>';
        return;
    }

    try {
        const { data: pedidos, error } = await client
            .from('pedidos')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const totalGastado = pedidos.reduce((a, p) => a + (p.total || 0), 0);
        const totalBurgers = pedidos.reduce((a, p) => {
            (p.items || []).forEach(i => { if (i.type === 'Simple' || i.type === 'Doble') a += (i.qty || 1); });
            return a;
        }, 0);

        document.getElementById('profile-stats').innerHTML = `
            <div class="profile-stat"><div class="ps-label">Pedidos</div><div class="ps-value">${pedidos.length}</div></div>
            <div class="profile-stat"><div class="ps-label">Hamburguesas</div><div class="ps-value">${totalBurgers}</div></div>
            <div class="profile-stat"><div class="ps-label">Total Gastado</div><div class="ps-value" style="font-size:1rem;">$${totalGastado.toLocaleString()}</div></div>
        `;

        document.getElementById('profile-orders').innerHTML = pedidos.length === 0
            ? '<div style="color:#999; text-align:center; padding:20px;">Sin pedidos registrados</div>'
            : pedidos.map(p => {
                const fecha = new Date(p.created_at).toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
                const hora  = new Date(p.created_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
                const items = (p.items || []).map(i => `${i.qty}x ${i.title} (${i.type})`).join(', ');
                const estadoColor = { pendiente:'#FF6B35', aprobado:'#2E7D32', preparacion:'#1565C0', entregado:'#424242' };
                return `<div class="profile-order">
                    <div class="profile-order-header">
                        <strong style="font-family:'Archivo Black';">#${p.numero_pedido || 'S/N'} — ${fecha} ${hora}</strong>
                        <span style="font-size:0.7rem; font-weight:700; color:${estadoColor[p.estado_pago] || '#999'}; text-transform:uppercase;">${p.estado_pago || 'pendiente'}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#555; margin-bottom:4px;">${items}</div>
                    <div style="text-align:right; font-family:'Archivo Black';">$${(p.total || 0).toLocaleString()}</div>
                </div>`;
            }).join('');

    } catch (err) { console.error("Profile error:", err); }
};

window.closeCustomerModal = function () {
    document.getElementById('customer-modal').style.display = 'none';
};

// ── STOCK ──
async function loadStockData() {
    if (!client) return;
    try {
        const { data, error } = await client.from('insumos').select('*').order('nombre', { ascending: true });
        if (error) throw error;
        allInsumos = data;

        const tbody = document.getElementById('stock-table-body');
        tbody.innerHTML = data.map(i => {
            let sClass = 'status-ok', sText = 'NORMAL';
            if (i.stock_actual <= i.stock_minimo) { sClass = 'status-low'; sText = 'BAJO'; }
            if (i.stock_actual <= 3) { sClass = 'status-critical'; sText = 'CRÍTICO'; }
            return `<tr>
                <td>${i.nombre}</td>
                <td style="font-size:1.1rem; font-weight:900;">${i.stock_actual} <small>${i.unidad}</small></td>
                <td>${i.stock_minimo}</td>
                <td><span class="status-badge ${sClass}">${sText}</span></td>
                <td>
                    <button class="qty-btn" onclick="quickUpdateStock('${i.id}', 1)">+</button>
                    <button class="qty-btn" onclick="quickUpdateStock('${i.id}', -1)" style="margin-left:5px;">-</button>
                </td>
            </tr>`;
        }).join('');

        const select = document.getElementById('stock-insumo-select');
        if (select) select.innerHTML = '<option value="">Seleccionar insumo...</option>' + data.map(i => `<option value="${i.id}">${i.nombre}</option>`).join('');
    } catch (err) { console.error("Stock Load Error:", err); }
}

async function handleStockSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('stock-insumo-select').value;
    const qty = parseInt(document.getElementById('stock-qty').value);
    const action = document.getElementById('stock-action').value;
    if (!id || isNaN(qty)) return;
    try {
        let newQty = qty;
        if (action === 'add') {
            const current = allInsumos.find(i => i.id === id);
            newQty = (current ? current.stock_actual : 0) + qty;
        }
        const { error } = await client.from('insumos').update({ stock_actual: newQty }).eq('id', id);
        if (error) throw error;
        alert("¡Stock actualizado!");
        e.target.reset();
        loadStockData();
    } catch (err) { alert("Error al actualizar stock."); }
}

window.quickUpdateStock = async function (id, change) {
    const item = allInsumos.find(i => i.id === id);
    if (!item) return;
    try {
        await client.from('insumos').update({ stock_actual: Math.max(0, item.stock_actual + change) }).eq('id', id);
        loadStockData();
    } catch (err) { console.error(err); }
};

// ── MARKETING ──
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
        ? `<span style="color:var(--primary)">🎫 ${item.codigo}</span>`
        : `⚡ ${item.nombre}`;
    const usos = rowType === 'CUPÓN'
        ? `${item.usos_actuales} / ${item.limite_usos}`
        : `${item.usos_totales || 0} / ${item.limite_usos || '∞'}`;
    const tableSource = rowType === 'CUPÓN' ? 'cupones' : 'promociones';

    return `<tr>
        <td style="font-family:'Archivo Black'; font-size:1rem;">${label}</td>
        <td><small>${rowType}</small></td>
        <td>${beneficio}</td>
        <td>${usos}</td>
        <td><span class="status-badge status-ok">ACTIVA</span></td>
        <td><button class="qty-btn" onclick="deleteOffer('${item.id}', '${tableSource}')"><i data-lucide="trash-2" style="width:14px;"></i></button></td>
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
        alert("¡Oferta creada!");
        e.target.reset();
        window.toggleMarketingFields();
        loadMarketingData();
    } catch (err) { console.error(err); alert("Error al crear. ¿Código duplicado?"); }
}

window.deleteOffer = async function (id, table) {
    if (!confirm("¿Eliminar esta oferta?")) return;
    try {
        await client.from(table).delete().eq('id', id);
        loadMarketingData();
    } catch (err) { console.error(err); }
};
