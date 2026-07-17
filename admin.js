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

// ── QZ TRAY STATE ──
let _qzConnected = false;
let _selectedPrinter = localStorage.getItem('rioh_printer') || null;

// ── IMAGE HELPER ──
function getProductImage(productNameOrUrl) {
    if (productNameOrUrl) {
        if (productNameOrUrl.toLowerCase().includes('papas')) return 'papas.png';
        if (productNameOrUrl.toLowerCase().includes('nuggets')) return 'nuggets.png';
    }
    return 'burger1.png';
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
        initQZTray(); // intentar conectar ticketera silenciosamente
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

// ── QZ TRAY INIT ──
async function initQZTray() {
    if (typeof qz === 'undefined') { updateQZStatusUI(false); return; }

    // Modo sin firma digital (uso local/privado)
    qz.security.setCertificatePromise(function(resolve) { resolve(); });
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise(function(toSign, resolve) { resolve(); });

    // Suprimir errores de QZ en consola durante el intento de conexión
    qz.api.setErrorCallbacks(function() {});
    qz.api.setClosedCallbacks(function() {
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
        statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:12px;background:#ffebee;border:2px solid #c62828;">
            <span style="font-size:1.4rem;">🔴</span>
            <div>
                <div style="font-weight:700;font-size:0.9rem;color:#b71c1c;">QZ TRAY NO DETECTADO</div>
                <div style="font-size:0.78rem;color:#c62828;">Instalá QZ Tray para imprimir sin diálogos</div>
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
        select.innerHTML = printers.map(p =>
            `<option value="${p}" ${p === saved ? 'selected' : ''}>${p}</option>`
        ).join('');
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
        clientes: { nombre: 'Ticket de Prueba', whatsapp: '' },
        items: [{ qty: 1, title: 'MALBEC RICH', type: 'Simple', extras: ['Extra Bacon'], pricePerUnit: 9999 }],
        nota: ''
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
            if (!imagen_url) payload.imagen_url = getProductImage(payload.nombre);
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
        const imgSrc = p.imagen_url || getProductImage(p.nombre);
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

            return `<div class="kanban-card" onclick="openOrderDetail('${o.id}')">
                <div class="kanban-card-header">
                    <strong style="font-family:'Archivo Black'; font-size:0.88rem;">#${o.numero_pedido || '---'}</strong>
                    <small style="color:#888; white-space:nowrap;">${hora}</small>
                </div>
                <div style="font-size:0.83rem; font-weight:700;">${nombre}</div>
                ${tel ? `<div style="font-size:0.75rem; color:#888;">${tel}</div>` : ''}
                <div style="font-size:0.75rem; color:#666; margin-top:2px;">${entrega}</div>
                <div class="kanban-items">${items}</div>
                <div class="kanban-total">$${(o.total || 0).toLocaleString()}</div>
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
            <div class="order-item-qty">${i.qty}×</div>
            <div class="order-item-info">
                <div class="order-item-name">${i.title}${extrasCost}</div>
                ${i.type ? `<div class="order-item-type">${i.type}</div>` : ''}
                ${(i.extras && i.extras.length) ? `<div class="order-item-extras">+ ${i.extras.join(' · ')}</div>` : ''}
            </div>
            <div class="order-item-price">$${((i.pricePerUnit || 0) * (parseInt(i.qty) || 1)).toLocaleString()}</div>
        </div>`;
    }).join('');
    document.getElementById('od-items').innerHTML = itemsHtml || '<div style="color:#999;">Sin items</div>';

    // Pago
    document.getElementById('od-pago').textContent = pagoLabels[o.estado_pago] || '—';

    // Total
    document.getElementById('od-total').textContent = `$${(o.total || 0).toLocaleString()}`;

    // Botones de acción (duplicados del kanban pero dentro del modal)
    const nextLabel = { pendiente: 'CONFIRMAR PAGO', pendiente_efectivo: 'CONFIRMAR PAGO', pendiente_transferencia: 'CONFIRMAR PAGO', aprobado: 'EN PREPARACIÓN', preparacion: 'ENTREGADO ✓' };
    const prevLabel = { aprobado: '← Nuevo', preparacion: '← Pago OK', entregado: '← En prep.' };
    const estado = o.estado_pago || 'pendiente';
    let actionsHtml = '';
    if (prevLabel[estado]) {
        actionsHtml += `<button class="card-btn card-btn-back" style="flex:1;" onclick="retreatOrder('${o.id}','${estado}'); closeOrderDetailModal();">${prevLabel[estado]}</button>`;
    }
    if (nextLabel[estado]) {
        actionsHtml += `<button class="card-btn card-btn-advance" style="flex:2;" onclick="advanceOrder('${o.id}','${estado}'); closeOrderDetailModal();">${nextLabel[estado]} →</button>`;
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

        const isPending = actualState === 'pendiente' || actualState === 'pendiente_efectivo' || actualState === 'pendiente_transferencia';
        const willDeductStock = isPending && !orderCheck.stock_descontado;

        // Un solo UPDATE: estado + flag de stock juntos (evita una segunda espera)
        const updatePayload = { estado_pago: nextState };
        if (willDeductStock) updatePayload.stock_descontado = true;
        const { error } = await client.from('pedidos').update(updatePayload).eq('id', id);
        if (error) throw error;

        // Mover la ficha YA — no esperar a que termine el descuento de stock ni la impresión
        loadOrders();
        showStatusToast(willDeductStock ? 'PAGO CONFIRMADO — STOCK DESCONTADO' : `Pedido movido a ${nextState.toUpperCase()}`);

        // Descontar stock en segundo plano (no bloquea la UI)
        if (willDeductStock) {
            deductOrderStock(id).then(() => {
                if (document.getElementById('stock-section')?.classList.contains('active')) loadStockData();
            });
        }

        // 🖨️ Imprimir ticket al confirmar pago (pendiente → aprobado), también en segundo plano
        if (nextState === 'aprobado') {
            const metodoPago = {
                pendiente: 'Efectivo',
                pendiente_efectivo: 'Efectivo',
                pendiente_transferencia: 'Transferencia bancaria'
            }[actualState] || 'Efectivo';
            client.from('pedidos')
                .select('*, clientes(nombre, whatsapp, email)')
                .eq('id', id).single()
                .then(({ data: fullOrder }) => { if (fullOrder) printTicket(fullOrder, metodoPago); });
        }
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

        const productIds = [...new Set(order.items.filter(i => i.product_id).map(i => i.product_id))];

        // Precargar insumos y productos EN PARALELO (en vez de una consulta por item)
        const [{ data: allInsumos }, { data: allProductos }] = await Promise.all([
            client.from('insumos').select('id, nombre, stock_actual'),
            productIds.length ? client.from('productos').select('id, receta, stock').in('id', productIds) : Promise.resolve({ data: [] })
        ]);

        const insumosMap = {};
        (allInsumos || []).forEach(ins => { insumosMap[String(ins.id)] = ins; });
        const productosMap = {};
        (allProductos || []).forEach(p => { productosMap[String(p.id)] = p; });

        console.log("═══ DEDUCCIÓN DE STOCK — Pedido:", orderId, "═══");

        // Acumular todas las deducciones antes de aplicarlas
        const insumoDeductions = {};   // { insumo_id: totalToDeduct }
        const productoDeductions = {}; // { producto_id: totalToDeduct }

        for (const item of order.items) {
            if (!item.product_id) continue;
            const qty = parseInt(item.qty) || 1;
            const isDoble = (item.type || '').toLowerCase() === 'doble';

            const producto = productosMap[String(item.product_id)];
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

        // --- 3) Aplicar todas las deducciones acumuladas EN PARALELO ---
        // (ya tenemos el stock actual en memoria de la precarga, no hace falta re-consultarlo)
        const insumoUpdates = Object.entries(insumoDeductions).map(([insumoId, totalDeduct]) => {
            const current = insumosMap[insumoId]?.stock_actual ?? 0;
            const newStock = Math.max(0, current - totalDeduct);
            console.log(`  ✅ INSUMO "${insumosMap[insumoId]?.nombre || insumoId}": ${current} - ${totalDeduct} = ${newStock}`);
            return client.from('insumos').update({ stock_actual: newStock }).eq('id', insumoId);
        });

        const productoUpdates = Object.entries(productoDeductions).map(([prodId, totalDeduct]) => {
            const current = productosMap[prodId]?.stock ?? 0;
            const newStock = Math.max(0, current - totalDeduct);
            console.log(`  ✅ PRODUCTO ${prodId}: ${current} - ${totalDeduct} = ${newStock}`);
            return client.from('productos').update({ stock: newStock }).eq('id', prodId);
        });

        await Promise.all([...insumoUpdates, ...productoUpdates]);
        console.log("═══ DEDUCCIÓN COMPLETA — Pedido:", orderId, "═══");
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
        // Precargar productos para obtener imágenes del ranking
        const { data: productosData } = await client.from('productos').select('id, nombre, imagen_url');
        const productoImgMap = {};
        (productosData || []).forEach(p => { productoImgMap[p.nombre] = p.imagen_url || getProductImage(p.nombre); });

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

        const { data: pedidos, error } = await query;
        if (error) throw error;

        // ── MÉTRICAS: calcular todo desde los pedidos reales ──
        const totalPedidos = pedidos.length;
        const entregados = pedidos.filter(p => p.estado_pago === 'entregado').length;
        const confirmados = pedidos.filter(p => ['aprobado', 'preparacion', 'entregado'].includes(p.estado_pago));

        const totalSales = pedidos.reduce((acc, p) => acc + (p.total || 0), 0);
        const avgTicket = totalPedidos > 0 ? Math.round(totalSales / totalPedidos) : 0;

        // Contar burgers y items
        let totalBurgers = 0;
        const itemCounts = {};
        pedidos.forEach(p => {
            (p.items || []).forEach(i => {
                const title = i.title || '';
                const qty = parseInt(i.qty) || 1;
                const isBurger = !title.toLowerCase().includes('nuggets') && !title.toLowerCase().includes('papas');
                if (isBurger) totalBurgers += qty;
                itemCounts[title] = (itemCounts[title] || 0) + qty;
            });
        });

        // Top 2 burgers para subtítulo
        const topBurgers = Object.entries(itemCounts)
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
        document.getElementById('stats-ticket-sub').innerText = totalPedidos > 0 ? `sobre ${totalPedidos} pedidos` : '—';

        // ── Ranking Burgers con imágenes ──
        const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]);
        document.getElementById('best-sellers-list').innerHTML = sorted.map(([name, qty], i) => {
            const img = productoImgMap[name] || getProductImage(name);
            const highlight = i === 0 ? 'background:#FFF9C4; border:1px solid #FBC02D;' : '';
            return `<div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid #eee; ${highlight}">
                <img src="${img}" alt="${name}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid #111; flex-shrink:0;">
                <span style="flex:1;">${i + 1}. ${name}</span>
                <span style="font-weight:900; font-family:'Archivo Black'; white-space:nowrap;">${qty} U.</span>
            </div>`;
        }).join('') || '<div style="color:#999; padding:20px;">SIN DATOS</div>';

        // ── Últimas Ventas ──
        document.getElementById('recent-sales-log').innerHTML = pedidos.slice(0, 10).map(p => {
            const itemsStr = (p.items || []).map(i => {
                let s = `${i.qty}x ${i.title}`;
                if (i.extras && i.extras.length) s += ` +${i.extras.join(', ')}`;
                return s;
            }).join(', ');
            return `<div style="border-bottom: 1px dashed #eee; padding: 10px 0;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>#${p.numero_pedido || 'S/N'}</strong>
                    <span style="font-weight:900;">$${(p.total || 0).toLocaleString()}</span>
                </div>
                <div style="font-size:0.75rem; color:#555; margin-top:2px;">${itemsStr}</div>
                <small style="color:#888;">${new Date(p.created_at).toLocaleString('es-AR')} · ${p.clientes?.nombre || 'S/N'}</small>
            </div>`;
        }).join('') || '<div style="color:#999; padding:20px;">SIN VENTAS</div>';

        // ── Ranking de Clientes: computado desde los pedidos filtrados ──
        renderCustomerRanking(pedidos);

    } catch (err) { console.error("Dashboard Load Error:", err); }
}

function renderCustomerRanking(pedidos) {
    // Agrupar pedidos por cliente, usando cliente_id o user_id
    const clientMap = {}; // keyed by a unique client identifier

    pedidos.forEach(p => {
        const clienteData = p.clientes;
        const key = clienteData?.id || p.user_id || p.cliente_id || null;
        if (!key) return;

        if (!clientMap[key]) {
            clientMap[key] = {
                id: clienteData?.id || key,
                user_id: clienteData?.user_id || p.user_id || '',
                nombre: clienteData?.nombre || 'S/N',
                whatsapp: clienteData?.whatsapp || '',
                email: clienteData?.email || '',
                pedidos: 0,
                burgers: 0,
                total: 0
            };
        }

        clientMap[key].pedidos++;
        clientMap[key].total += (p.total || 0);

        (p.items || []).forEach(i => {
            const t = (i.type || '').toLowerCase();
            if (t === 'simple' || t === 'doble') {
                clientMap[key].burgers += (parseInt(i.qty) || 1);
            }
        });
    });

    // Ordenar por total gastado descendente
    const ranked = Object.values(clientMap).sort((a, b) => b.total - a.total);

    const tbody = document.getElementById('customer-ranking-body');
    if (!tbody) return;

    tbody.innerHTML = ranked.map((c, i) => {
        const ticket = c.pedidos > 0 ? Math.round(c.total / c.pedidos) : 0;
        const top = i === 0 ? 'background:#FFF9C4;' : '';
        const cid = c.id || '';
        return `<tr style="${top}">
            <td style="font-family:'Archivo Black';">${i + 1}</td>
            <td style="font-weight:700;">${c.nombre}</td>
            <td>${c.pedidos}</td>
            <td style="font-weight:900;">${c.burgers}</td>
            <td style="font-weight:900;">$${c.total.toLocaleString()}</td>
            <td>$${ticket.toLocaleString()}</td>
            <td><button class="qty-btn" style="font-size:0.7rem; padding:5px 10px;" onclick="openCustomerProfile('${cid}','${c.nombre.replace(/'/g, "\\'")}','${c.whatsapp}','${c.email}')">VER</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center; padding:20px; color:#999;">Sin datos de clientes</td></tr>';
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
        // Cargar clientes Y todos los pedidos para computar datos reales
        const [clientesRes, pedidosRes] = await Promise.all([
            client.from('clientes').select('*').order('created_at', { ascending: false }),
            client.from('pedidos').select('id, cliente_id, user_id, total, items, created_at')
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
            const clientPedidos = pedidosByClient[c.id] || pedidosByClient[c.user_id] || [];
            const totalGastado = clientPedidos.reduce((a, p) => a + (p.total || 0), 0);
            const pedidosCount = clientPedidos.length;

            // Burger favorita
            const burgerCounts = {};
            let lastOrderDate = null;
            clientPedidos.forEach(p => {
                if (p.created_at) {
                    const d = new Date(p.created_at);
                    if (!lastOrderDate || d > lastOrderDate) lastOrderDate = d;
                }
                (p.items || []).forEach(i => {
                    const t = (i.type || '').toLowerCase();
                    if (t === 'simple' || t === 'doble') {
                        burgerCounts[i.title] = (burgerCounts[i.title] || 0) + (parseInt(i.qty) || 1);
                    }
                });
            });
            const favBurger = Object.entries(burgerCounts).sort((a, b) => b[1] - a[1])[0];

            return {
                ...c,
                _pedidos: pedidosCount,
                _total: totalGastado,
                _ticket: pedidosCount > 0 ? Math.round(totalGastado / pedidosCount) : 0,
                _lastOrder: lastOrderDate,
                _favBurger: favBurger ? favBurger[0] : null,
                _favBurgerQty: favBurger ? favBurger[1] : 0,
                _burgerNames: Object.keys(burgerCounts)
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
                [...allBurgerNames].sort().map(b => `<option value="${b}">${b}</option>`).join('');
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
        const safeNombre = nombre.replace(/'/g, "\\'");
        const cid = c.id || '';
        return `<tr>
            <td style="font-family:'Archivo Black'; text-align:center;">${i + 1}</td>
            <td style="font-weight:700;">${nombre}</td>
            <td>${c.whatsapp || '—'}</td>
            <td style="font-size:0.82rem;">${c.email || '—'}</td>
            <td style="font-weight:900; text-align:center;">${c._pedidos}</td>
            <td style="font-weight:900; font-family:'Archivo Black';">$${c._total.toLocaleString()}</td>
            <td style="font-size:0.78rem;">${c._favBurger ? `🍔 ${c._favBurger}` : '—'}</td>
            <td style="font-size:0.78rem;">${alta}</td>
            <td style="font-size:0.82rem;">${lastOrder}</td>
            <td>
                <button class="qty-btn" style="font-size:0.7rem; padding:6px 14px;" onclick="openCustomerProfile('${cid}','${safeNombre}','${c.whatsapp || ''}','${c.email || ''}')">
                    <i data-lucide="eye" style="width:14px; height:14px; vertical-align:middle;"></i> VER
                </button>
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
    const win = window.open('', '_blank', 'width=360,height=720,toolbar=0,menubar=0,scrollbars=1,status=0,resizable=1');
    if (!win) {
        showStatusToast('⚠ Habilitá los popups para imprimir tickets');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.onload = function () { setTimeout(() => { win.focus(); win.print(); }, 400); };
    setTimeout(() => { if (win && !win.closed) { win.focus(); win.print(); } }, 1200);
}

// ── ESC/POS TICKET BUILDER ──
function buildESCPOSTicket(o, metodoPagoOverride) {
    const E = '\x1B'; const G = '\x1D';
    const INIT        = E + '\x40';
    const CENTER      = E + '\x61\x01';
    const LEFT        = E + '\x61\x00';
    const BOLD_ON     = E + '\x45\x01';
    const BOLD_OFF    = E + '\x45\x00';
    const WIDE        = G + '\x21\x11';   // doble ancho + alto
    const NORMAL      = G + '\x21\x00';   // tamaño normal
    const CUT         = G + '\x56\x41\x05'; // corte parcial + feed 5mm
    const FEED        = E + '\x64\x04';   // avance 4 líneas

    const W = 42; // caracteres por línea (80mm papel, Font A)
    const SEP1 = '-'.repeat(W);
    const SEP2 = '='.repeat(W);

    // Alinear columnas izq/der
    function row(l, r) {
        const sp = W - l.length - r.length;
        return l + ' '.repeat(Math.max(1, sp)) + r;
    }

    // Sólo ASCII (compatibilidad universal de code pages)
    function safe(s) {
        return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
    }

    const d = new Date(o.created_at);
    const DAYS = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab'];
    const fecha = `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const nombre  = safe(o.clientes?.nombre || 'S/N').substring(0, 32);
    const tel     = safe(o.clientes?.whatsapp || '');
    const esRetiro = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup';
    const dir     = safe(o.direccion_entrega || '').substring(0, 40);
    const metodo  = safe(metodoPagoOverride || {
        pendiente: 'Efectivo', pendiente_efectivo: 'Efectivo',
        pendiente_transferencia: 'Transferencia', aprobado: 'Pago confirmado',
        preparacion: 'Pago confirmado', entregado: 'Pago confirmado'
    }[o.estado_pago] || 'Efectivo');

    let t = '';
    t += INIT;

    // ── CABECERA ──
    t += CENTER + WIDE + 'RIOH.\n' + NORMAL;
    t += 'BURGER\n';
    t += SEP2 + '\n';
    t += BOLD_ON + `PEDIDO #${o.numero_pedido || '---'}\n` + BOLD_OFF;
    t += fecha + '\n' + SEP1 + '\n';

    // ── CLIENTE ──
    t += LEFT + BOLD_ON + nombre + '\n' + BOLD_OFF;
    if (tel) t += tel + '\n';

    // ── ENTREGA ──
    t += '\n' + BOLD_ON + (esRetiro ? 'RETIRO EN LOCAL' : 'DELIVERY') + '\n' + BOLD_OFF;
    if (!esRetiro && dir) t += dir + '\n';

    t += SEP2 + '\n';
    t += BOLD_ON + 'PRODUCTOS:\n' + BOLD_OFF + '\n';

    // ── ITEMS ──
    for (const i of (o.items || [])) {
        const qty = parseInt(i.qty) || 1;
        const precio = (i.pricePerUnit || 0) * qty;
        const title = safe(i.title.toUpperCase()).substring(0, 24);
        const right = precio > 0 ? `$${precio.toLocaleString('es-AR')}` : '';
        t += BOLD_ON + row(`${qty}x ${title}`, right) + '\n' + BOLD_OFF;
        if (i.type) t += `   (${safe(i.type)})\n`;
        if (i.extras?.length) t += `   +${safe(i.extras.join(', ')).substring(0, 36)}\n`;
    }

    // ── NOTA ──
    if (o.nota) {
        t += SEP1 + '\n';
        t += `"${safe(o.nota).substring(0, 80)}"\n`;
    }

    t += SEP1 + '\n';

    // ── TOTAL ──
    const totalStr = `$${(o.total || 0).toLocaleString('es-AR')}`;
    t += BOLD_ON + row('TOTAL:', totalStr) + '\n' + BOLD_OFF;
    t += metodo + '\n';

    t += SEP2 + '\n';

    // ── PIE ──
    t += CENTER + BOLD_ON + '* GRACIAS POR TU PEDIDO! *\n' + BOLD_OFF;
    t += 'riohburgers.com.ar\n';
    t += FEED + CUT;

    return t;
}

// Construye el HTML del ticket para 80mm de papel térmico
function buildReceiptHTML(o, metodoPagoOverride) {
    const d = new Date(o.created_at);
    const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const fecha = `${diasSemana[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} — ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

    const nombre = o.clientes?.nombre || 'Cliente S/N';
    const tel = o.clientes?.whatsapp || o.clientes?.phone || '';
    const esRetiro = o.metodo_entrega === 'takeaway' || o.metodo_entrega === 'pickup';
    const direccion = esRetiro ? '' : (o.direccion_entrega || '');

    const metodoPagoLabels = {
        pendiente: 'Efectivo',
        pendiente_efectivo: 'Efectivo',
        pendiente_transferencia: 'Transferencia bancaria',
        aprobado: 'Pago confirmado ✓',
        preparacion: 'Pago confirmado ✓',
        entregado: 'Pago confirmado ✓'
    };
    const metodoPago = metodoPagoOverride || metodoPagoLabels[o.estado_pago] || 'Efectivo';

    // Construir filas de items
    const itemsHtml = (o.items || []).map(i => {
        const qty = parseInt(i.qty) || 1;
        const precio = (i.pricePerUnit || 0) * qty;
        const tipoStr = i.type ? ` <span style="font-weight:normal;font-size:9px;">(${i.type})</span>` : '';
        const extrasStr = (i.extras && i.extras.length)
            ? `<div style="padding-left:14px;font-size:9px;color:#444;">+ ${i.extras.join(' · ')}</div>`
            : '';
        const precioStr = precio > 0 ? `$${precio.toLocaleString('es-AR')}` : '';
        return `<div style="margin-bottom:5px;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:4px;">
                <div style="flex:1;"><span style="font-weight:bold;">${qty}x ${i.title.toUpperCase()}${tipoStr}</span></div>
                <div style="font-weight:bold;white-space:nowrap;">${precioStr}</div>
            </div>
            ${extrasStr}
        </div>`;
    }).join('');

    const notaHtml = o.nota
        ? `<hr style="border:none;border-top:1px dashed #000;margin:5px 0;">
           <div style="font-size:9px;font-style:italic;color:#555;">📝 "${o.nota}"</div>`
        : '';

    const contactoHtml = tel
        ? `<div style="font-size:9px;">📱 ${tel}</div>`
        : '';
    const direccionHtml = direccion
        ? `<div style="font-size:9px;margin-top:2px;">${direccion}</div>`
        : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Ticket RIOH. #${o.numero_pedido || ''}</title>
<style>
  @page { size: 80mm auto; margin: 4mm 3mm; }
  @media print {
    body { width: 74mm !important; }
    .no-print { display: none !important; }
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    width: 74mm;
    max-width: 340px;
    background: #fff;
    color: #000;
    padding: 4px 0;
  }
  hr.dash  { border:none; border-top:1px dashed #000; margin:5px 0; }
  hr.solid { border:none; border-top:2px solid #000; margin:6px 0; }
</style>
</head>
<body>

<!-- BOTÓN IMPRIMIR (solo en pantalla) -->
<div class="no-print" style="text-align:center;padding:8px;background:#111;color:#fff;cursor:pointer;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;margin-bottom:8px;" onclick="window.print()">
  🖨️ IMPRIMIR TICKET
</div>

<!-- CABECERA -->
<div style="text-align:center;margin-bottom:4px;">
  <div style="font-family:'Arial Black',Arial,sans-serif;font-size:30px;font-weight:900;letter-spacing:4px;line-height:1;">RIOH.</div>
  <div style="font-size:9px;letter-spacing:5px;margin-top:1px;">BURGER</div>
</div>

<hr class="dash">

<div style="text-align:center;">
  <div style="font-family:'Arial Black',Arial,sans-serif;font-size:15px;font-weight:900;">PEDIDO #${o.numero_pedido || '---'}</div>
  <div style="font-size:10px;margin-top:1px;">${fecha}</div>
</div>

<hr class="dash">

<!-- CLIENTE -->
<div style="margin-bottom:4px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;">Cliente</div>
  <div style="font-weight:bold;font-size:12px;">${nombre}</div>
  ${contactoHtml}
</div>

<!-- ENTREGA -->
<div style="margin-bottom:2px;">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#666;">Entrega</div>
  <div style="font-weight:bold;font-size:12px;border:2px solid #000;display:inline-block;padding:1px 6px;margin-top:2px;">${esRetiro ? '🏠 RETIRO EN LOCAL' : '🛵 DELIVERY'}</div>
  ${direccionHtml}
</div>

<hr class="solid">

<!-- PRODUCTOS -->
<div style="font-family:'Arial Black',Arial,sans-serif;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Productos</div>

${itemsHtml}

${notaHtml}

<hr class="dash">

<!-- TOTAL -->
<div style="display:flex;justify-content:space-between;align-items:center;font-family:'Arial Black',Arial,sans-serif;font-size:16px;font-weight:900;margin:3px 0;">
  <span>TOTAL</span>
  <span>$${(o.total || 0).toLocaleString('es-AR')}</span>
</div>

<div style="font-size:10px;margin-top:2px;">💳 ${metodoPago}</div>

<hr class="solid">

<!-- PIE -->
<div style="text-align:center;font-size:10px;">
  <div style="font-family:'Arial Black',Arial,sans-serif;font-size:11px;font-weight:900;">★ ¡GRACIAS POR TU PEDIDO! ★</div>
  <div style="margin-top:2px;">riohburgers.com.ar</div>
</div>

</body>
</html>`;
}
