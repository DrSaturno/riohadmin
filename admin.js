// RIOH. ADMIN ENGINE

const ADMIN_USERS = {
    admin: 'riohadmin2025'
};
const SESSION_KEY = 'rioh_admin_v2';

// ── LOGIN SYSTEM ──
document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
        showAdminApp();
    }
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

let ordersFilter = 'hoy';
let ordersCustomRange = { from: null, to: null };
let ordersAutoRefreshTimer = null;
let currentRecipe = [];
let allIngredientesForRecipe = [];

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
    if (typeof window.supabase !== 'undefined') {
        client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        loadOrders();
        initRealtime();
        initForms();
        startOrdersAutoRefresh();
        loadStoreStatus();
        loadStoreHours();
        initProductImagePreview();
        loadIngredientesForRecipe();
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

// ── EXPORT: WHATSAPP ──
window.exportToWhatsApp = function () {
    const total = document.getElementById('stats-total-sales')?.innerText || '$0';
    const pedidos = document.getElementById('stats-orders-count')?.innerText || '0';
    const ticket = document.getElementById('stats-avg-ticket')?.innerText || '$0';
    const filters = { hoy: 'Hoy', semana: 'Semana', mes: 'Mes', trimestre: 'Trimestre', semestre: 'Semestre', custom: 'Rango personalizado' };
    const periodo = filters[currentFilter] || currentFilter;
    let sellers = '';
    const bestEl = document.getElementById('best-sellers-list');
    if (bestEl) {
        const rows = bestEl.querySelectorAll('div');
        rows.forEach((r, i) => { if (i < 3) sellers += `  ${r.textContent.trim()}\n`; });
    }
    const text = `🍔 *RIOH. Burgers — Resumen ${periodo}*\n\n💰 Ventas: *${total}*\n📦 Pedidos: *${pedidos}*\n🎯 Ticket promedio: *${ticket}*\n\n🏆 Top productos:\n${sellers || '  Sin datos'}\n\n_Panel RIOH.ADMIN_`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
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
            document.getElementById('hours-status').innerHTML =
                `<strong>Configuración actual:</strong> ${daysText || 'Sin días'} de ${h.hora_apertura || '--:--'} a ${h.hora_cierre || '--:--'}`;
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

function initProductImagePreview() {
    const input = document.getElementById('prod-imagen');
    if (!input) return;
    input.addEventListener('change', () => {
        const file = input.files[0];
        const preview = document.getElementById('prod-img-preview');
        if (file) {
            preview.src = URL.createObjectURL(file);
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }
    });
}

async function loadIngredientesForRecipe() {
    if (!client) return;
    try {
        const { data } = await client.from('insumos').select('*').order('nombre');
        allIngredientesForRecipe = data || [];
        const select = document.getElementById('recipe-ingredient-select');
        if (select) {
            select.innerHTML = '<option value="">Seleccionar ingrediente...</option>' +
                allIngredientesForRecipe.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad})</option>`).join('');
        }
    } catch (e) { console.error("Error loading ingredientes for recipe:", e); }
}

window.addRecipeIngredient = function () {
    const select = document.getElementById('recipe-ingredient-select');
    const qtyInput = document.getElementById('recipe-ingredient-qty');
    const id = select.value;
    const qty = parseFloat(qtyInput.value);
    if (!id || !qty || qty <= 0) { showStatusToast('Seleccioná ingrediente y cantidad'); return; }
    if (currentRecipe.find(r => String(r.ingrediente_id) === String(id))) { showStatusToast('Ingrediente ya agregado'); return; }
    const ing = allIngredientesForRecipe.find(i => String(i.id) === String(id));
    if (!ing) return;
    currentRecipe.push({ ingrediente_id: ing.id, nombre: ing.nombre, cantidad: qty, unidad: ing.unidad });
    renderRecipeList();
    select.value = '';
    qtyInput.value = '';
};

window.removeRecipeIngredient = function (ingredienteId) {
    currentRecipe = currentRecipe.filter(r => String(r.ingrediente_id) !== String(ingredienteId));
    renderRecipeList();
};

function renderRecipeList() {
    const container = document.getElementById('recipe-list');
    if (!container) return;
    if (!currentRecipe.length) {
        container.innerHTML = '<div style="color:#999; font-size:0.85rem; padding:8px;">Sin ingredientes asignados</div>';
        return;
    }
    container.innerHTML = currentRecipe.map(r => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border:2px solid #eee; margin-bottom:4px; background:#fafafa;">
            <span style="font-weight:700;">${r.nombre}</span>
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-weight:900;">${r.cantidad} ${r.unidad}</span>
                <button type="button" class="qty-btn" style="font-size:0.7rem; padding:4px 8px; color:var(--primary);" onclick="removeRecipeIngredient('${r.ingrediente_id}')">✕</button>
            </div>
        </div>
    `).join('');
}

window.toggleDoblePrice = function () {
    const cat = document.getElementById('prod-categoria').value;
    document.getElementById('prod-doble-wrap').style.display = cat === 'burgers' ? 'flex' : 'none';
};

async function uploadProductImage(file) {
    const ext = file.name.split('.').pop();
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const filePath = `products/${fileName}`;

    const { error } = await client.storage.from('product-images').upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
    });

    if (error) throw error;

    const { data } = client.storage.from('product-images').getPublicUrl(filePath);
    return data.publicUrl;
}

window.handleProductSubmit = async function (e) {
    e.preventDefault();
    const editId = document.getElementById('prod-edit-id').value;
    const submitBtn = document.getElementById('product-submit-btn');
    submitBtn.textContent = editId ? 'GUARDANDO...' : 'CREANDO...';
    submitBtn.disabled = true;

    try {
        let imagen_url = null;
        const fileInput = document.getElementById('prod-imagen');
        if (fileInput.files[0]) {
            imagen_url = await uploadProductImage(fileInput.files[0]);
        }

        const payload = {
            nombre: document.getElementById('prod-nombre').value.trim(),
            categoria: document.getElementById('prod-categoria').value,
            precio_simple: parseFloat(document.getElementById('prod-precio-simple').value) || 0,
            precio_doble: parseFloat(document.getElementById('prod-precio-doble').value) || 0,
            descripcion: document.getElementById('prod-descripcion').value.trim(),
            ingredientes: currentRecipe.map(r => `${r.nombre} (${r.cantidad} ${r.unidad})`).join(', '),
            receta: { ingredientes: currentRecipe },
            stock: parseInt(document.getElementById('prod-stock').value) || 0,
            destacado: document.getElementById('prod-destacado').checked,
            activo: document.getElementById('prod-activo').checked
        };

        if (imagen_url) payload.imagen_url = imagen_url;

        if (editId) {
            const { error } = await client.from('productos').update(payload).eq('id', editId);
            if (error) throw error;
            showStatusToast('PRODUCTO ACTUALIZADO');
        } else {
            if (!imagen_url) payload.imagen_url = 'burger1.png';
            const { error } = await client.from('productos').insert(payload);
            if (error) throw error;
            showStatusToast('PRODUCTO CREADO');
        }

        cancelProductEdit();
        loadProductos();
    } catch (err) {
        console.error("Product save error:", err);
        showStatusToast('Error al guardar producto: ' + (err.message || ''));
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editId ? 'GUARDAR CAMBIOS' : 'CREAR PRODUCTO';
    }
};

window.loadProductos = async function () {
    if (!client) return;
    try {
        const { data, error } = await client.from('productos').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        renderProductosTable(data || []);
    } catch (err) { console.error("Products load error:", err); }
};

function renderProductosTable(productos) {
    const tbody = document.getElementById('productos-table-body');
    if (!tbody) return;

    if (!productos.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">Sin productos</td></tr>';
        return;
    }

    tbody.innerHTML = productos.map(p => {
        const imgSrc = p.imagen_url || 'burger1.png';
        const statusBadge = p.activo
            ? '<span class="status-badge status-ok">ACTIVO</span>'
            : '<span class="status-badge status-inactive">INACTIVO</span>';
        const stockBadge = (p.stock !== null && p.stock !== undefined && p.stock <= 0)
            ? '<span style="color:var(--primary); font-weight:900;">AGOTADO</span>'
            : (p.stock || 0);

        return `<tr>
            <td><img src="${imgSrc}" class="product-table-img" alt="${p.nombre}"></td>
            <td>
                <strong style="font-family:'Archivo Black';">${p.nombre}</strong>
                ${p.destacado ? ' ⭐' : ''}
                ${(() => { const ri = p.receta?.ingredientes; const txt = ri?.length ? ri.map(r => r.nombre).join(', ') : (p.ingredientes || ''); return txt ? `<br><small style="color:#888;">${txt.substring(0, 60)}${txt.length > 60 ? '...' : ''}</small>` : ''; })()}
            </td>
            <td>${(p.categoria || '').toUpperCase()}</td>
            <td>$${(p.precio_simple || 0).toLocaleString()}</td>
            <td>${p.precio_doble ? '$' + p.precio_doble.toLocaleString() : '—'}</td>
            <td>${stockBadge}</td>
            <td>${statusBadge}</td>
            <td style="white-space:nowrap;">
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="editProduct('${p.id}')">EDITAR</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="toggleProductActive('${p.id}', ${p.activo})">${p.activo ? 'DESACTIVAR' : 'ACTIVAR'}</button>
                <button class="qty-btn" style="font-size:0.7rem; padding:5px 10px; color:var(--primary);" onclick="deleteProduct('${p.id}')">ELIMINAR</button>
            </td>
        </tr>`;
    }).join('');
}

window.editProduct = async function (id) {
    if (!client) return;
    try {
        const { data, error } = await client.from('productos').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('prod-edit-id').value = data.id;
        document.getElementById('prod-nombre').value = data.nombre || '';
        document.getElementById('prod-categoria').value = data.categoria || 'burgers';
        document.getElementById('prod-precio-simple').value = data.precio_simple || '';
        document.getElementById('prod-precio-doble').value = data.precio_doble || '';
        document.getElementById('prod-descripcion').value = data.descripcion || '';
        currentRecipe = (data.receta && data.receta.ingredientes) ? data.receta.ingredientes : [];
        renderRecipeList();
        document.getElementById('prod-stock').value = data.stock || 0;
        document.getElementById('prod-destacado').checked = data.destacado || false;
        document.getElementById('prod-activo').checked = data.activo !== false;

        const preview = document.getElementById('prod-img-preview');
        if (data.imagen_url) {
            preview.src = data.imagen_url;
            preview.style.display = 'block';
        }
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
    document.getElementById('prod-img-preview').style.display = 'none';
    const hint = document.getElementById('prod-img-hint');
    if (hint) hint.textContent = 'Formatos: JPG, PNG, WEBP';
    document.getElementById('product-form-title').textContent = 'NUEVO PRODUCTO';
    document.getElementById('product-submit-btn').textContent = 'CREAR PRODUCTO';
    document.getElementById('product-cancel-btn').style.display = 'none';
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

window.deleteProduct = async function (id) {
    if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
    try {
        const { error } = await client.from('productos').delete().eq('id', id);
        if (error) throw error;
        loadProductos();
        showStatusToast('PRODUCTO ELIMINADO');
    } catch (err) { showStatusToast('Error al eliminar producto'); }
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
    if (sectionId === 'productos') { loadProductos(); loadIngredientesForRecipe(); }
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
            const d = new Date(o.created_at);
            const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            const items = (o.items || []).map(i => {
                const extrasStr = (i.extras && i.extras.length) ? ` <small style="color:var(--primary); font-weight:700;">+ ${i.extras.join(', ')}</small>` : '';
                return `<div>${i.qty}x ${i.title} <small style="color:#999;">(${i.type || '-'})</small>${extrasStr}</div>`;
            }).join('');
            const entrega = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup' ? '🏠 Retiro' : `🛵 ${o.direccion_entrega || 'Delivery'}`;

            const actionRow = estado !== 'entregado'
                ? `<div class="card-actions">
                    ${prevLabel[estado] ? `<button class="card-btn card-btn-back" onclick="retreatOrder('${o.id}','${estado}')">${prevLabel[estado]}</button>` : ''}
                    <button class="card-btn card-btn-advance" onclick="advanceOrder('${o.id}','${estado}')">${nextLabel[estado]} →</button>
                    <button class="card-btn card-btn-delete" onclick="deleteKanbanOrder('${o.id}')"><i data-lucide="trash-2" style="width:12px;"></i></button>
                   </div>`
                : `<div class="card-actions">
                    <button class="card-btn card-btn-back" style="flex:1;" onclick="retreatOrder('${o.id}','${estado}')">${prevLabel[estado]}</button>
                   </div>`;

            return `<div class="kanban-card">
                <div class="kanban-card-header">
                    <strong style="font-family:'Archivo Black'; font-size:0.88rem;">#${o.numero_pedido || '---'}</strong>
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

    // ── CALCULAR Y MOSTRAR MÉTRICAS ──
    updatePedidosMetrics(orders);

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── MÉTRICAS DE PEDIDOS ──
let _lastOrdersForReport = [];

function updatePedidosMetrics(orders) {
    _lastOrdersForReport = orders;

    const totalPedidos = orders.length;
    const entregados = orders.filter(o => o.estado_pago === 'entregado').length;
    const enProceso = orders.filter(o => o.estado_pago === 'aprobado' || o.estado_pago === 'preparacion').length;

    // Contar burgers (solo categoría burgers, no nuggets/papas)
    let totalBurgers = 0;
    let detalleItems = {};
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
}

// ── WHATSAPP SHARE ──
window.shareOrdersWhatsApp = function () {
    const orders = _lastOrdersForReport;
    if (!orders.length) { showStatusToast('No hay pedidos para compartir'); return; }

    const confirmados = orders.filter(o => ['aprobado', 'preparacion', 'entregado'].includes(o.estado_pago));
    const facturado = confirmados.reduce((sum, o) => sum + (o.total || 0), 0);
    const ticket = confirmados.length > 0 ? Math.round(facturado / confirmados.length) : 0;

    let totalBurgers = 0;
    let detalleItems = {};
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
    msg += `• Ticket promedio: *$${ticket.toLocaleString()}*\n\n`;

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

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
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
    let detalleItems = {};
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
            if (i.extras && i.extras.length) s += ` +${i.extras.join(', ')}`;
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
        // SIEMPRE leer estado real de la DB (no confiar en el parámetro de la UI)
        const { data: orderCheck } = await client.from('pedidos').select('estado_pago, stock_descontado').eq('id', id).single();
        if (!orderCheck) return;

        const actualState = orderCheck.estado_pago;
        const next = {
            pendiente: 'aprobado',
            pendiente_efectivo: 'aprobado',
            pendiente_transferencia: 'aprobado',
            aprobado: 'preparacion',
            preparacion: 'entregado'
        };

        const nextState = next[actualState];
        if (!nextState) return;

        // Actualizar estado
        const { error } = await client.from('pedidos').update({ estado_pago: nextState }).eq('id', id);
        if (error) throw error;

        // Descontar stock SOLO si: viene de pendiente Y no se descontó antes
        const isPending = actualState === 'pendiente' || actualState === 'pendiente_efectivo' || actualState === 'pendiente_transferencia';
        if (isPending && !orderCheck.stock_descontado) {
            await deductOrderStock(id);
            // Marcar como descontado para evitar doble deducción
            await client.from('pedidos').update({ stock_descontado: true }).eq('id', id);
            showStatusToast('PAGO CONFIRMADO — STOCK DESCONTADO');
        } else {
            showStatusToast(`Pedido movido a ${nextState.toUpperCase()}`);
        }

        loadOrders();
        if (document.getElementById('stock-section')?.classList.contains('active')) loadStockData();
    } catch (err) {
        console.error("Error advancing order:", err);
        showStatusToast("Error al actualizar pedido");
    }
};

async function deductOrderStock(orderId) {
    // Mapa de extras → qué insumo buscar y cuánto descontar por cada extra
    const EXTRAS_INSUMO_MAP = {
        'Medallón Extra':  { buscar: 'medallón', cantidad: 1 },
        'Extra Cheddar':   { buscar: 'cheddar',  cantidad: 2 },
        'Extra Bacon':     { buscar: 'panceta ahumada', cantidad: 2 }
    };

    try {
        const { data: order } = await client.from('pedidos').select('items').eq('id', orderId).single();
        if (!order || !order.items) { console.warn("deductOrderStock: no items found for order", orderId); return; }

        console.log("═══ DEDUCCIÓN DE STOCK — Pedido:", orderId, "═══");
        console.log("Items del pedido:", JSON.stringify(order.items, null, 2));

        // Precargar TODOS los insumos para poder buscar extras por nombre
        const { data: allInsumos } = await client.from('insumos').select('id, nombre, stock_actual');
        const insumosMap = {};
        if (allInsumos) {
            allInsumos.forEach(ins => { insumosMap[String(ins.id)] = ins; });
        }
        console.log("Insumos cargados:", allInsumos ? allInsumos.map(i => `${i.id}:${i.nombre}`).join(', ') : 'ninguno');

        // Acumular todas las deducciones antes de aplicarlas
        const insumoDeductions = {};   // { insumo_id: totalToDeduct }
        const productoDeductions = {}; // { producto_id: totalToDeduct }

        for (const item of order.items) {
            if (!item.product_id) continue;
            const qty = parseInt(item.qty) || 1;
            const isDoble = (item.type || '').toLowerCase() === 'doble';

            console.log(`\n── Item: ${item.title} | Tipo: ${item.type || '-'} (isDoble=${isDoble}) | Qty: ${qty} | Extras: ${JSON.stringify(item.extras || [])}`);

            const { data: producto } = await client.from('productos').select('receta, stock').eq('id', item.product_id).single();
            if (!producto) { console.warn("  ⚠ Producto no encontrado:", item.product_id); continue; }

            // --- 1) Deducciones por RECETA del producto ---
            if (producto.receta && producto.receta.ingredientes && producto.receta.ingredientes.length > 0) {
                for (const ri of producto.receta.ingredientes) {
                    const baseQty = parseFloat(ri.cantidad) || 0;
                    let typeFactor = 1;
                    if (isDoble && ri.doble_mult) {
                        typeFactor = parseFloat(ri.doble_mult);
                    }
                    const deductAmount = baseQty * typeFactor * qty;
                    const ingId = String(ri.ingrediente_id);
                    insumoDeductions[ingId] = (insumoDeductions[ingId] || 0) + deductAmount;
                    console.log(`  📦 Receta → ${ri.nombre}: base=${baseQty} × factor=${typeFactor} × qty=${qty} = ${deductAmount}`);
                }
            } else if (producto.stock !== null && producto.stock !== undefined) {
                // Producto sin receta (ej: nuggets, papas): descontar stock directo
                const prodId = String(item.product_id);
                productoDeductions[prodId] = (productoDeductions[prodId] || 0) + qty;
                console.log(`  📦 Producto directo → ${item.title}: qty=${qty}`);
            }

            // --- 2) Deducciones por EXTRAS del item ---
            if (item.extras && item.extras.length > 0) {
                for (const extraName of item.extras) {
                    const mapping = EXTRAS_INSUMO_MAP[extraName];
                    if (!mapping) {
                        console.warn(`  ⚠ Extra "${extraName}" no tiene mapeo de insumo definido`);
                        continue;
                    }
                    // Buscar el insumo por nombre (case-insensitive, parcial)
                    const matchedInsumo = allInsumos ? allInsumos.find(ins =>
                        ins.nombre.toLowerCase().includes(mapping.buscar.toLowerCase())
                    ) : null;
                    if (!matchedInsumo) {
                        console.warn(`  ⚠ No se encontró insumo para extra "${extraName}" (buscando "${mapping.buscar}")`);
                        continue;
                    }
                    const deductAmount = mapping.cantidad * qty;
                    const ingId = String(matchedInsumo.id);
                    insumoDeductions[ingId] = (insumoDeductions[ingId] || 0) + deductAmount;
                    console.log(`  🔥 Extra → "${extraName}" → insumo "${matchedInsumo.nombre}" (id:${ingId}): ${mapping.cantidad} × qty=${qty} = ${deductAmount}`);
                }
            }
        }

        // --- 3) Aplicar todas las deducciones acumuladas ---
        console.log("\n── Aplicando deducciones ──");

        // Insumos
        for (const [insumoId, totalDeduct] of Object.entries(insumoDeductions)) {
            const { data: ing } = await client.from('insumos').select('stock_actual').eq('id', insumoId).single();
            if (ing) {
                const newStock = Math.max(0, ing.stock_actual - totalDeduct);
                const nombre = insumosMap[insumoId] ? insumosMap[insumoId].nombre : insumoId;
                console.log(`  ✅ INSUMO "${nombre}" (${insumoId}): ${ing.stock_actual} - ${totalDeduct} = ${newStock}`);
                await client.from('insumos').update({ stock_actual: newStock }).eq('id', insumoId);
            }
        }

        // Productos sin receta
        for (const [prodId, totalDeduct] of Object.entries(productoDeductions)) {
            const { data: prod } = await client.from('productos').select('stock').eq('id', prodId).single();
            if (prod) {
                const newStock = Math.max(0, prod.stock - totalDeduct);
                console.log(`  ✅ PRODUCTO ${prodId}: ${prod.stock} - ${totalDeduct} = ${newStock}`);
                await client.from('productos').update({ stock: newStock }).eq('id', prodId);
            }
        }

        console.log("\n═══ DEDUCCIÓN COMPLETA — Pedido:", orderId, "═══");
    } catch (e) { console.error("Error deducting stock:", e); }
}

window.retreatOrder = async function (id, _uiState) {
    try {
        // Leer estado real de la DB
        const { data: orderCheck } = await client.from('pedidos').select('estado_pago').eq('id', id).single();
        if (!orderCheck) return;

        const prev = { aprobado: 'pendiente', preparacion: 'aprobado', entregado: 'preparacion' };
        const prevState = prev[orderCheck.estado_pago];
        if (!prevState) return;

        // Retroceder estado. NOTA: stock_descontado se mantiene en true
        // para evitar doble deducción si lo vuelven a avanzar
        const { error } = await client.from('pedidos').update({ estado_pago: prevState }).eq('id', id);
        if (error) throw error;
        loadOrders();
        showStatusToast(`Pedido retrocedido a ${prevState.toUpperCase()}`);
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

        document.getElementById('recent-sales-log').innerHTML = pedidos.slice(0, 10).map(p => `
            <div style="border-bottom: 1px dashed #eee; padding: 10px 0;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>#${p.numero_pedido || 'S/N'}</strong>
                    <span>$${(p.total || 0).toLocaleString()}</span>
                </div>
                <small style="color:#888;">${new Date(p.created_at).toLocaleString('es-AR')}</small>
            </div>
        `).join('') || '<div style="color:#999; padding:20px;">SIN VENTAS</div>';

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
        const pedidos = pedidosRes.data || [];

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
            const ticket = c.pedidos_count > 0 ? Math.round((c.total_gastado || 0) / c.pedidos_count) : 0;
            const burgers = burgerMap[c.user_id] || 0;
            const top = i === 0 ? 'background:#FFF9C4;' : '';
            return `<tr style="${top}">
                <td style="font-family:'Archivo Black';">${i + 1}</td>
                <td style="font-weight:700;">${c.nombre || 'S/N'}</td>
                <td>${c.pedidos_count || 0}</td>
                <td style="font-weight:900;">${burgers}</td>
                <td style="font-weight:900;">$${(c.total_gastado || 0).toLocaleString()}</td>
                <td>$${ticket.toLocaleString()}</td>
                <td><button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="openCustomerProfile('${c.user_id}','${(c.nombre || '').replace(/'/g, "\\'")}','${c.whatsapp || ''}','${c.email || ''}')">VER</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">Sin datos de clientes</td></tr>';

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
    const burgersReset = document.getElementById('profile-burgers');
    if (burgersReset) burgersReset.innerHTML = '';

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

        const avgTicket = pedidos.length > 0 ? Math.round(totalGastado / pedidos.length) : 0;

        document.getElementById('profile-stats').innerHTML = `
            <div class="profile-stat"><div class="ps-label">Pedidos</div><div class="ps-value">${pedidos.length}</div></div>
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
                        <strong style="font-family:'Archivo Black';">#${p.numero_pedido || 'S/N'} — ${fecha} ${hora}</strong>
                        <span style="font-size:0.7rem; font-weight:700; color:${estadoColor[p.estado_pago] || '#999'}; text-transform:uppercase;">${p.estado_pago || 'pendiente'}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#555; margin-bottom:4px;">${items}</div>
                    <div style="text-align:right; font-family:'Archivo Black';">$${(p.total || 0).toLocaleString()}</div>
                </div>`;
            }).join('');

        // Burger ranking
        const burgerCounts = {};
        pedidos.forEach(p => {
            (p.items || []).forEach(i => {
                if (i.title) {
                    const key = i.title;
                    burgerCounts[key] = (burgerCounts[key] || 0) + (i.qty || 1);
                }
            });
        });
        const sortedBurgers = Object.entries(burgerCounts).sort((a, b) => b[1] - a[1]);

        const burgersEl = document.getElementById('profile-burgers');
        if (burgersEl) {
            if (sortedBurgers.length > 0) {
                burgersEl.innerHTML =
                    `<h3 style="font-family:'Archivo Black'; font-size:0.85rem; text-transform:uppercase; margin:1.5rem 0 0.8rem; padding-bottom:0.5rem; border-bottom:3px solid #111;">
                        Ranking de Favoritos
                    </h3>` +
                    sortedBurgers.map(([name, count], idx) =>
                        `<div class="profile-burger-rank${idx === 0 ? ' top-burger' : ''}">
                            <span class="rank-name">${idx === 0 ? '&#127942; ' : (idx + 1) + '. '}${name}</span>
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
            return `<tr>
                <td><strong>${i.nombre}</strong></td>
                <td style="font-size:1.1rem; font-weight:900;">${i.stock_actual} <small style="color:#888;">${i.unidad}</small></td>
                <td>${i.stock_minimo}</td>
                <td><span class="status-badge ${sClass}">${sText}</span></td>
                <td style="white-space:nowrap;">
                    <button class="qty-btn" style="padding:7px 10px;" onclick="quickUpdateStock('${i.id}', 1)" title="Sumar 1">
                        <i data-lucide="plus" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px;" onclick="quickUpdateStock('${i.id}', -1)" title="Restar 1">
                        <i data-lucide="minus" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px;" onclick="editInsumoMinimo('${i.id}', ${i.stock_minimo})" title="Editar mínimo">
                        <i data-lucide="pencil" style="width:14px; height:14px;"></i>
                    </button>
                    <button class="qty-btn" style="padding:7px 10px; margin-left:4px; color:var(--primary);" onclick="deleteInsumo('${i.id}')" title="Eliminar">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
                    </button>
                </td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" style="text-align:center; padding:20px; color:#999;">Sin insumos cargados</td></tr>';

        const select = document.getElementById('stock-insumo-select');
        if (select) select.innerHTML = '<option value="">Seleccionar insumo...</option>' + data.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad})</option>`).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) { console.error("Stock Load Error:", err); }
}

// Crear nuevo insumo
window.handleNewInsumo = async function (e) {
    e.preventDefault();
    const nombre = document.getElementById('new-insumo-nombre').value.trim();
    const unidad = document.getElementById('new-insumo-unidad').value;
    const stock_actual = parseFloat(document.getElementById('new-insumo-stock').value) || 0;
    const stock_minimo = parseFloat(document.getElementById('new-insumo-minimo').value) || 0;
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
    if (!id || isNaN(qty)) { showStatusToast('Seleccioná insumo y cantidad'); return; }

    try {
        let newQty = qty;
        if (action === 'add') {
            const current = allInsumos.find(i => String(i.id) === String(id));
            newQty = (current ? current.stock_actual : 0) + qty;
        } else if (action === 'subtract') {
            const current = allInsumos.find(i => String(i.id) === String(id));
            newQty = Math.max(0, (current ? current.stock_actual : 0) - qty);
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
        const newVal = Math.max(0, item.stock_actual + change);
        await client.from('insumos').update({ stock_actual: newVal }).eq('id', id);
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
    if (!confirm('¿Eliminar este insumo? Si está en recetas de productos, podrían quedar inconsistentes.')) return;
    try {
        const { error } = await client.from('insumos').delete().eq('id', id);
        if (error) throw error;
        showStatusToast('INSUMO ELIMINADO');
        loadStockData();
        loadIngredientesForRecipe();
    } catch (err) {
        console.error(err);
        showStatusToast('Error al eliminar');
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
        showStatusToast("¡Oferta creada!");
        e.target.reset();
        window.toggleMarketingFields();
        loadMarketingData();
    } catch (err) { console.error(err); showStatusToast("Error al crear. ¿Código duplicado?"); }
}

window.deleteOffer = async function (id, table) {
    if (!confirm("¿Eliminar esta oferta?")) return;
    try {
        await client.from(table).delete().eq('id', id);
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
        // Load all clients
        const { data: clientes, error } = await client
            .from('clientes')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        allCRMClients = clientes || [];

        // Calculate stats
        const total = allCRMClients.length;
        const withOrders = allCRMClients.filter(c => (c.pedidos_count || 0) > 0).length;
        const totalGastado = allCRMClients.reduce((a, c) => a + (c.total_gastado || 0), 0);
        const totalPedidos = allCRMClients.reduce((a, c) => a + (c.pedidos_count || 0), 0);
        const avgTicket = totalPedidos > 0 ? Math.round(totalGastado / totalPedidos) : 0;

        // New in last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newClients = allCRMClients.filter(c => c.created_at && new Date(c.created_at) >= thirtyDaysAgo).length;

        document.getElementById('crm-total-clients').textContent = total;
        document.getElementById('crm-with-orders').textContent = withOrders;
        document.getElementById('crm-avg-ticket').textContent = `$${avgTicket.toLocaleString()}`;
        document.getElementById('crm-new-30d').textContent = newClients;

        // Sort by total_gastado descending for table display
        const sorted = [...allCRMClients].sort((a, b) => (b.total_gastado || 0) - (a.total_gastado || 0));
        renderCRMTable(sorted);

    } catch (err) {
        console.error("CRM Load Error:", err);
        showStatusToast("Error cargando CRM");
    }
}

function renderCRMTable(clientes) {
    const tbody = document.getElementById('crm-table-body');
    if (!tbody) return;

    if (!clientes.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px; color:#999;">Sin clientes registrados</td></tr>';
        return;
    }

    tbody.innerHTML = clientes.map((c, i) => {
        const lastOrder = c.ultima_compra
            ? new Date(c.ultima_compra).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '—';
        const nombre = c.nombre || 'S/N';
        const safeNombre = nombre.replace(/'/g, "\\'");
        return `<tr>
            <td style="font-family:'Archivo Black'; text-align:center;">${i + 1}</td>
            <td style="font-weight:700;">${nombre}</td>
            <td>${c.whatsapp || '—'}</td>
            <td style="font-size:0.82rem;">${c.email || '—'}</td>
            <td style="font-weight:900; text-align:center;">${c.pedidos_count || 0}</td>
            <td style="font-weight:900; font-family:'Archivo Black';">$${(c.total_gastado || 0).toLocaleString()}</td>
            <td style="font-size:0.82rem;">${lastOrder}</td>
            <td>
                <button class="qty-btn" style="font-size:0.7rem; padding:6px 14px;" onclick="openCustomerProfile('${c.user_id}','${safeNombre}','${c.whatsapp || ''}','${c.email || ''}')">
                    <i data-lucide="eye" style="width:14px; height:14px; vertical-align:middle;"></i> VER
                </button>
            </td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.filterCRMTable = function () {
    const query = (document.getElementById('crm-search')?.value || '').toLowerCase().trim();
    if (!query) {
        const sorted = [...allCRMClients].sort((a, b) => (b.total_gastado || 0) - (a.total_gastado || 0));
        renderCRMTable(sorted);
        return;
    }
    const filtered = allCRMClients
        .filter(c =>
            (c.nombre || '').toLowerCase().includes(query) ||
            (c.email || '').toLowerCase().includes(query) ||
            (c.whatsapp || '').includes(query)
        )
        .sort((a, b) => (b.total_gastado || 0) - (a.total_gastado || 0));
    renderCRMTable(filtered);
};
