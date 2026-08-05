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
    if (typeof window.supabase !== 'undefined') {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        console.log("Supabase initialized successfully");
    } else {
        console.error("Supabase SDK not found");
    }
}

// 3. APP STATE
let menuData = [];
let productCategories = [];
let ingredientInventory = [];
let extraInventoryRules = [];
let cart = [];
let activePromos = [];
let appliedCoupon = null;
let currentProduct = null;
let currentQty = 1;
let currentType = "Simple";
let currentDeliveryMethod = "delivery";
let isMasterOnline = true;
let upsellQtys = {};
let selectedPayMethod = null;
let catalogRefreshTimer = null;

const LEGACY_CATEGORIES = [
    { id: 'legacy-burgers', slug: 'burgers', nombre: 'Burgers', descripcion: '', tipo_venta: 'configurable', activo: true, orden: 0 },
    { id: 'legacy-extras', slug: 'extras', nombre: 'Para acompañar', descripcion: '', tipo_venta: 'directo', activo: true, orden: 1 }
];

const LEGACY_EXTRA_INGREDIENT_RULES = {
    'medallon extra': { search: ['medallon'], quantity: 1 },
    'extra cheddar': { search: ['cheddar'], quantity: 2 },
    'extra bacon': { search: ['panceta ahumada'], quantity: 2 }
};

const RIOH_WHATSAPP_NUMBER = '5491136082374';
const LAST_ORDER_KEY = 'rioh_last_order_v1';
const GUEST_PROFILE_KEY = 'rioh_checkout_profile_v1';
const DELIVERY_PREP_MINUTES = 30;
const DELIVERY_SLOT_MINUTES = 15;
const DELIVERY_ZONE_KEYS = new Set([
    'saavedra',
    'nunez',
    'belgrano',
    'florida',
    'villa-martelli',
    'villa-urquiza'
]);

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
    return productCategories.find(category => category.slug === product.category) || null;
}

function isDirectProduct(product) {
    return getCategoryForProduct(product)?.tipo_venta === 'directo';
}

function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
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

function readStoredJson(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function writeStoredJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (_) {
        return false;
    }
}

// 3.1 STORE HOURS LOGIC
let storeHoursConfig = null;

function getStoreStatus() {
    if (localStorage.getItem('rioh_demo') === '1') {
        return { open: true };
    }

    // Toggle ON = manual override, store is ALWAYS open
    if (isMasterOnline) {
        return { open: true };
    }

    // Toggle OFF = check if we're within scheduled hours (automatic mode)
    if (storeHoursConfig && storeHoursConfig.dias && storeHoursConfig.dias.length) {
        const now = new Date();
        const currentDay = now.getDay();
        const currentTime = now.getHours() * 60 + now.getMinutes();

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
        const now = new Date();
        const currentDay = now.getDay();
        const nextDay = storeHoursConfig.dias.find(d => d > currentDay) ?? storeHoursConfig.dias[0];
        const nextDayName = dayNames[nextDay] || '';
        const nextTime = storeHoursConfig.hora_apertura || '18:00';
        return { open: false, nextOpening: `el ${nextDayName} a las ${nextTime}` };
    }

    return { open: false, nextOpening: 'cuando la tienda vuelva a abrir' };
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
    el.innerHTML = `${days}<br>${storeHoursConfig.hora_apertura || '18:00'} a ${storeHoursConfig.hora_cierre || '00:00'}`;
}

// 4. INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    initSupabase();
    initListeners();
    initAuth();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    loadMenu();
    loadActivePromos();
    fetchMasterStatus();
    fetchStoreHours();
    subscribeToStoreChanges();
    initScrollButtons();
    restoreGuestCheckoutProfile();
    initializeLastOrderReceipt();

    // Initial status check
    const status = getStoreStatus();
    if (!status.open) {
        console.log("Store is currently closed.");
    }
});

async function fetchMasterStatus() {
    // Demo mode override: skip Supabase check
    if (localStorage.getItem('rioh_demo') === '1') {
        isMasterOnline = true;
        showDemoBanner();
        return;
    }

    // Check localStorage fallback (set by admin panel when Supabase write fails)
    const localOverride = localStorage.getItem('rioh_master_online');
    if (localOverride !== null) {
        isMasterOnline = localOverride === '1';
    }

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
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, scheduleCatalogRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'insumos' }, scheduleCatalogRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'extras_inventario' }, scheduleCatalogRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'categorias_productos' }, scheduleCatalogRefresh);

    channel.subscribe();
}

function scheduleCatalogRefresh() {
    clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = setTimeout(() => loadMenu({ silent: true }), 180);
}

function showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
        background: #FFD600; color: #111; text-align: center;
        padding: 6px; font-family: 'Archivo Black', sans-serif;
        font-size: 0.75rem; border-bottom: 2px solid #111;
        letter-spacing: 0.08em;
    `;
    banner.textContent = '⚡ MODO DEMO ACTIVO — para desactivarlo, usá el panel de admin';
    document.body.prepend(banner);
}

// 5. DATA LOADING & INVENTORY
async function loadMenu({ silent = false } = {}) {
    if (!supabaseClient) {
        console.error("Cannot load menu: Supabase client not initialized");
        return false;
    }

    try {
        const [productsResult, categoriesResult, ingredientsResult, extraRulesResult] = await Promise.all([
            supabaseClient.from('productos').select('*').eq('activo', true),
            supabaseClient.from('categorias_productos').select('*').eq('activo', true).order('orden', { ascending: true }),
            supabaseClient.from('insumos').select('id, nombre, stock_actual'),
            supabaseClient.from('extras_inventario').select('nombre_extra, ingrediente_id, cantidad').eq('activo', true)
        ]);

        if (productsResult.error) throw productsResult.error;
        if (ingredientsResult.error) throw ingredientsResult.error;

        const rawProducts = productsResult.data || [];
        ingredientInventory = (ingredientsResult.data || []).map(ingredient => ({
            id: String(ingredient.id),
            nombre: ingredient.nombre || '',
            stock_actual: Math.max(0, Number(ingredient.stock_actual) || 0)
        }));
        extraInventoryRules = extraRulesResult.error
            ? Object.entries(LEGACY_EXTRA_INGREDIENT_RULES).map(([normalizedName, rule]) => ({ normalizedName, ...rule }))
            : (extraRulesResult.data || []).map(rule => ({
                normalizedName: normalizeSearchText(rule.nombre_extra),
                ingredientId: String(rule.ingrediente_id),
                quantity: Math.max(0, Number(rule.cantidad) || 0)
            }));
        if (extraRulesResult.error) {
            console.warn('No se pudo cargar extras_inventario; se usa compatibilidad temporal.', extraRulesResult.error);
        }

        if (categoriesResult.error) {
            console.warn('No se pudieron cargar categorias_productos; se usa compatibilidad temporal.', categoriesResult.error);
            const foundSlugs = [...new Set(rawProducts.map(product => String(product.categoria || 'burgers').toLowerCase()))];
            productCategories = foundSlugs.map((slug, index) => {
                const legacy = LEGACY_CATEGORIES.find(category => category.slug === slug);
                return normalizeCategory(legacy || {
                    id: `legacy-${slug}`,
                    slug,
                    nombre: slug.replace(/[-_]+/g, ' '),
                    tipo_venta: 'configurable',
                    activo: true,
                    orden: index + 10
                });
            }).sort((a, b) => a.orden - b.orden);
        } else {
            productCategories = (categoriesResult.data || []).map(normalizeCategory);
        }

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
                img: imgUrl,
                destacado: Boolean(product.destacado),
                directStock: Math.max(0, Math.floor(Number(product.stock) || 0)),
                receta: product.receta || null,
                orden: Number.isFinite(Number(product.orden)) ? Number(product.orden) : 0
            };
        }).sort((a, b) => a.orden - b.orden || a.title.localeCompare(b.title, 'es'));

        menuData.forEach(product => {
            product.maxSimple = getProductCapacity(product, 'Simple');
            product.maxDoble = product.doble > 0 ? getProductCapacity(product, 'Doble') : 0;
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

function getRecipeIngredients(product) {
    return Array.isArray(product?.receta?.ingredientes) ? product.receta.ingredientes : [];
}

function findIngredientById(id) {
    return ingredientInventory.find(ingredient => ingredient.id === String(id));
}

function findExtraRule(extraName) {
    return extraInventoryRules.find(rule => rule.normalizedName === normalizeSearchText(extraName)) || null;
}

function findExtraIngredient(extraName) {
    const rule = findExtraRule(extraName);
    if (!rule) return null;
    if (rule.ingredientId) return findIngredientById(rule.ingredientId) || null;
    return ingredientInventory.find(ingredient => {
        const normalizedName = normalizeSearchText(ingredient.nombre);
        return rule.search.some(term => normalizedName.includes(normalizeSearchText(term)));
    }) || null;
}

function addRequirement(requirements, ingredientId, amount) {
    const parsedAmount = Number(amount);
    if (!ingredientId || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    const key = String(ingredientId);
    requirements[key] = (requirements[key] || 0) + parsedAmount;
}

function getUnitIngredientRequirements(product, type, extras = []) {
    const requirements = {};
    const missing = [];
    const isDouble = normalizeSearchText(type) === 'doble';

    for (const recipeItem of getRecipeIngredients(product)) {
        const ingredient = findIngredientById(recipeItem.ingrediente_id);
        const baseQuantity = Number(recipeItem.cantidad);
        if (!ingredient || !Number.isFinite(baseQuantity) || baseQuantity <= 0) {
            missing.push(recipeItem.nombre || 'un ingrediente de la receta');
            continue;
        }
        const configuredMultiplier = Number(recipeItem.doble_mult);
        const doubleMultiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
            ? configuredMultiplier
            : 1;
        addRequirement(requirements, ingredient.id, baseQuantity * (isDouble ? doubleMultiplier : 1));
    }

    for (const extra of extras || []) {
        const name = typeof extra === 'string' ? extra : extra?.name;
        const extraQty = typeof extra === 'string' ? 1 : Math.max(1, parseInt(extra?.qty) || 1);
        const rule = findExtraRule(name);
        if (!rule) {
            missing.push(name || 'un extra');
            continue;
        }
        const ingredient = findExtraIngredient(name);
        if (!ingredient) {
            missing.push(name || 'un extra');
            continue;
        }
        addRequirement(requirements, ingredient.id, Number(rule.quantity) * extraQty);
    }

    return { requirements, missing };
}

function getProductCapacity(product, type = 'Simple', extras = []) {
    if (!product) return 0;
    const hasRecipe = getRecipeIngredients(product).length > 0;
    const { requirements, missing } = getUnitIngredientRequirements(product, type, extras);
    if (missing.length) return 0;
    if (hasRecipe && !Object.keys(requirements).length) return 0;

    return Object.entries(requirements).reduce((capacity, [ingredientId, required]) => {
        const stock = findIngredientById(ingredientId)?.stock_actual || 0;
        return Math.min(capacity, Math.floor(stock / required));
    }, hasRecipe ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(Number(product.directStock) || 0)));
}

function validateCartAvailability(items = cart) {
    const ingredientRequirements = {};
    const productRequirements = {};

    for (const item of items) {
        const product = menuData.find(candidate => candidate.id === String(item.product_id));
        const qty = parseInt(item.qty);
        if (!product) return { valid: false, message: `${item.title || 'Un producto'} ya no está disponible.` };
        if (!getCategoryForProduct(product)) return { valid: false, message: `${product.title} pertenece a una categoría que ya no está disponible.` };
        if (!Number.isInteger(qty) || qty <= 0 || qty > 100) return { valid: false, message: `La cantidad de ${product.title} no es válida.` };

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
        }

        const { requirements, missing } = getUnitIngredientRequirements(product, directSale ? 'Simple' : item.type, item.extras || []);
        if (missing.length) {
            return { valid: false, message: `${product.title} no está disponible porque falta ${missing[0]}.` };
        }
        for (const [ingredientId, amount] of Object.entries(requirements)) {
            addRequirement(ingredientRequirements, ingredientId, amount * qty);
        }
        if (getRecipeIngredients(product).length === 0) {
            productRequirements[product.id] = (productRequirements[product.id] || 0) + qty;
        }
    }

    for (const [productId, required] of Object.entries(productRequirements)) {
        const product = menuData.find(candidate => candidate.id === productId);
        if (!product || required > product.directStock) {
            return { valid: false, message: `No hay stock suficiente de ${product?.title || 'uno de los productos'}.` };
        }
    }

    for (const [ingredientId, required] of Object.entries(ingredientRequirements)) {
        const ingredient = findIngredientById(ingredientId);
        if (!ingredient || required > ingredient.stock_actual + 1e-9) {
            return { valid: false, message: `No hay insumos suficientes para preparar todo el pedido${ingredient?.nombre ? ` (${ingredient.nombre})` : ''}.` };
        }
    }

    return { valid: true, message: '' };
}

async function validateCartAvailabilityOnServer(items = cart) {
    if (!supabaseClient) return { valid: false, message: 'No se pudo conectar con el inventario.' };
    const { data, error } = await supabaseClient.rpc('validar_stock_carrito', { p_items: items });
    if (error) {
        const migrationPending = error.code === 'PGRST202'
            || /could not find.*validar_stock_carrito.*schema cache/i.test(error.message || '');
        if (migrationPending) {
            console.warn('Validación transaccional pendiente de migración; se usa la validación local.', error);
            return { valid: true, legacyFallback: true };
        }
        console.error('Server inventory validation error:', error);
        return { valid: false, message: 'No pudimos validar el stock en el servidor. Intentá nuevamente.' };
    }
    return data?.ok
        ? { valid: true }
        : { valid: false, message: data?.error || 'Uno de los productos ya no tiene stock suficiente.' };
}

function copyCart() {
    return cart.map(item => ({ ...item, extras: (item.extras || []).map(extra => typeof extra === 'string' ? extra : { ...extra }) }));
}

function maxAddableQuantity(product, type, extras = []) {
    if (!product) return 0;
    const absoluteCapacity = getProductCapacity(product, type, extras);
    if (absoluteCapacity <= 0) return 0;

    let low = 0;
    let high = Math.min(absoluteCapacity, 100);
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

async function loadActivePromos() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('promociones').select('*').eq('activo', true);
        if (error) throw error;
        activePromos = data;
        console.log("Promos activas cargadas:", activePromos.length);
    } catch (e) { console.error("Error loading promos:", e); }
}

// =============================================
// AUTH ENGINE
// =============================================
async function initAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) { currentUser = session.user; await onAuthSuccess(session.user, false); }

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
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

    let { data: cliente } = await supabaseClient.from('clientes').select('*').eq('user_id', user.id).maybeSingle();

    if (!cliente) {
        let { data: byEmail } = await supabaseClient.from('clientes').select('*').eq('email', user.email).maybeSingle();
        if (byEmail) {
            await supabaseClient.from('clientes').update({ user_id: user.id }).eq('id', byEmail.id);
            cliente = byEmail;
        }
    }

    if (cliente) {
        const fill = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        fill('cust-name', cliente.nombre);
        fill('cust-phone', cliente.whatsapp);
        fill('cust-email', cliente.email);
        fill('cust-address', cliente.direccion);
        fill('cust-doorbell', cliente.timbre);
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
    pendingAfterAuth = null;
};

window.switchAuthTab = (tab) => {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('auth-panel-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('auth-panel-register').style.display = tab === 'register' ? 'block' : 'none';
};

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
    btn.textContent = 'VERIFICANDO...'; btn.disabled = true;

    const { data: byPhone } = await supabaseClient.from('clientes').select('id').eq('whatsapp', whatsapp).maybeSingle();
    if (byPhone) {
        setAuthError('auth-error-register', 'Ese WhatsApp ya está registrado. Usá "Ingresar".');
        btn.textContent = 'CREAR CUENTA'; btn.disabled = false;
        return;
    }
    const { data: byEmail } = await supabaseClient.from('clientes').select('id').eq('email', email).maybeSingle();
    if (byEmail) {
        setAuthError('auth-error-register', 'Ese email ya está registrado. Usá "Ingresar".');
        btn.textContent = 'CREAR CUENTA'; btn.disabled = false;
        return;
    }

    btn.textContent = 'CREANDO CUENTA...';
    const { data, error } = await supabaseClient.auth.signUp({ email, password: pass, options: { data: { nombre } } });
    btn.textContent = 'CREAR CUENTA'; btn.disabled = false;

    if (error) { setAuthError('auth-error-register', translateAuthError(error)); return; }

    if (data.user) {
        const { data: existing } = await supabaseClient.from('clientes').select('id').eq('email', email).maybeSingle();
        if (existing) {
            await supabaseClient.from('clientes').update({ user_id: data.user.id, nombre, whatsapp }).eq('id', existing.id);
        } else {
            await supabaseClient.from('clientes').insert({ user_id: data.user.id, nombre, whatsapp, email, pedidos_count: 0, total_gastado: 0 });
        }
    }
};

window.doForgotPassword = async () => {
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('auth-error-login');
    if (!email) { setAuthError('auth-error-login', 'Ingresá tu email primero.'); return; }
    if (!validateEmail(email)) { setAuthError('auth-error-login', 'El email no es válido.'); return; }
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email);
    if (error) { setAuthError('auth-error-login', translateAuthError(error)); return; }
    setAuthError('auth-error-login', 'Te enviamos un email para restablecer tu contraseña.', true);
};

async function updateClienteStats(orderTotal, clientId) {
    let cliente = null;
    if (clientId) {
        const { data } = await supabaseClient.from('clientes').select('id, pedidos_count, total_gastado').eq('id', clientId).maybeSingle();
        cliente = data;
    } else if (currentUser) {
        const { data } = await supabaseClient.from('clientes').select('id, pedidos_count, total_gastado').eq('user_id', currentUser.id).maybeSingle();
        cliente = data;
    }
    if (cliente) {
        await supabaseClient.from('clientes').update({
            pedidos_count: (cliente.pedidos_count || 0) + 1,
            total_gastado: (cliente.total_gastado || 0) + orderTotal,
            ultima_compra: new Date().toISOString()
        }).eq('id', cliente.id);
    }
}

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
    catalog.innerHTML = categoriesWithProducts.map(({ category, products }) => {
        const sectionClass = category.tipo_venta === 'directo' ? 'extras-section' : 'menu-section';
        const usesLegacyArtworkTitle = ['burgers', 'extras'].includes(category.slug);
        const content = category.tipo_venta === 'directo'
            ? renderDirectCategory(products, status)
            : renderConfigurableCategory(products, status);
        return `
            <section id="${escapeHtml(category.slug)}" class="category-section ${sectionClass}" data-sale-type="${category.tipo_venta}">
                <div class="container">
                    ${usesLegacyArtworkTitle ? '' : `<header class="category-header ${category.tipo_venta === 'directo' ? 'category-header-light' : ''}">
                        <span class="category-kicker">RIOH. MENÚ</span>
                        <h2>${escapeHtml(category.nombre)}</h2>
                        ${category.descripcion ? `<p>${escapeHtml(category.descripcion)}</p>` : ''}
                    </header>`}
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
        <article class="menu-item ${disabled ? 'closed-item' : ''}" ${disabled ? 'aria-disabled="true"' : `onclick="openProductModal('${product.id}')"`}>
            ${product.destacado ? '<div class="badge-destacado">🔥 MÁS PEDIDO</div>' : ''}
            ${soldOut ? '<div class="badge-destacado sold-out-badge">AGOTADO</div>' : ''}
            <div class="item-img">
                <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.title)}" loading="lazy">
                <span class="item-price-tag">$${product.simple.toLocaleString('es-AR')}</span>
            </div>
            <div class="item-content">
                <h3>${escapeHtml(product.title)}</h3>
                <p class="item-desc">${escapeHtml(product.desc)}</p>
                <button type="button" class="add-btn" ${disabled ? 'disabled' : ''} ${disabledStyle}>
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
        <article class="menu-item-featured ${disabled ? 'closed-item' : ''}" ${disabled ? 'aria-disabled="true"' : `onclick="openProductModal('${product.id}')"`}>
            ${soldOut ? '<div class="badge-destacado sold-out-badge">AGOTADO</div>' : ''}
            <div class="featured-img">
                <img src="${escapeHtml(product.img)}" alt="${escapeHtml(product.title)}" loading="lazy">
            </div>
            <div class="featured-content">
                <span class="featured-label">MÁS PEDIDO</span>
                <h3>${escapeHtml(product.title)}</h3>
                <p class="featured-desc">${escapeHtml(product.desc)}</p>
                <div class="featured-pricing">
                    <span>Simple $${product.simple.toLocaleString('es-AR')}</span>
                    ${product.doble > 0 ? `<span>Doble $${product.doble.toLocaleString('es-AR')}</span>` : ''}
                </div>
                <button type="button" class="add-btn-featured" ${disabled ? 'disabled' : ''} ${disabledStyle}>
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

    if (modalImg) modalImg.src = currentProduct.img;
    if (modalTitle) modalTitle.innerText = currentProduct.title;
    if (modalDesc) modalDesc.innerText = currentProduct.desc;
    if (modalQty) modalQty.innerText = currentQty;

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
        extras.push({
            name: item.dataset.name,
            qty,
            unitPrice: Math.max(0, Number(item.dataset.price) || 0)
        });
    });
    return extras;
}

function buildConfiguredCartItem(product, type, qty, extras) {
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
            const maxQty = maxAddableQuantity(currentProduct, requestedType, getSelectedModalExtras());
            if (maxQty <= 0) {
                showAlert('SIN STOCK', `No hay stock para preparar ${currentProduct.title} ${requestedType.toLowerCase()}.`);
                return;
            }
            document.querySelectorAll('.modal-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = requestedType;
            currentQty = Math.min(currentQty, maxQty);
            updateModalAvailability();
        };
    });

    document.querySelectorAll('.extra-qty-btn').forEach(btn => {
        btn.onclick = () => {
            const item = btn.closest('.extra-item');
            if (!item || !currentProduct) return;
            const current = parseInt(item.dataset.qty) || 0;
            const delta = parseInt(btn.dataset.delta) || 0;
            const next = Math.max(0, Math.min(2, current + delta));
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
            const candidate = copyCart();
            candidate.push(buildConfiguredCartItem(currentProduct, currentType, currentQty, extras));
            const validation = validateCartAvailability(candidate);
            if (!validation.valid) {
                showAlert('STOCK INSUFICIENTE', validation.message);
                return;
            }

            cart = candidate;

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
                    <button class="upsell-add-btn" onclick="changeNuggetQty('${p.id}', 1)">+ AGREGAR</button>
                </div>
                <div id="upsell-active-${p.id}" style="display:none; align-items:center; gap:10px;">
                    <button class="upsell-qty-btn" onclick="changeNuggetQty('${p.id}', -1)">−</button>
                    <span class="upsell-qty-val" id="upsell-qty-val-${p.id}">0</span>
                    <button class="upsell-qty-btn" onclick="changeNuggetQty('${p.id}', 1)">+</button>
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
    const extras = getSelectedModalExtras();
    const maxQty = maxAddableQuantity(currentProduct, currentType, extras);
    if (maxQty > 0 && currentQty > maxQty) currentQty = maxQty;

    document.querySelectorAll('#product-modal .modal-pill').forEach(button => {
        const type = button.dataset.type;
        const hasPrice = type !== 'Doble' || currentProduct.doble > 0;
        const available = hasPrice && maxAddableQuantity(currentProduct, type, extras) > 0;
        button.style.display = hasPrice ? '' : 'none';
        button.disabled = !available;
        button.classList.toggle('unavailable', !available);
    });

    document.querySelectorAll('#product-modal .extra-item').forEach(item => {
        const qty = parseInt(item.dataset.qty) || 0;
        item.classList.toggle('active', qty > 0);
        const value = item.querySelector('.extra-qty-value');
        if (value) value.textContent = String(qty);
        item.querySelectorAll('.extra-qty-btn').forEach(control => {
            const delta = parseInt(control.dataset.delta) || 0;
            control.disabled = (delta < 0 && qty === 0) || (delta > 0 && qty >= 2);
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
                    <span>${escapeHtml(item.type)}${(item.extras || []).length ? ' + ' + escapeHtml(formatExtras(item.extras).join(', ')) : ''}</span>
                    <div class="cart-qty-controls">
                        <button onclick="updateCartQty(${idx}, -1)"><i data-lucide="minus"></i></button>
                        <span>${item.qty}</span>
                        <button onclick="updateCartQty(${idx}, 1)"><i data-lucide="plus"></i></button>
                    </div>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-item-price">$${item.total.toLocaleString()}</div>
                    <button class="remove-item-btn" onclick="removeFromCart(${idx})"><i data-lucide="trash-2"></i></button>
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
        <div class="upsell-item" onclick="toggleCartModal(); openProductModal('${p.id}')">
            <img src="${escapeHtml(p.img)}" alt="${escapeHtml(p.title)}">
            <h5>${escapeHtml(p.title)}</h5>
            <p>$${p.simple.toLocaleString()}</p>
        </div>
    `).join('');
}

window.clearCart = () => {
    if (!cart.length) return;
    if (confirm('¿Vaciar el carrito?')) { cart = []; appliedCoupon = null; renderCartItems(); updateOrderBar(); }
};

window.removeFromCart = (idx) => { cart.splice(idx, 1); renderCartItems(); updateOrderBar(); };
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
    renderCartItems(); updateOrderBar();
};

// 8. MARKETING & CHECKOUT ENGINE
window.applyCoupon = async function () {
    const code = document.getElementById('coupon-input').value.toUpperCase();
    const msg = document.getElementById('coupon-message');
    if (!code) return;

    try {
        const { data, error } = await supabaseClient.from('cupones').select('*').eq('codigo', code).eq('activo', true).single();
        if (error || !data) throw new Error("Cupón inválido");
        if (data.usos_actuales >= data.limite_usos) throw new Error("Cupón agotado");

        appliedCoupon = data;
        msg.innerText = "¡Cupón aplicado!";
        msg.className = "coupon-msg success";
        document.getElementById('apply-coupon-btn').innerText = "QUITAR";
        document.getElementById('apply-coupon-btn').onclick = removeCoupon;
        openCheckoutModal(); // Refresh prices
    } catch (e) {
        msg.innerText = e.message;
        msg.className = "coupon-msg error";
        appliedCoupon = null;
        openCheckoutModal();
    }
};

window.removeCoupon = function () {
    appliedCoupon = null;
    document.getElementById('coupon-input').value = "";
    document.getElementById('coupon-message').innerText = "";
    document.getElementById('apply-coupon-btn').innerText = "APLICAR";
    document.getElementById('apply-coupon-btn').onclick = applyCoupon;
    openCheckoutModal();
};

function calculateCartMarketing() {
    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    let discount = 0;
    let appliedPromoId = null;

    // Cupón y promos no son acumulables: si hay cupón activo, se ignoran las promos automáticas
    if (appliedCoupon) {
        let c = appliedCoupon;
        if (c.tipo === 'percent') discount = subtotal * (c.valor / 100);
        if (c.tipo === 'fixed') discount = c.valor;
        if (c.tipo === 'multi_buy') {
            cart.forEach(item => {
                if (item.qty >= c.buy_qty) {
                    let sets = Math.floor(item.qty / c.buy_qty);
                    discount += (c.buy_qty - c.get_qty) * item.pricePerUnit * sets;
                }
            });
        }
        if (c.tipo === 'second_unit') {
            cart.forEach(item => {
                if (item.qty >= 2) {
                    let pairs = Math.floor(item.qty / 2);
                    discount += (item.pricePerUnit * (c.second_unit_percent / 100)) * pairs;
                }
            });
        }
    } else {
        // Sin cupón: aplicar promos automáticas
        activePromos.forEach(p => {
            if (p.solo_registrados && !currentUser) return; // promo exclusiva para registrados
            if (p.tipo === 'percent') discount += subtotal * (p.valor / 100);
            if (p.tipo === 'fixed') discount += p.valor;
            if (p.tipo === 'multi_buy') {
                cart.forEach(item => {
                    if (item.qty >= p.buy_qty) {
                        let sets = Math.floor(item.qty / p.buy_qty);
                        discount += (p.buy_qty - p.get_qty) * item.pricePerUnit * sets;
                    }
                });
            }
            if (p.tipo === 'second_unit') {
                cart.forEach(item => {
                    if (item.qty >= 2) {
                        let pairs = Math.floor(item.qty / 2);
                        discount += (item.pricePerUnit * (p.second_unit_percent / 100)) * pairs;
                    }
                });
            }
            if (discount > 0) appliedPromoId = p.id;
        });
    }

    return { discount: Math.min(discount, subtotal), promoId: appliedPromoId };
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

function isDeliverySlotEnabled() {
    return currentDeliveryMethod === 'delivery' && DELIVERY_ZONE_KEYS.has(getSelectedZoneKey());
}

function buildDeliverySlots() {
    const now = new Date();
    const earliest = new Date(now.getTime() + DELIVERY_PREP_MINUTES * 60 * 1000);
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const slots = [];

    for (let minutes = 19 * 60 + 30; minutes <= 24 * 60; minutes += DELIVERY_SLOT_MINUTES) {
        const slot = new Date(dayStart.getTime() + minutes * 60 * 1000);
        if (slot.getTime() < earliest.getTime()) continue;
        const label = minutes === 24 * 60
            ? '00:00'
            : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        slots.push({ label, value: slot.toISOString() });
    }

    return slots;
}

function updateDeliveryTimeOptions() {
    const group = document.getElementById('delivery-time-group');
    const select = document.getElementById('delivery-time');
    const help = document.getElementById('delivery-time-help');
    if (!group || !select || !help) return;

    const previousValue = select.value;
    const enabled = isDeliverySlotEnabled();
    group.classList.toggle('is-disabled', !enabled);
    select.disabled = !enabled;
    select.required = enabled;

    if (!enabled) {
        select.innerHTML = '<option value="">HORARIO A COORDINAR</option>';
        help.textContent = currentDeliveryMethod === 'pickup'
            ? 'El horario de retiro se coordina con el local.'
            : 'Para esta zona coordinamos el horario después de recibir el pedido.';
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
    help.textContent = `Turnos cada ${DELIVERY_SLOT_MINUTES} minutos, con ${DELIVERY_PREP_MINUTES} minutos de preparación.`;
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

function restoreGuestCheckoutProfile() {
    if (currentUser) return;
    fillCheckoutProfile(readStoredJson(GUEST_PROFILE_KEY));
}

function saveGuestCheckoutProfile(profile) {
    if (!currentUser) writeStoredJson(GUEST_PROFILE_KEY, profile);
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
    return date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
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
        const extras = formatExtras(item.extras);
        const detail = [item.type, ...extras].filter(Boolean).join(' + ');
        return `<div class="confirmation-item">
            <div>
                <strong>${parseInt(item.qty) || 1}× ${escapeHtml(item.title)}</strong>
                ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
            </div>
            <b>$${Number(item.total || 0).toLocaleString('es-AR')}</b>
        </div>`;
    }).join('');

    const deliveryTitle = receipt.deliveryMethod === 'pickup'
        ? 'Retiro en local'
        : `${receipt.zone || 'Delivery'} · ${formatReceiptTime(receipt.deliveryAt)} hs`;
    const deliveryDetail = receipt.deliveryMethod === 'pickup'
        ? 'Coordiná el horario con el local.'
        : [receipt.address, receipt.doorbell ? `Timbre/Depto: ${receipt.doorbell}` : ''].filter(Boolean).join(' · ');

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
            ${receipt.discount > 0 ? `<div><span>Descuento</span><b>-$${Number(receipt.discount).toLocaleString('es-AR')}</b></div>` : ''}
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

window.sendLastOrderWhatsApp = function() {
    const receipt = getLastOrderReceipt();
    if (!receipt) return;
    const itemLines = (receipt.items || []).map(item => {
        const details = [item.type, ...formatExtras(item.extras)].filter(Boolean).join(' + ');
        return `• ${parseInt(item.qty) || 1}x ${item.title}${details ? ` (${details})` : ''} — $${Number(item.total || 0).toLocaleString('es-AR')}`;
    });
    const delivery = receipt.deliveryMethod === 'pickup'
        ? 'Retiro en local - horario a coordinar'
        : `${receipt.zone || 'Delivery'} - ${formatReceiptTime(receipt.deliveryAt)} hs\n${receipt.address || ''}${receipt.doorbell ? ` - Timbre/Depto: ${receipt.doorbell}` : ''}`;
    const message = [
        `Hola RIOH. Quiero dejar registrado mi pedido #${receipt.numeroPedido || '---'}.`,
        '',
        ...itemLines,
        '',
        `Entrega: ${delivery}`,
        receipt.notes ? `Nota: ${receipt.notes}` : '',
        `Pago: ${paymentLabel(receipt.paymentMethod)}`,
        `Total: $${Number(receipt.total || 0).toLocaleString('es-AR')}`
    ].filter(Boolean).join('\n');
    window.open(`https://wa.me/${RIOH_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
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
    restoreGuestCheckoutProfile();
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
};

window.updateCheckoutPrices = function () {
    updateDeliveryTimeOptions();
    const itemsList = document.getElementById('checkout-items-list');
    if (itemsList) {
        itemsList.innerHTML = cart.map(item => {
            const detail = [item.type, ...formatExtras(item.extras)].filter(Boolean).join(' + ');
            return `
            <div class="checkout-item-row">
                <div class="checkout-item-name">
                    <span class="checkout-item-qty">${item.qty}×</span>
                    <span>${escapeHtml(item.title)}${detail ? `<br><small>${escapeHtml(detail)}</small>` : ''}</span>
                </div>
                <span class="checkout-item-price">$${item.total.toLocaleString()}</span>
            </div>`;
        }).join('');
    }

    let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
    let { discount, promoId } = calculateCartMarketing();

    // Shipping Calculation
    let shipping = 0;
    if (currentDeliveryMethod === 'delivery') {
        const zoneSelect = document.getElementById('shipping-zone');
        shipping = zoneSelect ? parseInt(zoneSelect.value) : 0;
    }

    let total = subtotal - discount + shipping;

    document.getElementById('summary-subtotal').innerText = `$${subtotal.toLocaleString()}`;
    const discRow = document.getElementById('discount-row');
    if (discount > 0) {
        discRow.style.display = 'flex';
        document.getElementById('summary-discount').innerText = `-$${discount.toLocaleString()}`;
    } else discRow.style.display = 'none';

    const shipEl = document.getElementById('summary-shipping');
    if (shipEl) {
        shipEl.innerText = shipping === 0 ? "GRATIS" : `$${shipping.toLocaleString()}`;
        shipEl.className = shipping === 0 ? "free" : "";
    }

    document.getElementById('summary-total').innerText = `$${total.toLocaleString()}`;
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

// Auto-fill seguro para invitados: solo usa datos guardados en este dispositivo.
document.addEventListener('DOMContentLoaded', () => {
    const phoneInput = document.getElementById('cust-phone');
    if (phoneInput) {
        phoneInput.addEventListener('blur', () => {
            const storedProfile = readStoredJson(GUEST_PROFILE_KEY);
            if (!storedProfile || normalizePhone(storedProfile.whatsapp) !== normalizePhone(phoneInput.value)) return;
            fillCheckoutProfile(storedProfile);
            phoneInput.style.borderColor = "#2E7D32";
            setTimeout(() => {
                phoneInput.style.borderColor = "";
            }, 2000);
        });
    }

    const zoneSelect = document.getElementById('shipping-zone');
    if (zoneSelect) {
        zoneSelect.addEventListener('change', updateDeliveryTimeOptions);
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
        document.getElementById('address-section').style.display = (currentDeliveryMethod === 'pickup') ? 'none' : 'block';
        updateDeliveryTimeOptions();
        updateCheckoutPrices();
    };
});

// Final Checkout
window.submitOrder = async function() {
    if (!selectedPayMethod) return;
    const form = document.getElementById('checkout-form');
    if (form && !form.checkValidity()) { form.reportValidity(); return; }

    // Delivery requiere dirección
    if (currentDeliveryMethod === 'delivery') {
        const addr = document.getElementById('cust-address')?.value?.trim() || '';
        if (!addr) {
            showAlert("FALTA LA DIRECCIÓN", "Ingresá la dirección de entrega para el delivery, o elegí retiro por el local.");
            return;
        }
        if (isDeliverySlotEnabled() && !document.getElementById('delivery-time')?.value) {
            showAlert("FALTA EL HORARIO", "Elegí un horario de entrega para continuar.");
            return;
        }
    }

    const finalizarBtn = document.getElementById('finalizar-btn');
    if (finalizarBtn) { finalizarBtn.disabled = true; finalizarBtn.innerHTML = '<span class="loading-spinner"></span> PROCESANDO...'; }
    const refreshed = await loadMenu({ silent: true });
    const availability = refreshed ? validateCartAvailability(cart) : { valid: false, message: 'No pudimos verificar el stock. Revisá tu conexión.' };
    if (!availability.valid) {
        showAlert('REVISÁ TU PEDIDO', availability.message);
        if (finalizarBtn) {
            finalizarBtn.disabled = false;
            finalizarBtn.innerHTML = '<i data-lucide="check-circle"></i> FINALIZAR PEDIDO';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        return;
    }
    const serverAvailability = await validateCartAvailabilityOnServer(cart);
    if (!serverAvailability.valid) {
        showAlert('REVISÁ TU PEDIDO', serverAvailability.message);
        if (finalizarBtn) {
            finalizarBtn.disabled = false;
            finalizarBtn.innerHTML = '<i data-lucide="check-circle"></i> FINALIZAR PEDIDO';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        return;
    }
    const payMethod = selectedPayMethod;

        try {
            let subtotal = cart.reduce((acc, i) => acc + i.total, 0);
            let { discount, promoId } = calculateCartMarketing();

            let shipping = 0;
            if (currentDeliveryMethod === 'delivery') {
                const zoneSelect = document.getElementById('shipping-zone');
                shipping = zoneSelect ? parseInt(zoneSelect.value) : 0;
            }

            let total = subtotal - discount + shipping;

            // 1. Client Handling
            const phone = document.getElementById('cust-phone').value.trim();
            const custName = document.getElementById('cust-name').value.trim();
            const custEmail = document.getElementById('cust-email').value.trim() || null;
            const custAddress = document.getElementById('cust-address')?.value?.trim() || '';
            const custDoorbell = document.getElementById('cust-doorbell')?.value?.trim() || '';
            const custNotes = document.getElementById('cust-notes')?.value?.trim() || '';
            const deliveryAt = currentDeliveryMethod === 'delivery' && isDeliverySlotEnabled()
                ? document.getElementById('delivery-time')?.value || null
                : null;
            const zoneSelect = document.getElementById('shipping-zone');
            const zoneLabel = currentDeliveryMethod === 'delivery'
                ? zoneSelect?.options[zoneSelect.selectedIndex]?.text.replace(/\s*\(\$[\d.]+\)\s*$/, '') || ''
                : null;
            let clientId = null;

            // Try to find existing client: by user_id, then phone, then email
            let existingClient = null;
            if (currentUser) {
                const { data } = await supabaseClient
                    .from('clientes')
                    .select('id')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                existingClient = data;
            }
            if (!existingClient && phone) {
                const { data } = await supabaseClient
                    .from('clientes')
                    .select('id')
                    .eq('whatsapp', phone)
                    .maybeSingle();
                existingClient = data;
            }
            if (!existingClient && custEmail) {
                const { data } = await supabaseClient
                    .from('clientes')
                    .select('id')
                    .eq('email', custEmail)
                    .maybeSingle();
                existingClient = data;
            }

            if (existingClient) {
                console.log("Existing client found, using ID:", existingClient.id);
                clientId = existingClient.id;
                // Update their info
                const clientUpdate = {
                    nombre: custName,
                    whatsapp: phone,
                    user_id: currentUser ? currentUser.id : undefined
                };
                if (custEmail) clientUpdate.email = custEmail;
                if (currentDeliveryMethod === 'delivery') {
                    clientUpdate.direccion = custAddress;
                    clientUpdate.timbre = custDoorbell;
                }
                await supabaseClient.from('clientes').update(clientUpdate).eq('id', clientId);
            } else {
                console.log("New client, capturing data...");
                const { data: newClient, error: cErr } = await supabaseClient.from('clientes').insert({
                    user_id: currentUser ? currentUser.id : null,
                    nombre: custName,
                    whatsapp: phone,
                    email: custEmail,
                    direccion: custAddress,
                    timbre: custDoorbell,
                    pedidos_count: 0,
                    total_gastado: 0
                }).select();
                if (cErr) throw cErr;
                clientId = newClient[0].id;
            }

            // 2. Insert Order
            const { data: oData, error: oErr } = await supabaseClient.from('pedidos').insert({
                cliente_id: clientId,
                user_id: currentUser ? currentUser.id : null,
                items: cart,
                metodo_entrega: currentDeliveryMethod,
                direccion_entrega: currentDeliveryMethod === 'delivery' ? custAddress : 'Retiro en Local',
                zona: zoneLabel,
                timbre: currentDeliveryMethod === 'delivery' ? custDoorbell : null,
                nota: custNotes || null,
                entrega_programada: deliveryAt,
                subtotal,
                monto_descuento: discount,
                costo_envio: shipping,
                total,
                promo_id: promoId,
                cupon_id: appliedCoupon ? appliedCoupon.id : null,
                estado_pago: payMethod === 'efectivo' ? 'pendiente_efectivo' : 'pendiente_transferencia'
            }).select();
            if (oErr) throw oErr;

            // 3. Discount stock & usage
            if (appliedCoupon) {
                await supabaseClient.from('cupones').update({ usos_actuales: appliedCoupon.usos_actuales + 1 }).eq('id', appliedCoupon.id);
            }
            // Stock se descuenta en el admin al confirmar pago (kanban: pendiente → aprobado)

            await updateClienteStats(total, clientId);
            const orderRecord = oData[0];
            const receipt = {
                id: orderRecord.id,
                numeroPedido: orderRecord.numero_pedido,
                createdAt: orderRecord.created_at || new Date().toISOString(),
                items: cart,
                deliveryMethod: currentDeliveryMethod,
                address: currentDeliveryMethod === 'delivery' ? custAddress : '',
                doorbell: currentDeliveryMethod === 'delivery' ? custDoorbell : '',
                zone: zoneLabel,
                deliveryAt,
                notes: custNotes,
                subtotal,
                discount,
                shipping,
                total,
                paymentMethod: payMethod
            };

            const previousGuestProfile = readStoredJson(GUEST_PROFILE_KEY) || {};
            saveGuestCheckoutProfile({
                nombre: custName,
                whatsapp: phone,
                email: custEmail || '',
                direccion: currentDeliveryMethod === 'delivery' ? custAddress : previousGuestProfile.direccion || '',
                timbre: currentDeliveryMethod === 'delivery' ? custDoorbell : previousGuestProfile.timbre || ''
            });
            writeStoredJson(LAST_ORDER_KEY, receipt);
            initializeLastOrderReceipt();

            // Vaciar carrito y resetear el flujo después de conservar el comprobante.
            cart = []; appliedCoupon = null;
            resetOrderFlowUI();
            renderOrderConfirmation(receipt);
        } catch (err) {
            console.error(err);
            showAlert("ERROR", "Hubo un problema al procesar tu pedido. Por favor, revisá los datos e intentá de nuevo.");
        } finally {
            if (finalizarBtn) { finalizarBtn.disabled = false; finalizarBtn.innerHTML = '<i data-lucide="check-circle"></i> FINALIZAR PEDIDO'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
        }
};
