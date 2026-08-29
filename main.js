// 0. DEBUG & ERROR HANDLING
window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error("DEBUG INFO:", msg, "at line", lineNo);
    return false;
};

// 1. LOADER DISMISSAL
const loader = document.getElementById('loader');
function dismissLoader() {
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

// 1.1 CUSTOM ALERT MODAL
window.showAlert = function (title, message) {
    const alertModal = document.getElementById('alert-modal');
    const alertTitle = document.getElementById('alert-title');
    const alertMsg = document.getElementById('alert-message');

    if (alertModal && alertTitle && alertMsg) {
        alertTitle.innerText = title;
        alertMsg.innerText = message;
        alertModal.classList.add('active');
    } else {
        alert(message); // Fallback
    }
}

window.closeAlertModal = function () {
    const alertModal = document.getElementById('alert-modal');
    if (alertModal) alertModal.classList.remove('active');
}
if (document.readyState === 'complete') dismissLoader();
else window.addEventListener('load', dismissLoader);
setTimeout(dismissLoader, 1000);

// 2. SUPABASE CONFIG
const SUPABASE_URL = 'https://xjoyrjzvdfwavnvnfnvt.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhqb3lyanp2ZGZ3YXZudm5mbnZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NzIxMDYsImV4cCI6MjA4NjQ0ODEwNn0.Uw0MwDvBPtRjyMCt2ZA-kMYvVmIhUPXPP52AJo4a14Y';
let supabaseClient = null;
let currentUser = null;
let pendingAfterAuth = null;

function initSupabase() {
    if (typeof window.supabase === 'undefined') {
        console.error("Supabase SDK not found");
        return false;
    }

    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("Supabase initialized successfully");
        return true;
    } catch (error) {
        console.error("Supabase initialization failed:", error);
        supabaseClient = null;
        return false;
    }
}

function showCatalogStartupError() {
    const loadingMessage = document.querySelector('.catalog-loading');
    if (!loadingMessage) return;
    loadingMessage.textContent = 'NO SE PUDO CARGAR LA TIENDA. RECARGA LA PAGINA.';
    loadingMessage.setAttribute('role', 'alert');
}

// 3. APP STATE
let menuData = [];
let productCategories = [];
let extraInventoryRules = [];
let cart = [];
let appliedCoupon = null;
let currentSecureQuote = null;
let currentProduct = null;
let currentQty = 1;
let currentType = "Simple";
let currentDeliveryMethod = "delivery";
let isMasterOnline = false;
let upsellQtys = {};
let selectedPayMethod = null;
let secureQuoteRequestId = 0;
let pendingOrderAttempt = null;

const RIOH_WHATSAPP_NUMBER = '5491136082374';
const LAST_ORDER_KEY = 'rioh_last_order_v1';
const GUEST_PROFILE_KEY = 'rioh_checkout_profile_v1';
const LAST_ORDER_TTL_MS = 24 * 60 * 60 * 1000;
const STORE_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const DELIVERY_PREP_MINUTES = 30;
const DELIVERY_SLOT_MINUTES = 15;
const DELIVERY_ZONE_KEYS = new Set([
    'saavedra',
    'nunez',
    'belgrano',
    'florida',
    'villa-martelli',
    'villa-urquiza',
    'vicente-lopez'
]);
const OPTIMIZED_LOCAL_IMAGES = new Map([
    ['malbec_rich.jpg', 'malbec_rich.webp'],
    ['cheddar_soul.jpg', 'cheddar_soul.webp'],
    ['crunchy_byte.jpg', 'crunchy_byte.webp'],
    ['fresh_bloom.jpg', 'fresh_bloom.webp'],
    ['burger1.png', 'burger1.webp'],
    ['nuggets.png', 'nuggets.webp'],
    ['papas.png', 'papas.webp']
]);

function optimizedLocalImage(value) {
    const raw = String(value || '').trim();
    if (!raw || /^(?:https?:)?\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    return OPTIMIZED_LOCAL_IMAGES.get(raw.replace(/^\.\//, '')) || raw;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function normalizeCategory(category) {
    return {
        ...category,
        slug: String(category.slug || '').trim().toLowerCase(),
        nombre: category.nombre || category.slug || 'Productos',
        descripcion: category.descripcion || '',
        tipo_venta: category.tipo_venta === 'directo' ? 'directo' : 'configurable',
        orden: Number.isFinite(Number(category.orden)) ? Number(category.orden) : 0
    };
}

function getCategoryForProduct(product) {
    if (!product) return null;
    return productCategories.find(category => category.slug === product.category) || null;
}

function isDirectProduct(product) {
    return getCategoryForProduct(product)?.tipo_venta === 'directo';
}

function getCategoryBackgroundClass(category, sectionIndex) {
    if (category?.slug === 'burgers') return 'category-background-a';
    if (category?.slug === 'extras') return 'category-background-b';
    return sectionIndex % 2 === 0 ? 'category-background-a' : 'category-background-b';
}

function formatExtra(extra) {
    if (typeof extra === 'string') return extra;
    if (!extra || !extra.name) return '';
    const qty = Math.max(1, parseInt(extra.qty) || 1);
    return `${qty > 1 ? `${qty}x ` : ''}${extra.name}`;
}

function formatExtras(extras) {
    return (extras || []).map(formatExtra).filter(Boolean);
}

function isMedallionExtraName(value) {
    return normalizeSearchText(value).includes('medallon');
}

function getExtraQuantityLimit(extraName) {
    return isMedallionExtraName(extraName) ? 1 : 2;
}

function formatRemovedIngredients(ingredients) {
    return (ingredients || [])
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .map(name => `Sin ${name}`);
}

function formatCartItemDetails(item) {
    return [
        item?.type,
        ...(item?.type ? ['Incluye papas fritas'] : []),
        ...formatExtras(item?.extras),
        ...formatRemovedIngredients(item?.removedIngredients)
    ].filter(Boolean);
}

function readStoredJson(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const stored = JSON.parse(raw);
        if (!stored || typeof stored !== 'object' || !stored.expiresAt || !('value' in stored)) {
            localStorage.removeItem(key);
            return null;
        }
        if (Date.now() >= Number(stored.expiresAt)) {
            localStorage.removeItem(key);
            return null;
        }
        return stored.value;
    } catch (_) {
        localStorage.removeItem(key);
        return null;
    }
}

function writeStoredJson(key, value, ttlMs) {
    try {
        localStorage.setItem(key, JSON.stringify({
            value,
            expiresAt: Date.now() + ttlMs
        }));
        return true;
    } catch (_) {
        return false;
    }
}

// 3.1 STORE HOURS LOGIC
let storeHoursConfig = null;

function getStoreStatus() {
    // Toggle ON = manual override, store is ALWAYS open
    if (isMasterOnline) {
        return { open: true };
    }

    // Toggle OFF = check if we're within scheduled hours (automatic mode)
    if (storeHoursConfig && storeHoursConfig.dias && storeHoursConfig.dias.length) {
        const now = getZonedDateParts(new Date());
        const currentDay = now.weekday;
        const currentTime = now.hour * 60 + now.minute;

        const [openH, openM] = (storeHoursConfig.hora_apertura || '18:00').split(':').map(Number);
        const [closeH, closeM] = (storeHoursConfig.hora_cierre || '00:00').split(':').map(Number);
        const openMinutes = openH * 60 + openM;
        const closeMinutes = closeH * 60 + closeM;

        const isOperatingDay = storeHoursConfig.dias.includes(currentDay);
        const isOvernight = closeMinutes <= openMinutes;

        let isOpen = false;
        if (isOperatingDay) {
            if (isOvernight) {
                isOpen = currentTime >= openMinutes;
            } else {
                isOpen = currentTime >= openMinutes && currentTime < closeMinutes;
            }
        }

        if (!isOpen && isOvernight && closeMinutes > 0) {
            const yesterday = (currentDay + 6) % 7;
            if (storeHoursConfig.dias.includes(yesterday) && currentTime < closeMinutes) {
                isOpen = true;
            }
        }

        if (isOpen) return { open: true };
    }

    // Toggle OFF + outside hours = closed
    const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    if (storeHoursConfig && storeHoursConfig.dias && storeHoursConfig.dias.length) {
        const currentDay = getZonedDateParts(new Date()).weekday;
        const nextDay = storeHoursConfig.dias.find(d => d > currentDay) ?? storeHoursConfig.dias[0];
        const nextDayName = dayNames[nextDay] || '';
        const nextTime = storeHoursConfig.hora_apertura || '18:00';
        return { open: false, nextOpening: `el ${nextDayName} a las ${nextTime}` };
    }

    return { open: false, nextOpening: 'cuando la tienda vuelva a abrir' };
}

function getZonedDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: STORE_TIME_ZONE,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).reduce((result, part) => {
        result[part.type] = part.value;
        return result;
    }, {});
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: weekdayMap[parts.weekday]
    };
}

function zonedLocalToInstant(year, month, day, hour, minute) {
    let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const actual = getZonedDateParts(new Date(guess));
        const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
        const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0);
        guess += desiredUtc - actualUtc;
    }
    return new Date(guess);
}

async function fetchStoreHours() {
    if (!supabaseClient) return;
    try {
        const { data } = await supabaseClient.from('configuracion').select('valor').eq('id', 'horarios_atencion').maybeSingle();
        if (data && data.valor) {
            storeHoursConfig = data.valor;
            updateFooterHours();
        }
    } catch (e) { console.error("Error fetching store hours:", e); }
}

function updateFooterHours() {
    const el = document.getElementById('footer-horarios');
    if (!el || !storeHoursConfig) return;
    const dayNames = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const days = (storeHoursConfig.dias || []).map(d => dayNames[d]).join(', ');
    el.replaceChildren(
        document.createTextNode(days),
        document.createElement('br'),
        document.createTextNode(`${storeHoursConfig.hora_apertura || '18:00'} a ${storeHoursConfig.hora_cierre || '00:00'}`)
    );
}

// 4. INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    const hasSupabase = initSupabase();
    initListeners();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (hasSupabase) {
        initAuth();
        loadMenu();
        fetchMasterStatus();
        fetchStoreHours();
        subscribeToStoreChanges();
    } else {
        showCatalogStartupError();
    }

    initScrollButtons();
    localStorage.removeItem(GUEST_PROFILE_KEY);
    initializeLastOrderReceipt();

    // Initial status check
    const status = getStoreStatus();
    if (!status.open) {
        console.log("Store is currently closed.");
    }
});

async function fetchMasterStatus() {
    if (!supabaseClient) return;
    try {
        const { data } = await supabaseClient.from('configuracion').select('valor').eq('id', 'ventas_web').maybeSingle();
        if (data && data.valor) {
            const newValue = data.valor.online;
            if (isMasterOnline !== newValue) {
                isMasterOnline = newValue;
                renderCatalog();
            }
        }
    } catch (e) { console.error("Error fetching master status:", e); }
}

function subscribeToStoreChanges() {
    if (!supabaseClient) return;
    const channel = supabaseClient
        .channel('web-store-config')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion' }, payload => {
            if (payload.new && payload.new.id === 'ventas_web' && payload.new.valor) {
                const newValue = payload.new.valor.online;
                if (isMasterOnline !== newValue) {
                    isMasterOnline = newValue;
                    renderCatalog();
                    console.log('Store status updated via Realtime:', newValue ? 'OPEN' : 'CLOSED');
                }
            }
            if (payload.new && payload.new.id === 'horarios_atencion' && payload.new.valor) {
                storeHoursConfig = payload.new.valor;
                renderCatalog();
                updateFooterHours();
                console.log('Store hours updated via Realtime:', storeHoursConfig);
            }
        });

    channel.subscribe();
    window.setInterval(() => loadMenu({ silent: true }), 60000);
}

// 5. DATA LOADING & INVENTORY
async function loadMenu({ silent = false } = {}) {
    if (!supabaseClient) {
        console.error("Cannot load menu: Supabase client not initialized");
        return false;
    }

    try {
        const { data, error } = await supabaseClient.rpc('listar_menu_publico');
        if (error) throw error;

        const rawProducts = Array.isArray(data?.products) ? data.products : [];
        productCategories = (Array.isArray(data?.categories) ? data.categories : []).map(normalizeCategory);
        extraInventoryRules = (Array.isArray(data?.extras) ? data.extras : []).map(rule => ({
            normalizedName: normalizeSearchText(rule.nombre_extra),
            name: rule.nombre_extra,
            price: Math.max(0, Number(rule.precio) || 0),
            maxQuantity: Math.max(0, Math.floor(Number(rule.max_quantity) || 0))
        }));
        document.querySelectorAll('#product-modal .extra-item').forEach(item => {
            const rule = findExtraRule(item.dataset.name);
            item.hidden = !rule;
            if (!rule) return;
            item.dataset.price = String(rule.price);
            const price = item.querySelector('.extra-item-copy span');
            if (price) price.textContent = `+$${rule.price.toLocaleString('es-AR')} c/u`;
        });

        menuData = rawProducts.map(product => {
            let imgUrl = product.imagen_url;
            if (!imgUrl) {
                const normalizedName = normalizeSearchText(product.nombre);
                imgUrl = normalizedName.includes('papas')
                    ? 'papas.png'
                    : normalizedName.includes('nuggets') ? 'nuggets.png' : 'burger1.png';
            }

            return {
                id: String(product.id),
                title: product.nombre || 'Producto sin nombre',
                category: String(product.categoria || 'burgers').trim().toLowerCase(),
                simple: Math.max(0, Number(product.precio_simple) || 0),
                doble: Math.max(0, Number(product.precio_doble) || 0),
                desc: product.descripcion || '',
                img: optimizedLocalImage(imgUrl),
                destacado: Boolean(product.destacado),
                removableIngredients: [...new Set((Array.isArray(product.ingredientes_removibles)
                    ? product.ingredientes_removibles
                    : []).map(name => String(name || '').trim()).filter(Boolean))],
                directStock: Math.max(0, Math.floor(Number(product.max_simple) || 0)),
                maxSimple: Math.max(0, Math.floor(Number(product.max_simple) || 0)),
                maxDoble: Math.max(0, Math.floor(Number(product.max_doble) || 0)),
                orden: Number.isFinite(Number(product.orden)) ? Number(product.orden) : 0
            };
        }).sort((a, b) => a.orden - b.orden || a.title.localeCompare(b.title, 'es'));

        menuData.forEach(product => {
            product.stock = isDirectProduct(product)
                ? product.maxSimple
                : Math.max(product.maxSimple, product.maxDoble);
        });

        renderCatalog();
        if (document.getElementById('cart-modal')?.classList.contains('active')) renderCartItems();
        updateOrderBar();
        return true;
    } catch (error) {
        console.error('Error loading menu:', error);
        if (!silent) {
            const container = document.getElementById('menu');
            if (container) container.innerHTML = '<div class="catalog-error">NO PUDIMOS CARGAR EL MENÚ. INTENTÁ NUEVAMENTE.</div>';
        }
        return false;
    }
}

function findExtraRule(extraName) {
    return extraInventoryRules.find(rule => rule.normalizedName === normalizeSearchText(extraName)) || null;
}

function getProductCapacity(product, type = 'Simple', extras = []) {
    if (!product) return 0;
    let capacity = normalizeSearchText(type) === 'doble' ? product.maxDoble : product.maxSimple;
    for (const extra of extras || []) {
        const name = typeof extra === 'string' ? extra : extra?.name;
        const quantity = typeof extra === 'string' ? 1 : Math.max(1, parseInt(extra?.qty) || 1);
        const rule = findExtraRule(name);
        if (!rule) return 0;
        capacity = Math.min(capacity, Math.floor(rule.maxQuantity / quantity));
    }
    return Math.max(0, Math.floor(Number(capacity) || 0));
}

function validateCartAvailability(items = cart) {
    const productRequirements = new Map();
    const extraRequirements = new Map();

    for (const item of items) {
        const product = menuData.find(candidate => candidate.id === String(item.product_id));
        const qty = parseInt(item.qty);
        if (!product) return { valid: false, message: `${item.title || 'Un producto'} ya no está disponible.` };
        if (!getCategoryForProduct(product)) return { valid: false, message: `${product.title} pertenece a una categoría que ya no está disponible.` };
        if (!Number.isInteger(qty) || qty <= 0 || qty > 20) return { valid: false, message: `La cantidad de ${product.title} no es válida.` };

        const directSale = isDirectProduct(product);
        if (directSale) {
            if (item.type) return { valid: false, message: `${product.title} no admite tipo simple o doble.` };
        } else {
            const normalizedType = normalizeSearchText(item.type || 'Simple');
            if (!['simple', 'doble'].includes(normalizedType)) {
                return { valid: false, message: `Elegí un tamaño válido para ${product.title}.` };
            }
            if (normalizedType === 'doble' && product.doble <= 0) {
                return { valid: false, message: `${product.title} no tiene opción doble disponible.` };
            }

            const allowedIngredients = new Set((product.removableIngredients || []).map(normalizeSearchText));
            for (const removedName of item.removedIngredients || []) {
                if (!allowedIngredients.has(normalizeSearchText(removedName))) {
                    return { valid: false, message: `No se puede quitar ${removedName || 'ese ingrediente'} de ${product.title}.` };
                }
            }
        }

        const type = directSale ? 'Simple' : item.type;
        const key = `${product.id}:${normalizeSearchText(type)}`;
        const requiredProductQty = (productRequirements.get(key) || 0) + qty;
        productRequirements.set(key, requiredProductQty);
        if (requiredProductQty > getProductCapacity(product, type)) {
            return { valid: false, message: `No hay stock suficiente de ${product.title}.` };
        }

        for (const extra of item.extras || []) {
            const name = typeof extra === 'string' ? extra : extra?.name;
            const extraQty = typeof extra === 'string' ? 1 : Math.max(1, parseInt(extra?.qty) || 1);
            const rule = findExtraRule(name);
            if (!rule) return { valid: false, message: `El extra ${name || ''} ya no está disponible.` };
            if (isMedallionExtraName(name) && normalizeSearchText(type) !== 'doble') {
                return { valid: false, message: 'El medallón extra se habilita únicamente para hamburguesas dobles.' };
            }
            if (extraQty > getExtraQuantityLimit(name)) {
                return { valid: false, message: `La cantidad de ${rule.name} no es válida.` };
            }
            const required = (extraRequirements.get(rule.normalizedName) || 0) + extraQty * qty;
            extraRequirements.set(rule.normalizedName, required);
            if (required > rule.maxQuantity) {
                return { valid: false, message: `No hay stock suficiente de ${rule.name}.` };
            }
        }

    }

    return { valid: true, message: '' };
}

function serializeCartForServer(items = cart) {
    return items.map(item => ({
        product_id: String(item.product_id),
        type: normalizeSearchText(item.type),
        qty: Math.max(1, parseInt(item.qty) || 1),
        extras: (item.extras || []).map(extra => ({
            name: typeof extra === 'string' ? extra : String(extra?.name || ''),
            qty: typeof extra === 'string' ? 1 : Math.max(1, parseInt(extra?.qty) || 1)
        })),
        removedIngredients: (item.removedIngredients || [])
            .map(name => String(name || '').trim())
            .filter(Boolean)
    }));
}

function secureQuoteKey(couponCode = appliedCoupon?.codigo || '') {
    return JSON.stringify({
        items: serializeCartForServer(),
        couponCode: String(couponCode || '').trim().toUpperCase(),
        deliveryMethod: currentDeliveryMethod,
        zone: currentDeliveryMethod === 'delivery' ? getSelectedZoneKey() : ''
    });
}

function serverErrorMessage(error, fallback) {
    const message = String(error?.message || '').replace(/^.*?error:\s*/i, '').trim();
    if (error?.code === 'PGRST202' || /schema cache|crear_pedido_seguro|cotizar_pedido_seguro/i.test(message)) {
        return 'La tienda está en mantenimiento. Falta aplicar la migración de seguridad en Supabase.';
    }
    if (error?.code === '23505' || /duplicate key value|clientes_whatsapp_key/i.test(message)) {
        return 'No pudimos actualizar tus datos de contacto. Recargá la página e intentá nuevamente.';
    }
    return message && message.length <= 240 ? message : fallback;
}

async function requestSecureQuote(couponCode = appliedCoupon?.codigo || '') {
    if (!supabaseClient) throw new Error('No se pudo conectar con la tienda.');
    const key = secureQuoteKey(couponCode);
    const { data, error } = await supabaseClient.rpc('cotizar_pedido_seguro', {
        p_items: serializeCartForServer(),
        p_codigo_cupon: String(couponCode || '').trim() || null,
        p_metodo_entrega: currentDeliveryMethod,
        p_zona: currentDeliveryMethod === 'delivery' ? getSelectedZoneKey() : null
    });
    if (error) throw new Error(serverErrorMessage(error, 'No pudimos validar el pedido. Intentá nuevamente.'));
    return { ...data, _key: key };
}

async function validateCartAvailabilityOnServer(items = cart) {
    if (items !== cart) {
        return { valid: false, message: 'No se pudo validar una versión anterior del carrito.' };
    }
    try {
        const quote = await requestSecureQuote();
        return { valid: true, quote };
    } catch (error) {
        console.error('Server quote error:', error);
        return { valid: false, message: error.message };
    }
}

function createOperationId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function invalidateCheckoutState() {
    currentSecureQuote = null;
    pendingOrderAttempt = null;
}

function copyCart() {
    return cart.map(item => ({
        ...item,
        extras: (item.extras || []).map(extra => typeof extra === 'string' ? extra : { ...extra }),
        removedIngredients: [...(item.removedIngredients || [])]
    }));
}

function maxAddableQuantity(product, type, extras = []) {
    if (!product) return 0;
    const absoluteCapacity = getProductCapacity(product, type, extras);
    if (absoluteCapacity <= 0) return 0;

    let low = 0;
    let high = Math.min(absoluteCapacity, 20);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = copyCart();
        candidate.push({ product_id: product.id, title: product.title, type, qty: middle, extras });
        if (validateCartAvailability(candidate).valid) low = middle;
        else high = middle - 1;
    }
    return low;
}

window.addExtraToCart = productId => {
    const product = menuData.find(candidate => candidate.id === String(productId));
    if (!product || !isDirectProduct(product)) return;
    const storeStatus = getStoreStatus();
    if (!storeStatus.open || !isMasterOnline) {
        showAlert('NEGOCIO CERRADO', 'El local está cerrado en este momento.');
        return;
    }

    const candidate = copyCart();
    const existing = candidate.find(item => item.product_id === product.id && item.type === '');
    if (existing) {
        existing.qty += 1;
        existing.total = existing.pricePerUnit * existing.qty;
    } else {
        candidate.push({
            id: Date.now(),
            title: product.title,
            product_id: product.id,
            type: '',
            qty: 1,
            extras: [],
            pricePerUnit: product.simple,
            total: product.simple
        });
    }

    const validation = validateCartAvailability(candidate);
    if (!validation.valid) {
        showAlert('STOCK INSUFICIENTE', validation.message);
        return;
    }

    cart = candidate;
    invalidateCheckoutState();
    updateOrderBar();
    const btn = [...document.querySelectorAll('.extra-add-btn')]
        .find(candidateButton => candidateButton.dataset.productId === product.id);
    if (btn) {
        const symbol = btn.querySelector('.extra-add-symbol');
        const label = btn.querySelector('.extra-add-label');
        if (symbol) symbol.textContent = '✓';
        if (label) label.textContent = 'AGREGADO';
        setTimeout(() => {
            if (symbol) symbol.textContent = '+';
            if (label) label.textContent = btn.dataset.defaultLabel || 'AGREGAR';
        }, 1200);
    }
};

// =============================================
// AUTH ENGINE
// =============================================
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) { currentUser = session.user; await onAuthSuccess(session.user, false); }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
            currentUser = session.user;
            updateAuthUI(session.user);
            openPasswordRecoveryPanel();
        } else if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            await onAuthSuccess(session.user, true);
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            updateAuthUI(null);
        }
    });
}

async function onAuthSuccess(user, fromLogin) {
    updateAuthUI(user);

    const { data: cliente, error } = await supabaseClient.rpc('sincronizar_cliente_actual', {
        p_nombre: user.user_metadata?.nombre || null,
        p_whatsapp: user.user_metadata?.whatsapp || null
    });
    if (error) {
        console.error('Profile sync error:', error);
    } else if (cliente) {
        fillCheckoutProfile(cliente, false);
    }

    if (fromLogin) {
        closeAuthModal();
        if (pendingAfterAuth === 'checkout') {
            pendingAfterAuth = null;
            openCheckoutModal();
        }
    }
}

function updateAuthUI(user) {
    const btn = document.getElementById('user-btn');
    const label = document.getElementById('user-btn-label');
    if (!btn || !label) return;
    if (user) {
        const name = (user.user_metadata?.nombre || user.email.split('@')[0]).toUpperCase().split(' ')[0];
        label.textContent = `HOLA, ${name}`;
        btn.classList.add('logged-in');
    } else {
        label.textContent = 'INGRESAR';
        btn.classList.remove('logged-in');
    }
}

window.handleUserBtnClick = () => {
    if (currentUser) {
        if (confirm('¿Cerrar sesión?')) supabaseClient.auth.signOut();
    } else {
        openAuthModal();
    }
};

window.openAuthModal = (fromCheckout = false) => {
    if (fromCheckout) {
        pendingAfterAuth = 'checkout';
        const sub = document.getElementById('auth-subtitle');
        if (sub) sub.textContent = 'Iniciá sesión para completar tu pedido';
    }
    const modal = document.getElementById('auth-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeAuthModal = () => {
    const modal = document.getElementById('auth-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.style.display = '';
    switchAuthTab('login');
    const subtitle = document.getElementById('auth-subtitle');
    if (subtitle) subtitle.textContent = 'Ingresá o creá tu cuenta';
    pendingAfterAuth = null;
};

window.switchAuthTab = (tab) => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('auth-panel-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('auth-panel-register').style.display = tab === 'register' ? 'block' : 'none';
    const recoveryPanel = document.getElementById('auth-panel-recovery');
    if (recoveryPanel) recoveryPanel.style.display = tab === 'recovery' ? 'block' : 'none';
};

function openPasswordRecoveryPanel() {
    openAuthModal();
    switchAuthTab('recovery');
    const tabs = document.querySelector('.auth-tabs');
    if (tabs) tabs.style.display = 'none';
    const subtitle = document.getElementById('auth-subtitle');
    if (subtitle) subtitle.textContent = 'Elegí una contraseña nueva para tu cuenta';
}

function setAuthError(elId, msg, isSuccess = false) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isSuccess ? '#4CAF50' : '#CC1E27';
}

function translateAuthError(error) {
    const msg = error.message || '';
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
    if (msg.includes('Email not confirmed')) return 'Confirmá tu email antes de ingresar.';
    if (msg.includes('signups are disabled') || msg.includes('Signups not allowed')) return 'El registro está temporalmente desactivado. Contactá al administrador.';
    if (msg.includes('already been registered') || msg.includes('already registered')) return 'Ya existe una cuenta con ese email. Usá "Ingresar".';
    if (msg.includes('User already registered')) return 'Ya existe una cuenta con ese email. Usá "Ingresar".';
    if (msg.includes('only request this after')) {
        const sec = msg.match(/after (\d+) second/);
        return sec ? `Demasiados intentos. Esperá ${sec[1]} segundos e intentá de nuevo.` : 'Demasiados intentos. Esperá un momento.';
    }
    if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 6 caracteres.';
    return msg;
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePhone(phone) { return phone.replace(/\D/g, '').length >= 8; }

window.doLogin = async () => {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    setAuthError('auth-error-login', '');
    if (!email) { setAuthError('auth-error-login', 'Ingresá tu email.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-login', 'El email no es válido.'); return; }
    if (!pass) { setAuthError('auth-error-login', 'Ingresá tu contraseña.'); return; }
    const btn = document.querySelector('#auth-panel-login .auth-submit-btn');
    btn.textContent = 'INGRESANDO...'; btn.disabled = true;
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    btn.textContent = 'INGRESAR'; btn.disabled = false;
    if (error) setAuthError('auth-error-login', translateAuthError(error));
};

window.doRegister = async () => {
    const nombre = document.getElementById('reg-nombre').value.trim();
    const whatsapp = document.getElementById('reg-whatsapp').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    setAuthError('auth-error-register', '');

    if (!nombre) { setAuthError('auth-error-register', 'Ingresá tu nombre.'); return; }
    if (!whatsapp) { setAuthError('auth-error-register', 'Ingresá tu WhatsApp.'); return; }
    if (!validatePhone(whatsapp)) { setAuthError('auth-error-register', 'El WhatsApp debe tener al menos 8 dígitos.'); return; }
    if (!email) { setAuthError('auth-error-register', 'Ingresá tu email.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-register', 'El email no es válido.'); return; }
    if (!pass) { setAuthError('auth-error-register', 'Ingresá una contraseña.'); return; }
    if (pass.length < 6) { setAuthError('auth-error-register', 'La contraseña debe tener al menos 6 caracteres.'); return; }

    const btn = document.querySelector('#auth-panel-register .auth-submit-btn');
    btn.textContent = 'CREANDO CUENTA...'; btn.disabled = true;
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password: pass,
        options: { data: { nombre, whatsapp } }
    });
    btn.textContent = 'CREAR CUENTA'; btn.disabled = false;

    if (error) { setAuthError('auth-error-register', translateAuthError(error)); return; }

    if (data.session && data.user) {
        await onAuthSuccess(data.user, true);
    } else {
        setAuthError('auth-error-register', 'Revisá tu email para confirmar la cuenta. Después vas a poder ingresar.', true);
    }
};

window.doForgotPassword = async () => {
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('auth-error-login');
    if (!email) { setAuthError('auth-error-login', 'Ingresá tu email primero.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-login', 'El email no es válido.'); return; }
    const redirectUrl = `${window.location.origin}${window.location.pathname}?password-recovery=1`;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
    if (error) { setAuthError('auth-error-login', translateAuthError(error)); return; }
    setAuthError('auth-error-login', 'Te enviamos un email para restablecer tu contraseña.', true);
};

window.doUpdatePassword = async () => {
    const password = document.getElementById('recovery-pass')?.value || '';
    const confirmation = document.getElementById('recovery-pass-confirm')?.value || '';
    setAuthError('auth-error-recovery', '');
    if (password.length < 8) {
        setAuthError('auth-error-recovery', 'La contraseña debe tener al menos 8 caracteres.');
        return;
    }
    if (password !== confirmation) {
        setAuthError('auth-error-recovery', 'Las contraseñas no coinciden.');
        return;
    }
    const button = document.querySelector('#auth-panel-recovery .auth-submit-btn');
    if (button) { button.disabled = true; button.textContent = 'ACTUALIZANDO...'; }
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (button) { button.disabled = false; button.textContent = 'GUARDAR CONTRASEÑA'; }
    if (error) {
        setAuthError('auth-error-recovery', translateAuthError(error));
        return;
    }
    window.history.replaceState({}, document.title, window.location.pathname);
    closeAuthModal();
    showAlert('CONTRASEÑA ACTUALIZADA', 'Tu nueva contraseña ya está activa.');
};

function initScrollButtons() {
    const fab = document.getElementById('fab-menu');
    const scrollTop = document.getElementById('scroll-top-btn');
    const heroHeight = () => document.querySelector('.hero')?.offsetHeight || 400;

    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > heroHeight();
        if (fab) fab.classList.toggle('fab-visible', scrolled && cart.length === 0);
        if (scrollTop) scrollTop.classList.toggle('fab-visible', window.scrollY > 600);
    }, { passive: true });
}

// 6. RENDER LOGIC
function renderCatalog() {
    const catalog = document.getElementById('menu');
    if (!catalog) return;

    const categoriesWithProducts = productCategories
        .map(category => ({
            category,
            products: menuData.filter(product => product.category === category.slug)
        }))
        .filter(group => group.products.length > 0);

    if (!categoriesWithProducts.length) {
        catalog.innerHTML = '<div class="catalog-empty">NO HAY PRODUCTOS DISPONIBLES EN ESTE MOMENTO.</div>';
        return;
    }

    const status = getStoreStatus();
    catalog.innerHTML = categoriesWithProducts.map(({ category, products }, sectionIndex) => {
        const sectionClass = category.tipo_venta === 'directo' ? 'extras-section' : 'menu-section';
        const backgroundClass = getCategoryBackgroundClass(category, sectionIndex);
        const content = category.tipo_venta === 'directo'
            ? renderDirectCategory(products, status)
            : renderConfigurableCategory(products, status);
        return `
            <section id="${escapeHtml(category.slug)}" class="category-section ${sectionClass} ${backgroundClass}" data-sale-type="${category.tipo_venta}">
                <div class="container">
                    <header class="category-header ${category.tipo_venta === 'directo' ? 'category-header-light' : ''}">
                        <span class="category-kicker">RIOH. MENÚ</span>
                        <h2>${escapeHtml(category.nombre)}</h2>
                        ${category.descripcion ? `<p>${escapeHtml(category.descripcion)}</p>` : ''}
                    </header>
                    ${content}
                </div>
            </section>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderConfigurableCategory(products, status) {
    const storeClosed = !status.open || !isMasterOnline;
    const featured = products.find(product => product.destacado) || null;
    const regular = featured ? products.filter(product => product.id !== featured.id) : products;
    const cards = regular.map(product => renderConfigurableCard(product, storeClosed)).join('');
    const featuredCard = featured ? renderFeaturedCard(featured, storeClosed) : '';
    return `<div class="menu-grid">${featuredCard}${cards}</div>`;
}

function renderConfigurableCard(product, storeClosed) {
    const soldOut = product.stock <= 0;
    const disabled = storeClosed || soldOut;
    const label = soldOut ? 'AGOTADO' : storeClosed ? 'NEGOCIO CERRADO' : 'SUMAR AL CARRITO';
    const icon = soldOut ? 'x' : storeClosed ? 'clock' : 'plus';
    const disabledStyle = disabled ? 'style="background:#888; border-color:#888; cursor:not-allowed;"' : '';
    return `
        <article class="menu-item ${disabled ? 'closed-item' : ''}" ${disabled ? 'aria-disabled="true"' : ''}>
            ${product.destacado ? '<div class="badge-destacado">🔥 MÁS PEDIDO</div>' : ''}
            ${soldOut ? '<div class="badge-destacado sold-out-badge">AGOTADO</div>' : ''}
            <div class="item-img">
                <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.title)}" loading="lazy">
                <span class="item-price-tag">$${product.simple.toLocaleString('es-AR')}</span>
            </div>
            <div class="item-content">
                <h3>${escapeHtml(product.title)}</h3>
                <p class="item-desc">${escapeHtml(product.desc)}</p>
                <p class="fries-included"><i data-lucide="badge-check"></i> INCLUYE PAPAS FRITAS</p>
                <button type="button" class="add-btn" ${disabled ? 'disabled' : `onclick="openProductModal('${product.id}')"`} ${disabledStyle}>
                    <i data-lucide="${icon}"></i> ${label}
                </button>
            </div>
        </article>`;
}

function renderFeaturedCard(product, storeClosed) {
    const soldOut = product.stock <= 0;
    const disabled = storeClosed || soldOut;
    const label = soldOut ? 'AGOTADO' : storeClosed ? 'NEGOCIO CERRADO' : 'SUMAR AL CARRITO';
    const icon = soldOut ? 'x' : storeClosed ? 'clock' : 'plus';
    const disabledStyle = disabled ? 'style="background:#888; border-color:#888; cursor:not-allowed;"' : '';
    return `
        <article class="menu-item-featured ${disabled ? 'closed-item' : ''}" ${disabled ? 'aria-disabled="true"' : ''}>
            ${soldOut ? '<div class="badge-destacado sold-out-badge">AGOTADO</div>' : ''}
            <div class="featured-img">
                <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.title)}" loading="lazy">
            </div>
            <div class="featured-content">
                <span class="featured-label">MÁS PEDIDO</span>
                <h3>${escapeHtml(product.title)}</h3>
                <p class="featured-desc">${escapeHtml(product.desc)}</p>
                <p class="fries-included fries-included-featured"><i data-lucide="badge-check"></i> INCLUYE PAPAS FRITAS</p>
                <div class="featured-pricing">
                    <span>Simple $${product.simple.toLocaleString('es-AR')}</span>
                    ${product.doble > 0 ? `<span>Doble $${product.doble.toLocaleString('es-AR')}</span>` : ''}
                </div>
                <button type="button" class="add-btn-featured" ${disabled ? 'disabled' : `onclick="openProductModal('${product.id}')"`} ${disabledStyle}>
                    <i data-lucide="${icon}"></i> ${label}
                </button>
            </div>
        </article>`;
}

function renderDirectCategory(products, status) {
    const storeClosed = !status.open || !isMasterOnline;
    return `<div class="extras-grid">${products.map(product => {
        const soldOut = product.maxSimple <= 0;
        const disabled = soldOut || storeClosed;
        const label = soldOut ? 'AGOTADO' : storeClosed ? 'NEGOCIO CERRADO' : 'AGREGAR';
        const symbol = soldOut ? '×' : storeClosed ? '⌛' : '+';
        return `
            <article class="extra-card ${disabled ? 'closed-item' : ''}">
                ${product.destacado ? '<div class="badge-destacado">🔥 MÁS PEDIDO</div>' : ''}
                <div class="extra-card-img">
                    <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.title)}" loading="lazy">
                </div>
                <div class="extra-card-info">
                    <h3>${escapeHtml(product.title)}</h3>
                    ${product.desc ? `<p class="extra-card-desc">${escapeHtml(product.desc)}</p>` : ''}
                    <p class="extra-card-price">$${product.simple.toLocaleString('es-AR')}</p>
                    ${soldOut ? '<p class="direct-sold-out">AGOTADO</p>' : ''}
                </div>
                <button type="button" class="extra-add-btn" data-product-id="${product.id}" data-default-label="${label}"
                    ${disabled ? 'disabled style="background:#888; border-color:#888; cursor:not-allowed; opacity:0.5;"' : `onclick="addExtraToCart('${product.id}')"`}>
                    <span class="extra-add-symbol">${symbol}</span>
                    <span class="extra-add-label">${label}</span>
                </button>
            </article>`;
    }).join('')}</div>`;
}

// 7. MODAL & CART LOGIC
window.openProductModal = function (id) {
    const status = getStoreStatus();
    if (!status.open || !isMasterOnline) {
        showAlert("NEGOCIO CERRADO", `Podrás realizar tu pedido ${status.nextOpening}, ¡Te esperamos!`);
        return;
    }
    const productCheck = menuData.find(p => p.id === String(id));
    if (!productCheck || isDirectProduct(productCheck)) return;
    if (productCheck.stock <= 0) {
        showAlert("PRODUCTO AGOTADO", "Este producto no está disponible en este momento.");
        return;
    }
    const simpleRemaining = maxAddableQuantity(productCheck, 'Simple');
    const doubleRemaining = productCheck.doble > 0 ? maxAddableQuantity(productCheck, 'Doble') : 0;
    if (simpleRemaining <= 0 && doubleRemaining <= 0) {
        showAlert('STOCK INSUFICIENTE', 'Ya agregaste al carrito el máximo disponible de este producto.');
        return;
    }

    console.log("Opening modal for ID:", id);
    currentProduct = productCheck;
    if (!currentProduct) {
        console.error("Product not found in menuData!");
        return;
    }

    currentQty = 1;
    currentType = simpleRemaining > 0 ? 'Simple' : 'Doble';

    const modalImg = document.getElementById('modal-img');
    const modalTitle = document.getElementById('modal-title');
    const modalDesc = document.getElementById('modal-desc');
    const modalQty = document.getElementById('modal-qty');

    if (modalImg) {
        modalImg.src = currentProduct.img;
        modalImg.alt = currentProduct.title;
    }
    if (modalTitle) modalTitle.innerText = currentProduct.title;
    if (modalDesc) modalDesc.innerText = currentProduct.desc;
    if (modalQty) modalQty.innerText = currentQty;

    renderRemovableIngredients(currentProduct);

    document.querySelectorAll('.modal-pill').forEach(b => {
        b.classList.remove('active');
        const isDouble = b.dataset.type === 'Doble';
        const available = !isDouble || currentProduct.doble > 0;
        b.style.display = available ? '' : 'none';
        b.disabled = !available;
        if (b.dataset.type === currentType) b.classList.add('active');
    });

    document.querySelectorAll('.extra-item').forEach(item => {
        item.dataset.qty = '0';
        item.classList.remove('active');
        const valueEl = item.querySelector('.extra-qty-value');
        if (valueEl) valueEl.textContent = '0';
        item.querySelectorAll('.extra-qty-btn').forEach(btn => {
            btn.disabled = btn.dataset.delta === '-1';
        });
    });
    updateModalAvailability();

    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.add('active');
};

function getSelectedModalExtras() {
    const extras = [];
    document.querySelectorAll('#product-modal .extra-item').forEach(item => {
        const qty = parseInt(item.dataset.qty) || 0;
        if (qty <= 0) return;
        if (isMedallionExtraName(item.dataset.name) && currentType !== 'Doble') return;
        extras.push({
            name: item.dataset.name,
            qty,
            unitPrice: Math.max(0, Number(item.dataset.price) || 0)
        });
    });
    return extras;
}

function getSelectedRemovedIngredients() {
    return [...document.querySelectorAll('#removable-ingredients-list input[type="checkbox"]:checked')]
        .map(input => String(input.value || '').trim())
        .filter(Boolean);
}

function renderRemovableIngredients(product) {
    const section = document.getElementById('removable-ingredients-section');
    const list = document.getElementById('removable-ingredients-list');
    if (!section || !list) return;
    const ingredients = product?.removableIngredients || [];
    section.hidden = ingredients.length === 0;
    list.innerHTML = ingredients.map((name, index) => `
        <label class="ingredient-toggle">
            <input type="checkbox" value="${escapeHtml(name)}" id="remove-ingredient-${index}">
            <span><i data-lucide="minus-circle"></i> SIN ${escapeHtml(name)}</span>
        </label>`).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function clearIneligibleMedallionExtras() {
    if (currentType === 'Doble') return;
    document.querySelectorAll('#product-modal .extra-item').forEach(item => {
        if (!isMedallionExtraName(item.dataset.name)) return;
        item.dataset.qty = '0';
        item.classList.remove('active');
    });
}

function buildConfiguredCartItem(product, type, qty, extras, removedIngredients) {
    const base = type === 'Doble' ? product.doble : product.simple;
    const extrasTotal = (extras || []).reduce((total, extra) => total + (Number(extra.unitPrice) || 0) * (parseInt(extra.qty) || 0), 0);
    const pricePerUnit = base + extrasTotal;
    return {
        id: Date.now(),
        title: product.title,
        product_id: product.id,
        type,
        qty,
        extras,
        removedIngredients,
        pricePerUnit,
        total: pricePerUnit * qty
    };
}

// Initialize listeners inside a function called from DOMContentLoaded
function initListeners() {
    const closeModalBtn = document.querySelector('#product-modal .close-modal');
    if (closeModalBtn) {
        closeModalBtn.onclick = () => document.getElementById('product-modal').classList.remove('active');
    }

    document.querySelectorAll('.modal-pill').forEach(btn => {
        btn.onclick = () => {
            if (!currentProduct || btn.disabled) return;
            const requestedType = btn.dataset.type;
            const requestedExtras = getSelectedModalExtras().filter(extra =>
                requestedType === 'Doble' || !isMedallionExtraName(extra.name)
            );
            const maxQty = maxAddableQuantity(currentProduct, requestedType, requestedExtras);
            if (maxQty <= 0) {
                showAlert('SIN STOCK', `No hay stock para preparar ${currentProduct.title} ${requestedType.toLowerCase()}.`);
                return;
            }
            document.querySelectorAll('.modal-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = requestedType;
            clearIneligibleMedallionExtras();
            currentQty = Math.min(currentQty, maxQty);
            updateModalAvailability();
        };
    });

    document.querySelectorAll('.extra-qty-btn').forEach(btn => {
        btn.onclick = () => {
            const item = btn.closest('.extra-item');
            if (!item || !currentProduct) return;
            if (isMedallionExtraName(item.dataset.name) && currentType !== 'Doble') return;
            const current = parseInt(item.dataset.qty) || 0;
            const delta = parseInt(btn.dataset.delta) || 0;
            const next = Math.max(0, Math.min(getExtraQuantityLimit(item.dataset.name), current + delta));
            item.dataset.qty = String(next);
            const maxQty = maxAddableQuantity(currentProduct, currentType, getSelectedModalExtras());
            if (maxQty < currentQty) {
                item.dataset.qty = String(current);
                showAlert('STOCK INSUFICIENTE', `No hay stock suficiente para sumar ese extra a ${currentQty} unidad${currentQty > 1 ? 'es' : ''}.`);
                return;
            }
            item.classList.toggle('active', next > 0);
            const valueEl = item.querySelector('.extra-qty-value');
            if (valueEl) valueEl.textContent = String(next);
            updateModalAvailability();
        };
    });

    const addToCartBig = document.getElementById('add-to-cart-big');
    if (addToCartBig) {
        addToCartBig.onclick = () => {
            if (!currentProduct) return;
            console.log("Adding to cart:", currentProduct.title);

            const extras = getSelectedModalExtras();
            const removedIngredients = getSelectedRemovedIngredients();
            const candidate = copyCart();
            candidate.push(buildConfiguredCartItem(currentProduct, currentType, currentQty, extras, removedIngredients));
            const validation = validateCartAvailability(candidate);
            if (!validation.valid) {
                showAlert('STOCK INSUFICIENTE', validation.message);
                return;
            }

            cart = candidate;
            invalidateCheckoutState();

            console.log("Cart updated:", cart);
            document.getElementById('product-modal').classList.remove('active');
            updateOrderBar();
            showAddedToast(currentProduct.title);
        };
    }
}

function showUpsellModal() {
    const nuggets = menuData.filter(product =>
        isDirectProduct(product) && product.maxSimple > 0 && normalizeSearchText(product.title).includes('nuggets')
    );
    const grid = document.getElementById('upsell-nuggets-grid');
    if (!grid || !nuggets.length) { openCheckoutModal(); return; }

    upsellQtys = {};
    grid.innerHTML = nuggets.map(p => `
        <div class="upsell-nugget-card">
            <div class="upsell-nugget-info">
                <h3>${escapeHtml(p.title)}</h3>
                <p class="upsell-nugget-price">$${p.simple.toLocaleString()}</p>
            </div>
            <div class="upsell-nugget-action">
                <div id="upsell-zero-${p.id}">
                    <button class="upsell-add-btn" type="button" onclick="changeNuggetQty('${p.id}', 1)">+ AGREGAR</button>
                </div>
                <div id="upsell-active-${p.id}" style="display:none; align-items:center; gap:10px;">
                    <button class="upsell-qty-btn" type="button" aria-label="Quitar ${escapeHtml(p.title)}" onclick="changeNuggetQty('${p.id}', -1)">−</button>
                    <span class="upsell-qty-val" id="upsell-qty-val-${p.id}">0</span>
                    <button class="upsell-qty-btn" type="button" aria-label="Agregar ${escapeHtml(p.title)}" onclick="changeNuggetQty('${p.id}', 1)">+</button>
                </div>
            </div>
        </div>
    `).join('');

    const modal = document.getElementById('upsell-modal');
    modal.style.display = 'flex';
    modal.offsetHeight;
    modal.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.changeNuggetQty = (productId, delta) => {
    const product = menuData.find(candidate => candidate.id === String(productId));
    if (!product) return;
    const current = upsellQtys[productId] || 0;
    const newQty = Math.max(0, current + delta);
    const candidate = copyCart();
    if (newQty > 0) {
        const existing = candidate.find(item => item.product_id === product.id && item.type === '');
        if (existing) existing.qty += newQty;
        else candidate.push({ product_id: product.id, title: product.title, type: '', qty: newQty, extras: [] });
    }
    const validation = validateCartAvailability(candidate);
    if (!validation.valid) {
        showAlert('STOCK INSUFICIENTE', validation.message);
        return;
    }
    upsellQtys[productId] = newQty;

    const zeroEl = document.getElementById(`upsell-zero-${productId}`);
    const activeEl = document.getElementById(`upsell-active-${productId}`);
    const valEl = document.getElementById(`upsell-qty-val-${productId}`);

    if (newQty === 0) {
        if (zeroEl) zeroEl.style.display = 'block';
        if (activeEl) activeEl.style.display = 'none';
    } else {
        if (zeroEl) zeroEl.style.display = 'none';
        if (activeEl) activeEl.style.display = 'flex';
        if (valEl) valEl.textContent = newQty;
    }

    const hasSelection = Object.values(upsellQtys).some(q => q > 0);
    const btn = document.getElementById('upsell-proceed-btn');
    if (btn) {
        btn.innerHTML = hasSelection
            ? 'AGREGAR Y CONTINUAR AL PAGO <i data-lucide="arrow-right"></i>'
            : 'NO GRACIAS, CONTINUAR AL PAGO <i data-lucide="arrow-right"></i>';
        btn.classList.toggle('has-selection', hasSelection);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
};

window.proceedFromUpsell = () => {
    const candidate = copyCart();
    Object.entries(upsellQtys).forEach(([productId, qty]) => {
        if (qty <= 0) return;
        const product = menuData.find(p => p.id === productId);
        if (!product) return;
        const existing = candidate.find(i => i.product_id === productId && i.type === '');
        if (existing) {
            existing.qty += qty;
            existing.total = existing.pricePerUnit * existing.qty;
        } else {
            candidate.push({ id: Date.now(), title: product.title, product_id: product.id, type: '', qty, extras: [], pricePerUnit: product.simple, total: product.simple * qty });
        }
    });
    const validation = validateCartAvailability(candidate);
    if (!validation.valid) {
        showAlert('STOCK INSUFICIENTE', validation.message);
        return;
    }
    cart = candidate;
    invalidateCheckoutState();
    upsellQtys = {};
    updateOrderBar();
    const modal = document.getElementById('upsell-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    openCheckoutModal();
};

window.backFromUpsell = () => {
    upsellQtys = {};
    const modal = document.getElementById('upsell-modal');
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    toggleCartModal();
};

window.backFromCheckout = () => {
    closeCheckoutModal();
    setTimeout(() => toggleCartModal(), 420);
};

window.changeQty = (val) => {
    if (!currentProduct) return;
    const maxQty = maxAddableQuantity(currentProduct, currentType, getSelectedModalExtras());
    const requested = Math.max(1, currentQty + val);
    if (requested > maxQty) {
        showAlert('STOCK INSUFICIENTE', `Podés agregar hasta ${maxQty} unidad${maxQty === 1 ? '' : 'es'} con esta configuración.`);
        return;
    }
    currentQty = requested;
    const qtyEl = document.getElementById('modal-qty');
    if (qtyEl) qtyEl.innerText = currentQty;
    updateModalAvailability();
};

function updateModalAvailability() {
    if (!currentProduct) return;
    clearIneligibleMedallionExtras();
    const extras = getSelectedModalExtras();
    const maxQty = maxAddableQuantity(currentProduct, currentType, extras);
    if (maxQty > 0 && currentQty > maxQty) currentQty = maxQty;

    document.querySelectorAll('#product-modal .modal-pill').forEach(button => {
        const type = button.dataset.type;
        const hasPrice = type !== 'Doble' || currentProduct.doble > 0;
        const typeExtras = extras.filter(extra => type === 'Doble' || !isMedallionExtraName(extra.name));
        const available = hasPrice && maxAddableQuantity(currentProduct, type, typeExtras) > 0;
        button.style.display = hasPrice ? '' : 'none';
        button.disabled = !available;
        button.classList.toggle('unavailable', !available);
    });

    document.querySelectorAll('#product-modal .extra-item').forEach(item => {
        const qty = parseInt(item.dataset.qty) || 0;
        const lockedBySize = isMedallionExtraName(item.dataset.name) && currentType !== 'Doble';
        item.classList.toggle('active', qty > 0);
        item.classList.toggle('is-locked', lockedBySize);
        item.setAttribute('aria-disabled', String(lockedBySize));
        const value = item.querySelector('.extra-qty-value');
        if (value) value.textContent = String(qty);
        item.querySelectorAll('.extra-qty-btn').forEach(control => {
            const delta = parseInt(control.dataset.delta) || 0;
            control.disabled = lockedBySize
                || (delta < 0 && qty === 0)
                || (delta > 0 && qty >= getExtraQuantityLimit(item.dataset.name));
        });
    });

    const qtyEl = document.getElementById('modal-qty');
    if (qtyEl) qtyEl.innerText = String(currentQty);
    const qtyButtons = document.querySelectorAll('#product-modal .qty-selector button');
    if (qtyButtons[0]) qtyButtons[0].disabled = currentQty <= 1;
    if (qtyButtons[1]) qtyButtons[1].disabled = maxQty <= 0 || currentQty >= maxQty;

    const addButton = document.getElementById('add-to-cart-big');
    if (addButton) {
        addButton.disabled = maxQty <= 0;
        addButton.classList.toggle('unavailable', maxQty <= 0);
    }
    updateModalPrice();
}

function updateModalPrice() {
    if (!currentProduct) return;
    let base = currentType === "Simple" ? currentProduct.simple : currentProduct.doble;
    let extras = 0;
    document.querySelectorAll('.extra-item').forEach(item => {
        const qty = parseInt(item.dataset.qty) || 0;
        extras += (parseInt(item.dataset.price) || 0) * qty;
    });
    const priceEl = document.getElementById('modal-total-price');
    if (priceEl) priceEl.innerText = `$${((base + extras) * currentQty).toLocaleString()}`;
}

function updateOrderBar() {
    let totalQty = cart.reduce((acc, i) => acc + i.qty, 0);
    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    const headerQty = document.getElementById('cart-qty');
    if (headerQty) headerQty.innerText = totalQty;

    const badge = document.getElementById('cart-badge');
    if (badge) {
        if (totalQty > 0) { badge.textContent = totalQty; badge.style.display = 'flex'; }
        else badge.style.display = 'none';
    }

    const formatted = `$${subtotal.toLocaleString()}`;
    const modalPill = document.getElementById('modal-cart-pill');
    const modalTotal = document.getElementById('modal-cart-total');
    if (modalPill && modalTotal) {
        if (totalQty > 0) { modalPill.style.display = 'flex'; modalTotal.textContent = formatted; }
        else modalPill.style.display = 'none';
    }
    const upsellTotal = document.getElementById('upsell-cart-total');
    if (upsellTotal) upsellTotal.textContent = formatted;

    const bar = document.getElementById('order-bar');
    if (bar) {
        if (cart.length > 0) {
            bar.classList.add('active');
            document.getElementById('bar-items-count').innerText = `${totalQty} ITEM${totalQty > 1 ? 'S' : ''}`;
            document.getElementById('bar-total-price').innerText = `$${subtotal.toLocaleString()}`;
        } else bar.classList.remove('active');
    }

    const fab = document.getElementById('fab-menu');
    if (fab) fab.style.display = totalQty > 0 ? 'none' : '';
}

let _toastTimer = null;
window.showAddedToast = function (name) {
    const toast = document.getElementById('added-toast');
    if (!toast) return;
    toast.querySelector('.toast-name').textContent = name.toUpperCase();
    toast.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
};

window.toggleCartModal = function () {
    const modal = document.getElementById('cart-modal');
    if (!modal) {
        console.error("Cart modal element not found!");
        return;
    }

    if (modal.classList.contains('active')) {
        modal.classList.remove('active');
        setTimeout(() => {
            if (!modal.classList.contains('active')) {
                modal.style.display = 'none';
            }
        }, 400);
    } else {
        renderCartItems();
        modal.style.display = 'flex';
        // Force reflow
        modal.offsetHeight;
        modal.classList.add('active');
        console.log("Cart modal opened");
    }
};

function renderCartItems() {
    const list = document.getElementById('cart-items-list');
    const footer = document.querySelector('.cart-footer');
    if (!list) return;

    if (cart.length === 0) {
        list.innerHTML = `<div class="empty-cart-msg"><i data-lucide="shopping-bag"></i><p>TU CARRITO ESTÁ VACÍO</p></div>`;
        if (footer) footer.style.display = 'none';
    } else {
        if (footer) footer.style.display = 'block';
        list.innerHTML = cart.map((item, idx) => `
            <div class="cart-item">
                <div class="cart-item-info">
                    <h4>${escapeHtml(item.title)}</h4>
                    <span>${escapeHtml(formatCartItemDetails(item).join(' · '))}</span>
                    <div class="cart-qty-controls">
                        <button type="button" aria-label="Quitar una unidad de ${escapeHtml(item.title)}" onclick="updateCartQty(${idx}, -1)"><i data-lucide="minus"></i></button>
                        <span>${item.qty}</span>
                        <button type="button" aria-label="Agregar una unidad de ${escapeHtml(item.title)}" onclick="updateCartQty(${idx}, 1)"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-price">$${item.total.toLocaleString()}</div>
                    <button class="remove-item-btn" type="button" aria-label="Quitar ${escapeHtml(item.title)} del carrito" onclick="removeFromCart(${idx})">
                        <i data-lucide="trash-2"></i>
                        <span>QUITAR ITEM</span>
                    </button>
                </div>
            </div>
        `).join('');

        document.getElementById('cart-final-total').innerText = `$${cart.reduce((a, i) => a + i.total, 0).toLocaleString()}`;
        renderUpsell();
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderUpsell() {
    const upsellGrid = document.getElementById('upsell-items');
    if (!upsellGrid || !menuData.length) return;

    // Filter out items already in cart to suggest other things
    const inCartIds = cart.map(i => i.product_id);
    const suggestions = menuData
        .filter(p => !isDirectProduct(p) && p.stock > 0 && !inCartIds.includes(p.id))
        .slice(0, 3);

    const finalSug = suggestions.length > 0
        ? suggestions
        : menuData.filter(p => !isDirectProduct(p) && p.stock > 0).slice(0, 3);

    upsellGrid.innerHTML = finalSug.map(p => `
        <button type="button" class="upsell-item" onclick="toggleCartModal(); openProductModal('${p.id}')">
            <img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.title)}">
            <h5>${escapeHtml(p.title)}</h5>
            <p>$${p.simple.toLocaleString()}</p>
        </button>
    `).join('');
}

window.clearCart = () => {
    if (!cart.length) return;
    if (confirm('¿Vaciar el carrito?')) {
        cart = [];
        appliedCoupon = null;
        currentSecureQuote = null;
        pendingOrderAttempt = null;
        renderCartItems();
        updateOrderBar();
    }
};

window.removeFromCart = (idx) => {
    cart.splice(idx, 1);
    currentSecureQuote = null;
    pendingOrderAttempt = null;
    renderCartItems();
    updateOrderBar();
};
window.updateCartQty = (idx, chg) => {
    if (!cart[idx]) return;
    const candidate = copyCart();
    candidate[idx].qty = Math.max(1, candidate[idx].qty + chg);
    candidate[idx].total = candidate[idx].pricePerUnit * candidate[idx].qty;
    const validation = validateCartAvailability(candidate);
    if (!validation.valid) {
        showAlert('STOCK INSUFICIENTE', validation.message);
        return;
    }
    cart = candidate;
    currentSecureQuote = null;
    pendingOrderAttempt = null;
    renderCartItems(); updateOrderBar();
};

// 8. MARKETING & CHECKOUT ENGINE
window.applyCoupon = async function () {
    const code = document.getElementById('coupon-input').value.trim().toUpperCase();
    const msg = document.getElementById('coupon-message');
    const button = document.getElementById('apply-coupon-btn');
    if (!code) return;

    button.disabled = true;
    button.innerText = 'VALIDANDO...';
    try {
        const quote = await requestSecureQuote(code);
        currentSecureQuote = quote;
        appliedCoupon = { codigo: quote.couponCode };
        pendingOrderAttempt = null;
        msg.innerText = "¡Cupón aplicado!";
        msg.className = "coupon-msg success";
        button.innerText = "QUITAR";
        button.onclick = removeCoupon;
        updateCheckoutPrices(quote);
    } catch (e) {
        msg.innerText = e.message;
        msg.className = "coupon-msg error";
        appliedCoupon = null;
        currentSecureQuote = null;
        button.innerText = 'APLICAR';
        button.onclick = applyCoupon;
        updateCheckoutPrices();
    } finally {
        button.disabled = false;
    }
};

window.removeCoupon = async function () {
    appliedCoupon = null;
    currentSecureQuote = null;
    pendingOrderAttempt = null;
    document.getElementById('coupon-input').value = "";
    document.getElementById('coupon-message').innerText = "";
    document.getElementById('apply-coupon-btn').innerText = "APLICAR";
    document.getElementById('apply-coupon-btn').onclick = applyCoupon;
    await refreshSecureQuote();
};

async function refreshSecureQuote({ showError = false } = {}) {
    const requestId = ++secureQuoteRequestId;
    try {
        const quote = await requestSecureQuote();
        if (requestId !== secureQuoteRequestId) return null;
        currentSecureQuote = quote;
        updateCheckoutPrices(quote);
        return quote;
    } catch (error) {
        if (requestId !== secureQuoteRequestId) return null;
        currentSecureQuote = null;
        updateCheckoutPrices();
        if (showError) showAlert('NO PUDIMOS VALIDAR EL PEDIDO', error.message);
        return null;
    }
}

window.selectPay = function(method) {
    selectedPayMethod = method;
    document.querySelectorAll('.pay-select-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`select-${method}`).classList.add('active');
    const aliasBox = document.getElementById('alias-box');
    if (aliasBox) aliasBox.style.display = method === 'transferencia' ? 'block' : 'none';
    const finalizarBtn = document.getElementById('finalizar-btn');
    if (finalizarBtn) finalizarBtn.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.copyAlias = function() {
    navigator.clipboard.writeText('RIOH.BURGERS').then(() => {
        const btn = document.querySelector('.copy-alias-btn');
        if (!btn) return;
        btn.innerHTML = '✓';
        btn.style.background = '#28a745';
        setTimeout(() => {
            btn.innerHTML = '<i data-lucide="copy"></i>';
            btn.style.background = '';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }, 1800);
    });
};

function getSelectedZoneKey() {
    const zoneSelect = document.getElementById('shipping-zone');
    return zoneSelect?.options[zoneSelect.selectedIndex]?.dataset.zone || '';
}

function isSchedulingSlotEnabled() {
    return currentDeliveryMethod === 'pickup'
        || (currentDeliveryMethod === 'delivery' && DELIVERY_ZONE_KEYS.has(getSelectedZoneKey()));
}

function buildDeliverySlots() {
    if (!storeHoursConfig) return [];
    const nowInstant = new Date();
    const earliest = new Date(nowInstant.getTime() + DELIVERY_PREP_MINUTES * 60 * 1000);
    const now = getZonedDateParts(nowInstant);
    const [openHour, openMinute] = (storeHoursConfig.hora_apertura || '18:00').split(':').map(Number);
    const [closeHour, closeMinute] = (storeHoursConfig.hora_cierre || '00:00').split(':').map(Number);
    const openMinutes = openHour * 60 + openMinute;
    const rawCloseMinutes = closeHour * 60 + closeMinute;
    const isOvernight = rawCloseMinutes <= openMinutes;
    const closeMinutes = rawCloseMinutes + (isOvernight ? 24 * 60 : 0);
    const days = (storeHoursConfig.dias || []).map(Number);
    const slots = [];

    let serviceDate = new Date(Date.UTC(now.year, now.month - 1, now.day));
    let serviceWeekday = now.weekday;
    const currentMinutes = now.hour * 60 + now.minute;
    if (isOvernight && rawCloseMinutes > 0 && currentMinutes < rawCloseMinutes) {
        serviceDate = new Date(Date.UTC(now.year, now.month - 1, now.day - 1));
        serviceWeekday = (now.weekday + 6) % 7;
    }

    if (!days.includes(serviceWeekday) && !isMasterOnline) return slots;
    const firstSlot = Math.ceil(openMinutes / DELIVERY_SLOT_MINUTES) * DELIVERY_SLOT_MINUTES;
    for (let minutes = firstSlot; minutes <= closeMinutes; minutes += DELIVERY_SLOT_MINUTES) {
        const dateOffset = Math.floor(minutes / (24 * 60));
        const localDate = new Date(Date.UTC(
            serviceDate.getUTCFullYear(),
            serviceDate.getUTCMonth(),
            serviceDate.getUTCDate() + dateOffset
        ));
        const localHour = Math.floor((minutes % (24 * 60)) / 60);
        const localMinute = minutes % 60;
        const slot = zonedLocalToInstant(
            localDate.getUTCFullYear(),
            localDate.getUTCMonth() + 1,
            localDate.getUTCDate(),
            localHour,
            localMinute
        );
        if (slot.getTime() < earliest.getTime()) continue;
        const label = `${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`;
        slots.push({ label, value: slot.toISOString() });
    }

    return slots;
}

function updateDeliveryTimeOptions() {
    const group = document.getElementById('delivery-time-group');
    const select = document.getElementById('delivery-time');
    const help = document.getElementById('delivery-time-help');
    const label = document.getElementById('delivery-time-label');
    if (!group || !select || !help) return;

    const previousValue = select.value;
    const enabled = isSchedulingSlotEnabled();
    if (label) label.textContent = currentDeliveryMethod === 'pickup' ? 'HORARIO DE RETIRO' : 'HORARIO DE ENTREGA';
    group.classList.toggle('is-disabled', !enabled);
    select.disabled = !enabled;
    select.required = enabled;

    if (!enabled) {
        select.innerHTML = '<option value="">HORARIO A COORDINAR</option>';
        help.textContent = 'Para esta zona coordinamos el horario después de recibir el pedido.';
        return;
    }

    const slots = buildDeliverySlots();
    if (!slots.length) {
        select.innerHTML = '<option value="">SIN TURNOS DISPONIBLES HOY</option>';
        help.textContent = 'Ya no quedan horarios disponibles para hoy.';
        return;
    }

    select.innerHTML = '<option value="">ELEGÍ UN HORARIO</option>' +
        slots.map(slot => `<option value="${slot.value}">${slot.label}</option>`).join('');
    if (slots.some(slot => slot.value === previousValue)) select.value = previousValue;
    help.textContent = currentDeliveryMethod === 'pickup'
        ? `Elegí cuándo retirar. Turnos cada ${DELIVERY_SLOT_MINUTES} minutos, con ${DELIVERY_PREP_MINUTES} minutos de preparación.`
        : `Turnos cada ${DELIVERY_SLOT_MINUTES} minutos, con ${DELIVERY_PREP_MINUTES} minutos de preparación.`;
}

function fillCheckoutProfile(profile, onlyEmpty = true) {
    if (!profile) return;
    const fields = {
        'cust-name': profile.nombre,
        'cust-phone': profile.whatsapp,
        'cust-email': profile.email,
        'cust-address': profile.direccion,
        'cust-doorbell': profile.timbre
    };
    Object.entries(fields).forEach(([id, value]) => {
        const input = document.getElementById(id);
        if (!input || !value || (onlyEmpty && input.value.trim())) return;
        input.value = value;
    });
}

function getLastOrderReceipt() {
    return readStoredJson(LAST_ORDER_KEY);
}

function initializeLastOrderReceipt() {
    const btn = document.getElementById('last-order-btn');
    if (!btn) return;
    btn.style.display = getLastOrderReceipt() ? 'flex' : 'none';
}

function formatReceiptTime(isoValue) {
    if (!isoValue) return 'A coordinar';
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'A coordinar';
    return date.toLocaleTimeString('es-AR', {
        timeZone: STORE_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    });
}

function paymentLabel(method) {
    return method === 'transferencia' ? 'Transferencia bancaria' : 'Efectivo';
}

function renderOrderConfirmation(receipt) {
    if (!receipt) return;
    const modal = document.getElementById('confirmation-modal');
    const numberEl = document.getElementById('confirmation-order-number');
    const statusEl = document.getElementById('confirmation-status-copy');
    const summaryEl = document.getElementById('confirmation-summary');
    if (!modal || !numberEl || !statusEl || !summaryEl) return;

    numberEl.textContent = `PEDIDO #${receipt.numeroPedido || '---'}`;
    statusEl.textContent = receipt.paymentMethod === 'transferencia'
        ? 'Tu pedido está registrado. La transferencia queda pendiente de comprobante.'
        : 'Tu pedido está registrado. Abonás en efectivo al recibirlo o retirarlo.';

    const itemsHtml = (receipt.items || []).map(item => {
        const detail = formatCartItemDetails(item).join(' · ');
        return `<div class="confirmation-item">
            <div>
                <strong>${parseInt(item.qty) || 1}× ${escapeHtml(item.title)}</strong>
                ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
            </div>
            <b>$${Number(item.total || 0).toLocaleString('es-AR')}</b>
        </div>`;
    }).join('');

    const deliveryTitle = receipt.deliveryMethod === 'pickup'
        ? `Retiro en local · ${formatReceiptTime(receipt.deliveryAt)} hs`
        : `${receipt.zone || 'Delivery'} · ${formatReceiptTime(receipt.deliveryAt)} hs`;
    const deliveryDetail = receipt.deliveryMethod === 'pickup'
        ? 'Retirá tu pedido en el horario elegido.'
        : [receipt.address, receipt.doorbell ? `Timbre/Depto: ${receipt.doorbell}` : ''].filter(Boolean).join(' · ');
    const benefitLabel = receipt.benefitType === 'coupon'
        ? `Cupón ${receipt.benefitLabel || receipt.couponCode || ''}`.trim()
        : receipt.benefitType === 'promotion'
            ? `Promoción ${receipt.benefitLabel || ''}`.trim()
            : 'Descuento';

    summaryEl.innerHTML = `
        <div class="confirmation-items">${itemsHtml}</div>
        <div class="confirmation-divider"></div>
        <div class="confirmation-delivery">
            <span>ENTREGA</span>
            <strong>${escapeHtml(deliveryTitle)}</strong>
            ${deliveryDetail ? `<p>${escapeHtml(deliveryDetail)}</p>` : ''}
        </div>
        ${receipt.notes ? `<div class="confirmation-note"><span>NOTA</span><p>${escapeHtml(receipt.notes)}</p></div>` : ''}
        <div class="confirmation-totals">
            <div><span>Subtotal</span><b>$${Number(receipt.subtotal || 0).toLocaleString('es-AR')}</b></div>
            ${receipt.discount > 0 ? `<div class="confirmation-benefit"><span>${escapeHtml(benefitLabel)}</span><b>-$${Number(receipt.discount).toLocaleString('es-AR')}</b></div>` : ''}
            <div><span>Envío</span><b>${receipt.shipping > 0 ? `$${Number(receipt.shipping).toLocaleString('es-AR')}` : 'GRATIS'}</b></div>
            <div class="confirmation-total"><span>TOTAL</span><b>$${Number(receipt.total || 0).toLocaleString('es-AR')}</b></div>
            <div><span>Pago</span><b>${escapeHtml(paymentLabel(receipt.paymentMethod))}</b></div>
        </div>`;

    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.openLastOrderReceipt = function() {
    const receipt = getLastOrderReceipt();
    if (!receipt) {
        initializeLastOrderReceipt();
        showAlert('SIN COMPROBANTE', 'Todavía no hay un pedido guardado en este dispositivo.');
        return;
    }
    renderOrderConfirmation(receipt);
};

window.closeConfirmationModal = function() {
    const modal = document.getElementById('confirmation-modal');
    if (!modal) return;
    modal.classList.remove('active');
    setTimeout(() => { modal.style.display = 'none'; }, 350);
    document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function buildOrderWhatsAppUrl(receipt) {
    if (!receipt) return '';
    const itemLines = (receipt.items || []).map(item => {
        const details = formatCartItemDetails(item).join(' · ');
        return `• ${parseInt(item.qty) || 1}x ${item.title}${details ? ` (${details})` : ''} — $${Number(item.total || 0).toLocaleString('es-AR')}`;
    });
    const delivery = receipt.deliveryMethod === 'pickup'
        ? `Retiro en local - ${formatReceiptTime(receipt.deliveryAt)} hs`
        : `${receipt.zone || 'Delivery'} - ${formatReceiptTime(receipt.deliveryAt)} hs\n${receipt.address || ''}${receipt.doorbell ? ` - Timbre/Depto: ${receipt.doorbell}` : ''}`;
    const benefit = receipt.discount > 0
        ? `${receipt.benefitType === 'coupon' ? 'Cupón' : receipt.benefitType === 'promotion' ? 'Promoción' : 'Descuento'}${receipt.benefitLabel ? ` ${receipt.benefitLabel}` : ''}: -$${Number(receipt.discount).toLocaleString('es-AR')}`
        : '';
    const message = [
        `Hola RIOH. Quiero dejar registrado mi pedido #${receipt.numeroPedido || '---'}.`,
        '',
        ...itemLines,
        '',
        `Entrega: ${delivery}`,
        receipt.notes ? `Nota: ${receipt.notes}` : '',
        benefit,
        `Pago: ${paymentLabel(receipt.paymentMethod)}`,
        `Total: $${Number(receipt.total || 0).toLocaleString('es-AR')}`
    ].filter(Boolean).join('\n');
    return `https://wa.me/${RIOH_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

window.sendLastOrderWhatsApp = function() {
    const whatsappUrl = buildOrderWhatsAppUrl(getLastOrderReceipt());
    if (!whatsappUrl) return;
    window.open(whatsappUrl, '_blank', 'noopener');
};

window.openCheckoutModal = async function () {
    if (cart.length === 0) return;
    const refreshed = await loadMenu({ silent: true });
    if (!refreshed) {
        showAlert('NO PUDIMOS VALIDAR EL STOCK', 'Revisá tu conexión e intentá continuar nuevamente.');
        return;
    }
    const availability = validateCartAvailability(cart);
    if (!availability.valid) {
        showAlert('REVISÁ TU PEDIDO', availability.message);
        renderCartItems();
        return;
    }
    // Reset payment selection
    selectedPayMethod = null;
    document.querySelectorAll('.pay-select-btn').forEach(b => b.classList.remove('active'));
    const aliasBox = document.getElementById('alias-box');
    if (aliasBox) aliasBox.style.display = 'none';
    const finalizarBtn = document.getElementById('finalizar-btn');
    if (finalizarBtn) finalizarBtn.style.display = 'none';
    const guestHint = document.getElementById('guest-hint-block');
    if (guestHint) guestHint.style.display = currentUser ? 'none' : 'block';
    updateDeliveryTimeOptions();
    updateCheckoutPrices();
    const modal = document.getElementById('checkout-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    await refreshSecureQuote({ showError: true });
};

window.updateCheckoutPrices = function (quote = null) {
    updateDeliveryTimeOptions();
    const validQuote = quote?._key === secureQuoteKey()
        ? quote
        : (currentSecureQuote?._key === secureQuoteKey() ? currentSecureQuote : null);
    const displayItems = Array.isArray(validQuote?.items) ? validQuote.items : cart;
    const itemsList = document.getElementById('checkout-items-list');
    if (itemsList) {
        itemsList.innerHTML = displayItems.map(item => {
            const detail = formatCartItemDetails(item).join(' · ');
            return `
            <div class="checkout-item-row">
                <div class="checkout-item-name">
                    <span class="checkout-item-qty">${item.qty}×</span>
                    <span>${escapeHtml(item.title)}${detail ? `<br><small>${escapeHtml(detail)}</small>` : ''}</span>
                </div>
                <span class="checkout-item-price">$${Number(item.total || 0).toLocaleString('es-AR')}</span>
            </div>`;
        }).join('');
    }

    const subtotal = validQuote
        ? Number(validQuote.subtotal || 0)
        : cart.reduce((acc, item) => acc + Number(item.total || 0), 0);
    const discount = validQuote ? Number(validQuote.discount || 0) : 0;
    const shipping = validQuote ? Number(validQuote.shipping || 0) : 0;
    const total = validQuote ? Number(validQuote.total || 0) : subtotal;

    document.getElementById('summary-subtotal').innerText = `$${subtotal.toLocaleString('es-AR')}`;
    const discRow = document.getElementById('discount-row');
    const discLabel = document.getElementById('summary-discount-label');
    if (discount > 0) {
        discRow.style.display = 'flex';
        if (discLabel) {
            discLabel.textContent = validQuote?.benefitType === 'coupon'
                ? `CUPÓN ${validQuote.benefitLabel || validQuote.couponCode || ''}`.trim()
                : validQuote?.benefitType === 'promotion'
                    ? `PROMOCIÓN ${validQuote.benefitLabel || ''}`.trim()
                    : 'DESCUENTO';
        }
        document.getElementById('summary-discount').innerText = `-$${discount.toLocaleString('es-AR')}`;
    } else {
        discRow.style.display = 'none';
        if (discLabel) discLabel.textContent = 'DESCUENTO';
    }

    const shipEl = document.getElementById('summary-shipping');
    if (shipEl) {
        shipEl.innerText = shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString('es-AR')}`;
        shipEl.className = shipping === 0 ? "free" : "";
    }

    document.getElementById('summary-total').innerText = `$${total.toLocaleString('es-AR')}`;
};

window.openCoverageModal = () => {
    const modal = document.getElementById('coverage-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
};

window.closeCoverageModal = () => {
    const modal = document.getElementById('coverage-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 400);
};

window.closeCheckoutModal = () => {
    const modal = document.getElementById('checkout-modal');
    modal.classList.remove('active');
    setTimeout(() => modal.style.display = 'none', 400);
};

// Reset completo de la pantalla tras confirmar un pedido: carrito vacío,
// todos los modales del flujo cerrados y formulario limpio ("pantalla a cero")
function resetOrderFlowUI() {
    ['checkout-modal', 'cart-modal', 'upsell-modal'].forEach(id => {
        const m = document.getElementById(id);
        if (m) { m.classList.remove('active'); m.style.display = 'none'; }
    });
    updateOrderBar();
    ['cust-name', 'cust-phone', 'cust-email', 'cust-address', 'cust-doorbell', 'cust-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const deliveryTime = document.getElementById('delivery-time');
    if (deliveryTime) deliveryTime.value = '';
    const couponInput = document.getElementById('coupon-input');
    if (couponInput) couponInput.value = '';
    const couponMsg = document.getElementById('coupon-message');
    if (couponMsg) couponMsg.innerText = '';
    const applyBtn = document.getElementById('apply-coupon-btn');
    if (applyBtn) { applyBtn.innerText = 'APLICAR'; applyBtn.onclick = window.applyCoupon; }
}

document.addEventListener('DOMContentLoaded', () => {
    const zoneSelect = document.getElementById('shipping-zone');
    if (zoneSelect) {
        zoneSelect.addEventListener('change', () => {
            currentSecureQuote = null;
            pendingOrderAttempt = null;
            updateDeliveryTimeOptions();
            refreshSecureQuote();
        });
    }
    const deliveryTime = document.getElementById('delivery-time');
    if (deliveryTime) {
        deliveryTime.addEventListener('change', () => {
            if (deliveryTime.value) {
                deliveryTime.style.borderColor = '#2E7D32';
            } else {
                deliveryTime.style.borderColor = '';
            }
        });
    }
});

// Toggle delivery
document.querySelectorAll('.method-pill').forEach(pill => {
    pill.onclick = () => {
        document.querySelectorAll('.method-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentDeliveryMethod = pill.dataset.method;
        currentSecureQuote = null;
        pendingOrderAttempt = null;
        document.getElementById('address-section').style.display = (currentDeliveryMethod === 'pickup') ? 'none' : 'block';
        updateDeliveryTimeOptions();
        updateCheckoutPrices();
        refreshSecureQuote();
    };
});

// Final Checkout
window.submitOrder = async function () {
    if (!selectedPayMethod) return;
    const form = document.getElementById('checkout-form');
    if (form && !form.checkValidity()) { form.reportValidity(); return; }

    if (currentDeliveryMethod === 'delivery') {
        const addr = document.getElementById('cust-address')?.value?.trim() || '';
        if (!addr) {
            showAlert("FALTA LA DIRECCIÓN", "Ingresá la dirección de entrega para el delivery, o elegí retiro por el local.");
            return;
        }
        if (isSchedulingSlotEnabled() && !document.getElementById('delivery-time')?.value) {
            showAlert("FALTA EL HORARIO", "Elegí un horario de entrega para continuar.");
            return;
        }
    }
    if (currentDeliveryMethod === 'pickup' && !document.getElementById('delivery-time')?.value) {
        showAlert("FALTA EL HORARIO", "Elegí un horario de retiro para continuar.");
        return;
    }

    const finalizarBtn = document.getElementById('finalizar-btn');
    if (finalizarBtn) {
        finalizarBtn.disabled = true;
        finalizarBtn.innerHTML = '<span class="loading-spinner"></span> PROCESANDO...';
    }

    try {
        const refreshed = await loadMenu({ silent: true });
        const availability = refreshed
            ? validateCartAvailability(cart)
            : { valid: false, message: 'No pudimos verificar el stock. Revisá tu conexión.' };
        if (!availability.valid) throw new Error(availability.message);

        const serverAvailability = await validateCartAvailabilityOnServer(cart);
        if (!serverAvailability.valid) throw new Error(serverAvailability.message);
        currentSecureQuote = serverAvailability.quote;
        updateCheckoutPrices(currentSecureQuote);

        const payload = {
            p_items: serializeCartForServer(),
            p_nombre: document.getElementById('cust-name').value.trim(),
            p_whatsapp: document.getElementById('cust-phone').value.trim(),
            p_email: document.getElementById('cust-email').value.trim() || null,
            p_metodo_entrega: currentDeliveryMethod,
            p_zona: currentDeliveryMethod === 'delivery' ? getSelectedZoneKey() : null,
            p_direccion: document.getElementById('cust-address')?.value?.trim() || '',
            p_timbre: document.getElementById('cust-doorbell')?.value?.trim() || null,
            p_nota: document.getElementById('cust-notes')?.value?.trim() || null,
            p_entrega_programada: isSchedulingSlotEnabled()
                ? document.getElementById('delivery-time')?.value || null
                : null,
            p_metodo_pago: selectedPayMethod,
            p_codigo_cupon: appliedCoupon?.codigo || null
        };
        const fingerprint = JSON.stringify(payload);
        if (!pendingOrderAttempt || pendingOrderAttempt.fingerprint !== fingerprint) {
            pendingOrderAttempt = {
                fingerprint,
                id: createOperationId()
            };
        }

        const { data: receipt, error } = await supabaseClient.rpc('crear_pedido_seguro', {
            ...payload,
            p_idempotency_key: pendingOrderAttempt.id
        });
        if (error) throw new Error(serverErrorMessage(error, 'No pudimos crear el pedido. Intentá nuevamente.'));

        writeStoredJson(LAST_ORDER_KEY, receipt, LAST_ORDER_TTL_MS);
        initializeLastOrderReceipt();
        cart = [];
        appliedCoupon = null;
        currentSecureQuote = null;
        pendingOrderAttempt = null;
        resetOrderFlowUI();
        renderOrderConfirmation(receipt);
        const whatsappUrl = buildOrderWhatsAppUrl(receipt);
        if (whatsappUrl) window.location.assign(whatsappUrl);
    } catch (error) {
        console.error('Checkout error:', error);
        showAlert('REVISÁ TU PEDIDO', error.message || 'Hubo un problema al procesar el pedido. Intentá nuevamente.');
    } finally {
        if (finalizarBtn) {
            finalizarBtn.disabled = false;
            finalizarBtn.innerHTML = '<i data-lucide="check-circle"></i> FINALIZAR PEDIDO';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
};
