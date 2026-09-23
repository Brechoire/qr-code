// Variables globales
let currentQRCode = null;
let currentURL = '';
let logoImage = null;
let contentType = 'url';
let dotStyle = 'square';
let cornersSquareStyle = 'square';
let cornersDotStyle = 'square';
let logoSizeRatio = 0.2;

// Perf URL longues : seuils et anti-chevauchement (plan bug_fluidifier-saisie-url-longue).
// Au-delà de LONG_CONTENT_THRESHOLD, l'aperçu auto est différé (bouton Générer garde le QR complet).
const LONG_CONTENT_THRESHOLD = 500;
const DEBOUNCE_SHORT_MS = 500;
const DEBOUNCE_LONG_MS = 900;
const ECC_HEAVY_THRESHOLD = 800;
let generationId = 0;

// Raccourcisseur intégré : dernier lien court connu pour l'URL saisie.
let currentShort = null; // { target, short_id, short_url }

// Configuration des dégradés
const gradientConfig = {
    dot: { type: 'solid', start: '#000000', end: '#2c5f8d', gradientType: 'linear', rotation: 0 },
    cornersSquare: { type: 'solid', start: '#000000', end: '#2c5f8d', gradientType: 'linear', rotation: 0 },
    cornersDot: { type: 'solid', start: '#000000', end: '#2c5f8d', gradientType: 'linear', rotation: 0 }
};

// Éléments DOM - Formulaires
const contentTypeBtns = document.querySelectorAll('.content-type-btn');
const contentForms = document.querySelectorAll('.content-form');

// URL Form
const urlInput = document.getElementById('urlInput');
const urlValidationIcon = document.getElementById('urlValidationIcon');
const urlValidationMessage = document.getElementById('urlValidationMessage');
const qrTitleInput = document.getElementById('qrTitle');
const qrCategoryInput = document.getElementById('qrCategory');

// Text Form
const textInput = document.getElementById('textInput');
const textValidationMessage = document.getElementById('textValidationMessage');

// WiFi Form
const wifiSsid = document.getElementById('wifiSsid');
const wifiPassword = document.getElementById('wifiPassword');
const wifiSecurity = document.getElementById('wifiSecurity');
const wifiHidden = document.getElementById('wifiHidden');
const wifiSsidValidation = document.getElementById('wifiSsidValidation');

// Email Form
const emailTo = document.getElementById('emailTo');
const emailSubject = document.getElementById('emailSubject');
const emailBody = document.getElementById('emailBody');
const emailValidationIcon = document.getElementById('emailValidationIcon');
const emailToValidation = document.getElementById('emailToValidation');

// Phone Form
const phoneNumber = document.getElementById('phoneNumber');
const phoneValidationIcon = document.getElementById('phoneValidationIcon');
const phoneValidationMessage = document.getElementById('phoneValidationMessage');

// vCard Form
const vcardName = document.getElementById('vcardName');
const vcardPhone = document.getElementById('vcardPhone');
const vcardEmail = document.getElementById('vcardEmail');
const vcardNameValidation = document.getElementById('vcardNameValidation');

// Éléments communs
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const foregroundColor = document.getElementById('foregroundColor');
const cornersSquareColor = document.getElementById('cornersSquareColor');
const cornersDotColor = document.getElementById('cornersDotColor');
const backgroundColor = document.getElementById('backgroundColor');
const logoUpload = document.getElementById('logoUpload');
const logoSizeContainer = document.getElementById('logoSizeContainer');
const logoSizeSlider = document.getElementById('logoSizeSlider');
const logoSizeValue = document.getElementById('logoSizeValue');
const logoWarning = document.getElementById('logoWarning');
const removeLogoBtn = document.getElementById('removeLogo');
const generateBtn = document.getElementById('generateBtn');
const previewContainer = document.getElementById('previewContainer');
const actionButtons = document.getElementById('actionButtons');
const expandBtn = document.getElementById('expandBtn');
const fullscreenModal = document.getElementById('fullscreenModal');
const fullscreenClose = document.getElementById('fullscreenClose');
const fullscreenQR = document.getElementById('fullscreenQR');
const downloadPNG = document.getElementById('downloadPNG');
const downloadJPEG = document.getElementById('downloadJPEG');
const downloadWebP = document.getElementById('downloadWebP');
const downloadSVG = document.getElementById('downloadSVG');
const qualityContainer = document.getElementById('qualityContainer');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const copyContent = document.getElementById('copyContent');
const copyContentLabel = document.getElementById('copyContentLabel');

// Fonctions de validation
// Longueur max soumise à la regex (au-delà : validation par URL() uniquement, jamais de regex).
const URL_REGEX_MAX_LENGTH = 500;

// Regex volontairement linéaire (aucun quantificateur imbriqué) pour domaines nus.
const BARE_DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;

function validateURL(url) {
    if (!url) {
        urlInput.classList.remove('input-valid', 'input-invalid');
        urlValidationIcon.textContent = '';
        urlValidationMessage.classList.add('hidden');
        urlInput.setAttribute('aria-invalid', 'false');
        return false;
    }

    const trimmed = url.trim();
    // Court-circuit : URL bien formée acceptée sans regex (new URL() natif =
    // linéaire, gère %, ports, unicode, chemins longs). Un schéma explicite
    // http(s) suffit ; sans schéma, on exige un point (ou localhost) pour
    // rejeter les simples mots comme avant.
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed.slice(0, 32));
    let isValid = false;
    try {
        const parsed = new URL(hasScheme ? trimmed : 'https://' + trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            isValid = hasScheme || parsed.hostname.includes('.') || parsed.hostname === 'localhost';
        }
    } catch (e) {
        isValid = false;
    }
    if (!isValid && trimmed.length <= URL_REGEX_MAX_LENGTH) {
        // Dernier recours : domaine nu simple, regex linéaire plafonnée.
        isValid = BARE_DOMAIN_PATTERN.test(trimmed.split('/')[0]);
    }

    if (isValid) {
        urlInput.classList.remove('input-invalid');
        urlInput.classList.add('input-valid');
        urlValidationIcon.textContent = '✓';
        urlValidationIcon.style.color = '#22c55e';
        urlValidationMessage.classList.add('hidden');
        urlInput.setAttribute('aria-invalid', 'false');
    } else {
        urlInput.classList.remove('input-valid');
        urlInput.classList.add('input-invalid');
        urlValidationIcon.textContent = '✗';
        urlValidationIcon.style.color = '#ef4444';
        urlValidationMessage.textContent = 'URL invalide. Veuillez entrer une URL valide.';
        urlValidationMessage.classList.remove('hidden');
        urlInput.setAttribute('aria-invalid', 'true');
    }

    return isValid;
}

function validateEmail(email) {
    if (!email) {
        emailTo.classList.remove('input-valid', 'input-invalid');
        if (emailValidationIcon) emailValidationIcon.textContent = '';
        emailToValidation.classList.add('hidden');
        emailTo.setAttribute('aria-invalid', 'false');
        return false;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailPattern.test(email);

    if (isValid) {
        emailTo.classList.remove('input-invalid');
        emailTo.classList.add('input-valid');
        if (emailValidationIcon) {
            emailValidationIcon.textContent = '✓';
            emailValidationIcon.style.color = '#22c55e';
        }
        emailToValidation.classList.add('hidden');
        emailTo.setAttribute('aria-invalid', 'false');
    } else {
        emailTo.classList.remove('input-valid');
        emailTo.classList.add('input-invalid');
        if (emailValidationIcon) {
            emailValidationIcon.textContent = '✗';
            emailValidationIcon.style.color = '#ef4444';
        }
        emailToValidation.textContent = 'Email invalide. Format attendu : nom@exemple.com';
        emailToValidation.classList.remove('hidden');
        emailTo.setAttribute('aria-invalid', 'true');
    }

    return isValid;
}

function validatePhone(phone) {
    if (!phone) {
        phoneNumber.classList.remove('input-valid', 'input-invalid');
        if (phoneValidationIcon) phoneValidationIcon.textContent = '';
        phoneValidationMessage.classList.add('hidden');
        phoneNumber.setAttribute('aria-invalid', 'false');
        return false;
    }

    // Accepte les formats : +33612345678, 0612345678, 01 23 45 67 89, etc.
    const phonePattern = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;
    const digitsOnly = phone.replace(/\D/g, '');
    const isValid = phonePattern.test(phone) && digitsOnly.length >= 8;

    if (isValid) {
        phoneNumber.classList.remove('input-invalid');
        phoneNumber.classList.add('input-valid');
        if (phoneValidationIcon) {
            phoneValidationIcon.textContent = '✓';
            phoneValidationIcon.style.color = '#22c55e';
        }
        phoneValidationMessage.classList.add('hidden');
        phoneNumber.setAttribute('aria-invalid', 'false');
    } else {
        phoneNumber.classList.remove('input-valid');
        phoneNumber.classList.add('input-invalid');
        if (phoneValidationIcon) {
            phoneValidationIcon.textContent = '✗';
            phoneValidationIcon.style.color = '#ef4444';
        }
        phoneValidationMessage.textContent = 'Numéro invalide. Minimum 8 chiffres requis.';
        phoneValidationMessage.classList.remove('hidden');
        phoneNumber.setAttribute('aria-invalid', 'true');
    }

    return isValid;
}

function validateWiFi() {
    const ssid = wifiSsid.value.trim();
    
    if (!ssid) {
        wifiSsid.classList.add('border-red-500');
        wifiSsidValidation.textContent = 'Le nom du réseau est requis';
        wifiSsidValidation.classList.remove('hidden');
        wifiSsid.setAttribute('aria-invalid', 'true');
        return false;
    }

    wifiSsid.classList.remove('border-red-500');
    wifiSsidValidation.classList.add('hidden');
    wifiSsid.setAttribute('aria-invalid', 'false');
    return true;
}

function validateVCard() {
    const name = vcardName.value.trim();
    
    if (!name) {
        vcardName.classList.add('border-red-500');
        vcardNameValidation.textContent = 'Le nom est requis';
        vcardNameValidation.classList.remove('hidden');
        vcardName.setAttribute('aria-invalid', 'true');
        return false;
    }

    vcardName.classList.remove('border-red-500');
    vcardNameValidation.classList.add('hidden');
    vcardName.setAttribute('aria-invalid', 'false');
    return true;
}

// Génération du contenu selon le type
function generateContent() {
    switch (contentType) {
        case 'url':
            return normalizeURL(urlInput.value);
        case 'text':
            return textInput.value.trim();
        case 'wifi':
            return generateWiFiString();
        case 'email':
            return generateEmailString();
        case 'phone':
            return generatePhoneString();
        case 'vcard':
            return generateVCardString();
        default:
            return '';
    }
}

function normalizeURL(url) {
    url = url.trim();
    if (!url) return '';
    if (!url.match(/^https?:\/\//i)) {
        url = 'https://' + url;
    }
    return url;
}

function generateWiFiString() {
    const ssid = wifiSsid.value.trim();
    const password = wifiPassword.value;
    const security = wifiSecurity.value;
    const hidden = wifiHidden.checked;

    if (!ssid) return '';

    // Format WiFi QR : WIFI:S:ssid;T:security;P:password;H:hidden;;
    let wifiString = 'WIFI:';
    wifiString += `S:${escapeQRString(ssid)};`;
    wifiString += `T:${security};`;
    if (password && security !== 'nopass') {
        wifiString += `P:${escapeQRString(password)};`;
    }
    if (hidden) {
        wifiString += 'H:true;';
    }
    wifiString += ';';

    return wifiString;
}

function generateEmailString() {
    const to = emailTo.value.trim();
    const subject = emailSubject.value.trim();
    const body = emailBody.value.trim();

    if (!to) return '';

    let emailString = `mailto:${to}`;
    const params = [];
    
    if (subject) {
        params.push(`subject=${encodeURIComponent(subject)}`);
    }
    if (body) {
        params.push(`body=${encodeURIComponent(body)}`);
    }
    
    if (params.length > 0) {
        emailString += '?' + params.join('&');
    }

    return emailString;
}

function generatePhoneString() {
    const phone = phoneNumber.value.trim();
    if (!phone) return '';
    
    // Nettoyer le numéro pour le format tel:
    const cleanPhone = phone.replace(/[\s\-\.\(\)]/g, '');
    return `tel:${cleanPhone}`;
}

function generateVCardString() {
    const name = vcardName.value.trim();
    const phone = vcardPhone.value.trim();
    const email = vcardEmail.value.trim();

    if (!name) return '';

    let vcard = 'BEGIN:VCARD\n';
    vcard += 'VERSION:3.0\n';
    vcard += `FN:${escapeQRString(name)}\n`;
    
    if (phone) {
        vcard += `TEL:${escapeQRString(phone)}\n`;
    }
    if (email) {
        vcard += `EMAIL:${escapeQRString(email)}\n`;
    }
    
    vcard += 'END:VCARD';

    return vcard;
}

// Échapper les caractères spéciaux pour les QR codes
function escapeQRString(str) {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/:/g, '\\:')
        .replace(/\n/g, '\\n');
}

// Gestion du changement de type de contenu
contentTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const newType = btn.dataset.type;
        
        // Mettre à jour l'état visuel des boutons
        contentTypeBtns.forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        
        // Mettre à jour le type de contenu
        contentType = newType;
        
        // Afficher le formulaire correspondant
        contentForms.forEach(form => {
            form.classList.add('hidden');
        });
        document.getElementById(`${newType}Form`).classList.remove('hidden');
        
        // Mettre à jour le label du bouton copier
        updateCopyLabel();
        
        // Générer le QR code si des données sont présentes (avec seuil différé)
        updateUrlCounter();
        if (hasValidContent()) {
            requestAutoGenerate();
        } else {
            showDeferredMessage(false);
            previewContainer.innerHTML = '<p class="text-gray-400 text-center">Le QR code apparaîtra ici</p>';
            actionButtons.classList.add('hidden');
            expandBtn.classList.add('hidden');
            hideTrackBlocks();
        }
    });
});

function updateCopyLabel() {
    const labels = {
        url: 'Copier le lien',
        text: 'Copier le texte',
        wifi: 'Copier les paramètres WiFi',
        email: "Copier l'email",
        phone: 'Copier le numéro',
        vcard: 'Copier le contact'
    };
    copyContentLabel.textContent = labels[contentType] || 'Copier';
}

function hasValidContent() {
    switch (contentType) {
        case 'url':
            return urlInput.value.trim() !== '';
        case 'text':
            return textInput.value.trim() !== '';
        case 'wifi':
            return wifiSsid.value.trim() !== '';
        case 'email':
            return emailTo.value.trim() !== '';
        case 'phone':
            return phoneNumber.value.trim() !== '';
        case 'vcard':
            return vcardName.value.trim() !== '';
        default:
            return false;
    }
}

// --- Perf URL longues : déclenchement différé + debounce adaptatif ---

function adaptiveWait() {
    try {
        const data = generateContent();
        return data.length > LONG_CONTENT_THRESHOLD ? DEBOUNCE_LONG_MS : DEBOUNCE_SHORT_MS;
    } catch (e) {
        return DEBOUNCE_SHORT_MS;
    }
}

function debounceAdaptive(func) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), adaptiveWait());
    };
}

function updateUrlCounter() {
    const counter = document.getElementById('urlCharCount');
    if (!counter || !urlInput) return;
    const len = urlInput.value.length;
    counter.textContent = `${len} / ${LONG_CONTENT_THRESHOLD} caractères (aperçu auto)`;
}

function suggestTitle() {
    // Pré-remplit le titre (modifiable) : domaine — date, seulement si vide.
    if (!qrTitleInput || qrTitleInput.value.trim() || !urlInput) return;
    try {
        const target = normalizeURL(urlInput.value);
        if (!target) return;
        const host = new URL(target).hostname;
        const date = new Date().toLocaleDateString('fr-FR');
        qrTitleInput.value = `${host} — ${date}`.slice(0, 120);
    } catch (e) { /* URL incomplète : on ne propose rien */ }
}

function showDeferredMessage(show, customText) {
    const el = document.getElementById('urlDeferredMessage');
    if (!el) return;
    if (show) {
        el.textContent = customText || 'URL longue — aperçu différé : 1) cliquez sur « Raccourcir + QR court suivi », 2) puis sur « Générer le QR Code ».';
        el.classList.remove('hidden');
    } else {
        el.textContent = '';
        el.classList.add('hidden');
    }
}

function updateEccInfo(ecc, dataLength) {
    const el = document.getElementById('eccInfo');
    if (!el) return;
    if (ecc === 'M' && dataLength > ECC_HEAVY_THRESHOLD) {
        el.textContent = `Contenu long (${dataLength} car.) : correction d'erreur M pour garder un aperçu fluide. Le bouton Générer garde le même contenu.`;
    } else {
        el.textContent = '';
    }
}

function resolveECC(dataLength) {
    // H par défaut ; M si payload lourde et pas de logo (logo exige H pour rester lisible).
    if (dataLength > ECC_HEAVY_THRESHOLD && !logoImage) return 'M';
    return 'H';
}

function isValidForAuto() {
    switch (contentType) {
        case 'url':
            return validateURL(urlInput.value);
        case 'text':
            return textInput.value.trim() !== '';
        case 'wifi':
            return validateWiFi();
        case 'email':
            return validateEmail(emailTo.value);
        case 'phone':
            return validatePhone(phoneNumber.value);
        case 'vcard':
            return validateVCard();
        default:
            return false;
    }
}

function resetPreviewToPlaceholder() {
    previewContainer.innerHTML = '<p class="text-gray-400 text-center">Le QR code apparaîtra ici</p>';
    actionButtons.classList.add('hidden');
    expandBtn.classList.add('hidden');
    currentQRCode = null;
    hideTrackBlocks();
}

// Point d'entrée unique de l'aperçu auto : applique le seuil + la validité, sans jamais bloquer Générer.
function requestAutoGenerate() {
    const data = generateContent();
    if (!data) {
        showDeferredMessage(false);
        updateEccInfo('H', 0);
        resetPreviewToPlaceholder();
        return;
    }
    if (data.length > LONG_CONTENT_THRESHOLD) {
        showDeferredMessage(true);
        return;
    }
    showDeferredMessage(false);
    if (!isValidForAuto()) return;
    generateQRCode();
}

const debouncedAutoGenerate = debounceAdaptive(requestAutoGenerate);
const debouncedControlGenerate = debounceAdaptive(() => {
    if (hasValidContent()) requestAutoGenerate();
});

// --- Raccourcisseur intégré (même origine, /api/links/) ---

function setShortStatus(text, isError = false) {
    const el = document.getElementById('shortStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('text-red-500', isError);
    el.classList.toggle('text-gray-500', !isError);
}

function renderShortZone() {
    const zone = document.getElementById('shortZone');
    const link = document.getElementById('shortUrlValue');
    const stats = document.getElementById('shortStatsLink');
    if (!zone || !link) return;
    if (currentShort) {
        link.textContent = currentShort.short_url;
        link.href = currentShort.short_url;
        if (stats) stats.href = `/api/links/${currentShort.short_id}/stats/`;
        zone.classList.remove('hidden');
    } else {
        zone.classList.add('hidden');
    }
}

function invalidateShortIfStale() {
    if (!currentShort || contentType !== 'url') return;
    if (normalizeURL(urlInput.value) !== currentShort.target) {
        currentShort = null;
        renderShortZone();
    }
}

// --- Catégories (tous types) ---

function currentCategoryInput() {
    return (qrCategoryInput?.value || '').trim().slice(0, 60);
}

function setCategoryStatus(text, isError = false) {
    const el = document.getElementById('qrCategoryStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('text-red-500', isError);
}

// --- Combobox catégories maison (liste toujours visible au clic) ---

let categoryCache = [];
let catPopupOpen = false;
let catActiveIndex = -1;
let catRows = []; // { kind: 'opt' | 'create' | 'info', name: string, count: number }

function normStr(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function catPopupEls() {
    return {
        input: document.getElementById('qrCategory'),
        toggle: document.getElementById('qrCatToggle'),
        popup: document.getElementById('qrCatPopup'),
    };
}

function setCatExpanded(open) {
    const { input, toggle } = catPopupEls();
    input?.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openCatPopup() {
    const { popup } = catPopupEls();
    if (!popup) return;
    renderCatPopup();
    popup.classList.remove('hidden');
    catPopupOpen = true;
    setCatExpanded(true);
}

function closeCatPopup() {
    const { popup } = catPopupEls();
    popup?.classList.add('hidden');
    catPopupOpen = false;
    catActiveIndex = -1;
    setCatExpanded(false);
}

function renderCatPopup() {
    const { input, popup } = catPopupEls();
    if (!popup) return;
    const typed = (input?.value || '').trim();
    const f = normStr(typed);
    const matches = categoryCache.filter(c => !f || normStr(c.name).includes(f));
    const exact = matches.some(c => normStr(c.name) === f && f !== '');
    catRows = matches.map(c => ({ kind: 'opt', name: c.name, count: c.links_count }));
    popup.innerHTML = '';
    if (!categoryCache.length) {
        catRows = [{ kind: 'info', name: 'Aucune catégorie (hors ligne ?) — saisie libre.', count: 0 }];
    } else if (typed !== '' && !exact) {
        catRows.push({ kind: 'create', name: typed, count: 0 });
    }
    catActiveIndex = -1;
    const status = document.getElementById('qrCategoryStatus');
    catRows.forEach((row, idx) => {
        const li = document.createElement('li');
        li.id = `qrCatOpt${idx}`;
        li.setAttribute('role', 'option');
        if (row.kind === 'opt') {
            li.setAttribute('aria-selected', 'false');
            const label = document.createElement('span');
            label.textContent = row.name;
            const count = document.createElement('span');
            count.className = 'count';
            count.textContent = `${row.count} QR`;
            li.appendChild(label);
            li.appendChild(count);
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                chooseCategory(row.name, false);
            });
        } else if (row.kind === 'create') {
            li.classList.add('create');
            li.setAttribute('aria-selected', 'false');
            li.textContent = `+ Créer « ${row.name} »`;
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                chooseCategory(row.name, true);
            });
        } else {
            li.classList.add('disabled');
            li.textContent = row.name;
        }
        li.addEventListener('mouseenter', () => highlightCatRow(idx));
        popup.appendChild(li);
    });
    if (status && categoryCache.length) {
        status.textContent = `${matches.length} catégorie(s).`;
    }
}

function highlightCatRow(idx) {
    const { input, popup } = catPopupEls();
    if (!popup) return;
    catActiveIndex = idx;
    [...popup.children].forEach((li, i) => {
        li.classList.toggle('active', i === idx);
        li.setAttribute('aria-selected', i === idx ? 'true' : 'false');
    });
    const row = catRows[idx];
    if (row && row.kind !== 'info') input?.setAttribute('aria-activedescendant', `qrCatOpt${idx}`);
    else input?.removeAttribute('aria-activedescendant');
}

function chooseCategory(name, isNew) {
    const { input } = catPopupEls();
    if (input) input.value = name;
    closeCatPopup();
    setCategoryStatus(isNew ? `« ${name} » sera créée à l'enregistrement.` : `« ${name} » existe déjà.`);
    input?.focus();
}

async function loadCategories() {
    try {
        const resp = await fetch('/api/categories/');
        if (!resp.ok) throw new Error(`http ${resp.status}`);
        categoryCache = await resp.json();
        setCategoryStatus('');
    } catch (e) {
        categoryCache = [];
        setCategoryStatus('Catégories hors ligne : saisie libre.');
    }
}

function setupCategoryCombo() {
    const { input, toggle, popup } = catPopupEls();
    if (!input || !popup) return;
    input.addEventListener('focus', () => openCatPopup());
    input.addEventListener('input', () => {
        if (!catPopupOpen) openCatPopup();
        else renderCatPopup();
    });
    toggle?.addEventListener('click', () => {
        if (catPopupOpen) { closeCatPopup(); input.focus(); }
        else { input.focus(); openCatPopup(); }
    });
    input.addEventListener('keydown', (e) => {
        const selectable = catRows
            .map((r, i) => ({ r, i }))
            .filter(({ r }) => r.kind !== 'info');
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!catPopupOpen) { openCatPopup(); return; }
            if (!selectable.length) return;
            let pos = selectable.findIndex(({ i }) => i === catActiveIndex);
            pos = e.key === 'ArrowDown'
                ? (pos + 1) % selectable.length
                : (pos - 1 + selectable.length) % selectable.length;
            highlightCatRow(selectable[pos].i);
        } else if (e.key === 'Enter') {
            if (catPopupOpen && catActiveIndex >= 0 && catRows[catActiveIndex]?.kind !== 'info') {
                e.preventDefault();
                const row = catRows[catActiveIndex];
                chooseCategory(row.name, row.kind === 'create');
            }
        } else if (e.key === 'Escape') {
            if (catPopupOpen) { e.preventDefault(); closeCatPopup(); }
        }
    });
    document.addEventListener('click', (e) => {
        if (catPopupOpen && !e.target.closest('.combo-wrap')) closeCatPopup();
    });
    document.getElementById('qrCatRefresh')?.addEventListener('click', async () => {
        setCategoryStatus('Actualisation…');
        await loadCategories();
        if (categoryCache.length) {
            setCategoryStatus(`${categoryCache.length} catégorie(s).`);
            openCatPopup();
        }
    });
}

async function shortenCurrentUrl() {
    const btn = document.getElementById('shortenBtn');
    if (contentType !== 'url') return;
    if (!validateURL(urlInput.value)) {
        setShortStatus('URL invalide : corrigez-la avant de raccourcir.', true);
        urlInput?.focus();
        return;
    }
    const target = normalizeURL(urlInput.value);
    const title = (qrTitleInput?.value || '').trim().slice(0, 120);
    const category = currentCategoryInput();
    const existing = currentShort;
    if (existing && existing.target === target) {
        if (title) existing.title = title;
        renderShortZone();
        setShortStatus('Lien court déjà prêt : cliquez sur « Générer le QR Code » pour créer le QR.');
        generateBtn?.focus();
        return;
    }
    setShortStatus('Création du lien court…');
    btn.disabled = true;
    try {
        const resp = await fetch('/api/links/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'url', target_url: target, title, category })
        });
        const body = await resp.json().catch(() => ({}));
        if (resp.status === 429) {
            setShortStatus('Trop de créations : réessayez dans une heure, ou utilisez « Générer » (QR long).', true);
            return;
        }
        if (!resp.ok) {
            setShortStatus(body.error || 'Lien court impossible. Utilisez « Générer » (QR long).', true);
            return;
        }
        currentShort = { target, short_id: body.short_id, short_url: body.short_url, title: body.title || title, category: body.category || null };
        document.getElementById('useShortUrl').checked = true;
        renderShortZone();
        addToHistory(currentShort);
        setShortStatus(
            (body.reused ? 'Lien court réutilisé (déjà créé pour cette URL). ' : 'Lien court créé. ') +
            'Cliquez sur « Générer le QR Code » pour créer le QR avec la version courte.'
        );
        generateBtn?.focus();
    } catch (e) {
        console.error('Raccourcisseur injoignable:', e);
        setShortStatus('Serveur injoignable (hors ligne ?) : utilisez « Générer » pour un QR avec l’URL longue.', true);
    } finally {
        btn.disabled = false;
    }
}

// Validations en temps réel
urlInput?.addEventListener('input', () => {
    updateUrlCounter();
    validateURL(urlInput.value);
    suggestTitle();
    invalidateShortIfStale();
    debouncedAutoGenerate();
});

textInput?.addEventListener('input', debouncedAutoGenerate);

wifiSsid?.addEventListener('input', () => {
    validateWiFi();
    debouncedAutoGenerate();
});

wifiPassword?.addEventListener('input', debouncedAutoGenerate);

wifiSecurity?.addEventListener('change', () => {
    if (hasValidContent()) requestAutoGenerate();
});

wifiHidden?.addEventListener('change', () => {
    if (hasValidContent()) requestAutoGenerate();
});

emailTo?.addEventListener('input', () => {
    validateEmail(emailTo.value);
    debouncedAutoGenerate();
});

emailSubject?.addEventListener('input', debouncedAutoGenerate);

emailBody?.addEventListener('input', debouncedAutoGenerate);

phoneNumber?.addEventListener('input', () => {
    validatePhone(phoneNumber.value);
    debouncedAutoGenerate();
});

vcardName?.addEventListener('input', () => {
    validateVCard();
    debouncedAutoGenerate();
});

vcardPhone?.addEventListener('input', debouncedAutoGenerate);

vcardEmail?.addEventListener('input', debouncedAutoGenerate);

// Gestion des dégradés
function setupGradientControls(prefix, configKey) {
    const solidRadio = document.getElementById(`${prefix}ColorSolid`);
    const gradientRadio = document.getElementById(`${prefix}ColorGradient`);
    const solidContainer = document.getElementById(`${prefix}SolidContainer`);
    const gradientContainer = document.getElementById(`${prefix}GradientContainer`);
    const startInput = document.getElementById(`${prefix}GradientStart`);
    const endInput = document.getElementById(`${prefix}GradientEnd`);
    const typeSelect = document.getElementById(`${prefix}GradientType`);
    const rotationInput = document.getElementById(`${prefix}GradientRotation`);
    const rotationValue = document.getElementById(`${prefix}GradientRotationValue`);
    const rotationContainer = document.getElementById(`${prefix}GradientRotationContainer`);
    const preview = document.getElementById(`${prefix}GradientPreview`);

    if (!solidRadio || !gradientRadio) return;

    function updatePreview() {
        const start = startInput.value;
        const end = endInput.value;
        const type = typeSelect.value;
        const rotation = rotationInput.value;

        gradientConfig[configKey] = {
            type: gradientRadio.checked ? 'gradient' : 'solid',
            start: start,
            end: end,
            gradientType: type,
            rotation: parseInt(rotation)
        };

        if (type === 'linear') {
            preview.style.background = `linear-gradient(${rotation}deg, ${start}, ${end})`;
            rotationContainer.style.display = 'block';
        } else {
            preview.style.background = `radial-gradient(circle, ${start}, ${end})`;
            rotationContainer.style.display = 'none';
        }

        if (currentQRCode && hasValidContent()) {
            debouncedControlGenerate();
        }
    }

    solidRadio.addEventListener('change', () => {
        solidContainer.style.display = 'block';
        gradientContainer.classList.remove('active');
        const solidColorPicker = document.getElementById(`${prefix}Color`);
        if (solidColorPicker) {
            gradientConfig[configKey].start = solidColorPicker.value;
        }
        gradientConfig[configKey].type = 'solid';
        if (currentQRCode && hasValidContent()) {
            debouncedControlGenerate();
        }
    });

    gradientRadio.addEventListener('change', () => {
        solidContainer.style.display = 'none';
        gradientContainer.classList.add('active');
        gradientConfig[configKey].type = 'gradient';
        updatePreview();
    });

    startInput?.addEventListener('input', updatePreview);
    endInput?.addEventListener('input', updatePreview);
    typeSelect?.addEventListener('change', updatePreview);
    rotationInput?.addEventListener('input', () => {
        rotationValue.textContent = rotationInput.value;
        updatePreview();
    });
}

// Mise à jour de la valeur de la taille
sizeSlider?.addEventListener('input', (e) => {
    sizeValue.textContent = e.target.value;
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

// Gestion du changement de couleur
foregroundColor?.addEventListener('input', () => {
    gradientConfig.dot.start = foregroundColor.value;
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

cornersSquareColor?.addEventListener('input', () => {
    gradientConfig.cornersSquare.start = cornersSquareColor.value;
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

cornersDotColor?.addEventListener('input', () => {
    gradientConfig.cornersDot.start = cornersDotColor.value;
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

backgroundColor?.addEventListener('input', () => {
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

// Gestion de l'upload de logo
logoUpload?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            logoImage = new Image();
            logoImage.onload = () => {
                removeLogoBtn.classList.remove('hidden');
                logoSizeContainer.classList.remove('hidden');
                checkLogoSize();
                if (currentQRCode) {
                    debouncedControlGenerate();
                }
            };
            logoImage.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

// Gestion du slider de taille du logo
logoSizeSlider?.addEventListener('input', (e) => {
    logoSizeRatio = parseInt(e.target.value) / 100;
    logoSizeValue.textContent = e.target.value;
    checkLogoSize();
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

// Vérification de la taille du logo
function checkLogoSize() {
    const size = parseInt(logoSizeSlider.value);
    if (size > 25) {
        logoWarning.classList.add('active');
    } else {
        logoWarning.classList.remove('active');
    }
}

// Suppression du logo
removeLogoBtn?.addEventListener('click', () => {
    logoImage = null;
    logoUpload.value = '';
    removeLogoBtn.classList.add('hidden');
    logoSizeContainer.classList.add('hidden');
    logoWarning.classList.remove('active');
    if (currentQRCode) {
        debouncedControlGenerate();
    }
});

// Fonction pour créer les options de couleur
function createColorOptions(config) {
    if (config.type === 'gradient') {
        return {
            gradient: {
                type: config.gradientType,
                rotation: config.rotation * (Math.PI / 180),
                colorStops: [
                    { offset: 0, color: config.start },
                    { offset: 1, color: config.end }
                ]
            }
        };
    }
    return { color: config.start };
}

// Fonction de génération du QR Code
// dataOverride : permet d'encoder une short_url (raccourcisseur) au lieu du contenu du formulaire.
async function generateQRCode(dataOverride = null, recordStatic = false) {
    const data = dataOverride || generateContent();
    if (!data) {
        return;
    }

    const myId = ++generationId;
    currentURL = data;
    const size = parseInt(sizeSlider.value);
    const bgColor = backgroundColor.value;
    const ecc = resolveECC(data.length);
    updateEccInfo(ecc, data.length);

    try {
        let svgElement;

        const QRCodeStylingLib = typeof QRCodeStyling !== 'undefined' ? QRCodeStyling : 
                                (typeof window.QRCodeStyling !== 'undefined' ? window.QRCodeStyling : null);
        
        if (QRCodeStylingLib) {
            const qrCode = new QRCodeStylingLib({
                width: size,
                height: size,
                type: 'svg',
                data: data,
                margin: 2,
                qrOptions: {
                    errorCorrectionLevel: ecc
                },
                dotsOptions: {
                    ...createColorOptions(gradientConfig.dot),
                    type: dotStyle
                },
                backgroundOptions: {
                    color: bgColor
                },
                cornersSquareOptions: {
                    ...createColorOptions(gradientConfig.cornersSquare),
                    type: cornersSquareStyle
                },
                cornersDotOptions: {
                    ...createColorOptions(gradientConfig.cornersDot),
                    type: cornersDotStyle
                }
            });

            const svgBlob = await qrCode.getRawData('svg');
            if (myId !== generationId) return; // génération obsolète : on abandonne avant le DOM
            const svgText = await svgBlob.text();
            if (myId !== generationId) return;
            
            const svgContainer = document.createElement('div');
            svgContainer.innerHTML = svgText;
            svgElement = svgContainer.querySelector('svg');
            
            if (!svgElement) {
                throw new Error('SVG non généré');
            }
        } else {
            const svgString = await QRCode.toString(data, {
                type: 'svg',
                width: size,
                margin: 2,
                color: {
                    dark: foregroundColor.value,
                    light: bgColor
                },
                errorCorrectionLevel: ecc
            });
            if (myId !== generationId) return;

            const svgContainer = document.createElement('div');
            svgContainer.innerHTML = svgString;
            svgElement = svgContainer.querySelector('svg');
        }

        // Ajout du logo
        if (logoImage) {
            const viewBox = svgElement.getAttribute('viewBox');
            let viewBoxWidth = size;
            let viewBoxHeight = size;
            
            if (viewBox) {
                const viewBoxParts = viewBox.split(' ');
                if (viewBoxParts.length === 4) {
                    viewBoxWidth = parseFloat(viewBoxParts[2]);
                    viewBoxHeight = parseFloat(viewBoxParts[3]);
                }
            }
            
            const logoSize = viewBoxWidth * logoSizeRatio;
            const logoX = (viewBoxWidth - logoSize) / 2;
            const logoY = (viewBoxHeight - logoSize) / 2;
            const padding = viewBoxWidth * 0.016;

            const logoGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            const logoRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            logoRect.setAttribute('x', logoX - padding);
            logoRect.setAttribute('y', logoY - padding);
            logoRect.setAttribute('width', logoSize + (padding * 2));
            logoRect.setAttribute('height', logoSize + (padding * 2));
            logoRect.setAttribute('fill', bgColor);
            logoGroup.appendChild(logoRect);

            const logoImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            logoImg.setAttributeNS('http://www.w3.org/1999/xlink', 'href', logoImage.src);
            logoImg.setAttribute('x', logoX);
            logoImg.setAttribute('y', logoY);
            logoImg.setAttribute('width', logoSize);
            logoImg.setAttribute('height', logoSize);
            logoImg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
            logoGroup.appendChild(logoImg);
            svgElement.appendChild(logoGroup);
        }

        // Afficher le QR code (remplacement unique, pas de double innerHTML)
        if (myId !== generationId) return;
        previewContainer.replaceChildren(svgElement);
        currentQRCode = svgElement;
        actionButtons.classList.remove('hidden');
        expandBtn.classList.remove('hidden');
        // Carte suivi vs badge statique : seul l'encodage d'un lien court est suivi.
        if (dataOverride && currentShort && dataOverride === currentShort.short_url) {
            showTrackCard(currentShort);
        } else {
            showStaticBadge();
            if (recordStatic) {
                addToHistory({
                    static: true,
                    kind: contentType,
                    label: data.slice(0, 60),
                    category: currentCategoryInput() || null,
                });
            }
        }
        // Seul le plein écran ouvert suit ; pas de clone systématique ici (fait au clic expand).

    } catch (error) {
        if (myId !== generationId) return;
        hideTrackBlocks();
        console.error('Erreur lors de la génération du QR code:', error);
        const tooBig = data.length > 1500;
        previewContainer.innerHTML = tooBig
            ? '<p class="text-red-500 text-center">Contenu trop long pour un aperçu instantané. Cliquez sur « Générer le QR Code » pour réessayer, ou raccourcissez l’URL.</p>'
            : '<p class="text-red-500 text-center">Erreur lors de la génération du QR code. Vérifiez le contenu puis cliquez sur « Générer ».</p>';
    }
}

// Mode plein écran
expandBtn?.addEventListener('click', () => {
    if (!currentQRCode) return;
    
    const clonedSVG = currentQRCode.cloneNode(true);
    clonedSVG.style.width = '80vw';
    clonedSVG.style.height = '80vh';
    clonedSVG.style.maxWidth = '800px';
    clonedSVG.style.maxHeight = '800px';
    
    fullscreenQR.innerHTML = '';
    fullscreenQR.appendChild(clonedSVG);
    fullscreenModal.classList.add('active');
    document.body.style.overflow = 'hidden';
});

fullscreenClose?.addEventListener('click', closeFullscreen);
fullscreenModal?.addEventListener('click', (e) => {
    if (e.target === fullscreenModal) {
        closeFullscreen();
    }
});

function closeFullscreen() {
    fullscreenModal.classList.remove('active');
    document.body.style.overflow = '';
}

// Gestion de la qualité
qualitySlider?.addEventListener('input', (e) => {
    qualityValue.textContent = e.target.value;
});

// Fonction de téléchargement générique
async function downloadQRCode(format, quality = 0.9) {
    if (!currentQRCode) return;

    try {
        if (format === 'svg') {
            const svgData = new XMLSerializer().serializeToString(currentQRCode);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            
            const link = document.createElement('a');
            link.download = 'qrcode.svg';
            link.href = url;
            link.click();
            
            URL.revokeObjectURL(url);
        } else {
            const svgData = new XMLSerializer().serializeToString(currentQRCode);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);

            img.onload = () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                let mimeType = 'image/png';
                let extension = 'png';
                
                if (format === 'jpeg') {
                    mimeType = 'image/jpeg';
                    extension = 'jpg';
                } else if (format === 'webp') {
                    mimeType = 'image/webp';
                    extension = 'webp';
                }
                
                canvas.toBlob((blob) => {
                    const link = document.createElement('a');
                    link.download = `qrcode.${extension}`;
                    link.href = URL.createObjectURL(blob);
                    link.click();
                    URL.revokeObjectURL(url);
                }, mimeType, quality);
            };

            img.src = url;
        }
    } catch (error) {
        console.error(`Erreur lors du téléchargement ${format}:`, error);
        alert(`Erreur lors du téléchargement du fichier ${format.toUpperCase()}`);
    }
}

// Boutons de téléchargement
downloadPNG?.addEventListener('click', () => {
    qualityContainer.classList.add('hidden');
    downloadQRCode('png');
});

downloadJPEG?.addEventListener('click', () => {
    qualityContainer.classList.remove('hidden');
    setTimeout(() => {
        downloadQRCode('jpeg', parseInt(qualitySlider.value) / 100);
    }, 100);
});

downloadWebP?.addEventListener('click', () => {
    qualityContainer.classList.remove('hidden');
    setTimeout(() => {
        downloadQRCode('webp', parseInt(qualitySlider.value) / 100);
    }, 100);
});

downloadSVG?.addEventListener('click', () => {
    qualityContainer.classList.add('hidden');
    downloadQRCode('svg');
});

// Copier le contenu dans le presse-papier
copyContent?.addEventListener('click', async () => {
    if (!currentURL) return;

    const labels = {
        url: 'Lien copié !',
        text: 'Texte copié !',
        wifi: 'Paramètres WiFi copiés !',
        email: 'Email copié !',
        phone: 'Numéro copié !',
        vcard: 'Contact copié !'
    };

    const successMessage = labels[contentType] || 'Copié !';

    try {
        await navigator.clipboard.writeText(currentURL);
        const originalText = copyContent.innerHTML;
        copyContent.innerHTML = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span>' + successMessage + '</span>';
        copyContent.classList.add('bg-green-600');
        copyContent.classList.remove('bg-[var(--accent-color)]');

        setTimeout(() => {
            copyContent.innerHTML = originalText;
            copyContent.classList.remove('bg-green-600');
            copyContent.classList.add('bg-[var(--accent-color)]');
        }, 2000);
    } catch (error) {
        console.error('Erreur lors de la copie:', error);
        const textArea = document.createElement('textarea');
        textArea.value = currentURL;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert(successMessage);
    }
});

// Gestion des boutons de forme
document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const shapeType = btn.dataset.type;
        const shapeValue = btn.dataset.shape;
        
        if (shapeType === 'dot') {
            dotStyle = shapeValue;
        } else if (shapeType === 'cornersSquare') {
            cornersSquareStyle = shapeValue;
        } else if (shapeType === 'cornersDot') {
            cornersDotStyle = shapeValue;
        }
        
        document.querySelectorAll(`.shape-btn[data-type="${shapeType}"]`).forEach(b => {
            b.classList.remove('active');
        });
        btn.classList.add('active');
        
        if (hasValidContent()) {
            requestAutoGenerate();
        }
    });
});

// Bouton de génération
generateBtn?.addEventListener('click', () => {
    let isValid = false;
    let inputElement = null;

    switch (contentType) {
        case 'url':
            isValid = validateURL(urlInput.value);
            inputElement = urlInput;
            break;
        case 'text':
            isValid = textInput.value.trim() !== '';
            inputElement = textInput;
            break;
        case 'wifi':
            isValid = validateWiFi();
            inputElement = wifiSsid;
            break;
        case 'email':
            isValid = validateEmail(emailTo.value);
            inputElement = emailTo;
            break;
        case 'phone':
            isValid = validatePhone(phoneNumber.value);
            inputElement = phoneNumber;
            break;
        case 'vcard':
            isValid = validateVCard();
            inputElement = vcardName;
            break;
    }

    if (!isValid) {
        inputElement?.focus();
        inputElement?.classList.add('border-red-500');
        setTimeout(() => {
            inputElement?.classList.remove('border-red-500');
        }, 2000);
        return;
    }

    showDeferredMessage(false);
    if (contentType === 'url') {
        const useShort = document.getElementById('useShortUrl');
        if (useShort?.checked && currentShort && normalizeURL(urlInput.value) === currentShort.target) {
            generateQRCode(currentShort.short_url);
            return;
        }
    }
    generateQRCode(null, true);
});

// Raccourcisseur : bouton + copie du lien court
document.getElementById('shortenBtn')?.addEventListener('click', shortenCurrentUrl);
document.getElementById('copyShortUrl')?.addEventListener('click', async () => {
    if (!currentShort) return;
    try {
        await navigator.clipboard.writeText(currentShort.short_url);
        setShortStatus('Lien court copié !');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = currentShort.short_url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setShortStatus('Lien court copié !');
    }
});

// --- Suivi des scans : carte, historique, stats intégrées, double actualisation ---

const HISTORY_KEY = 'qr-suivis';
const HISTORY_MAX = 50;
const POLL_MS = 20000;
let trackedShort = null; // { short_id, short_url } affiché dans la carte
let pollTimer = null;
let statsFetching = false;
let statsAbort = null;
let lastStatsFocus = null;

function pluralScans(n) {
    return `${n} scan${n > 1 ? 's' : ''}`;
}

async function fetchStats(shortId, signal) {
    const resp = await fetch(`/api/links/${encodeURIComponent(shortId)}/stats/`, { signal });
    if (!resp.ok) throw new Error(`stats ${resp.status}`);
    return resp.json();
}

function setTrackStatus(text, isError = false) {
    const el = document.getElementById('trackStatus');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('text-red-500', isError);
    el.classList.toggle('text-gray-500', !isError);
}

function showTrackCard(short) {
    trackedShort = { short_id: short.short_id, short_url: short.short_url };
    const card = document.getElementById('trackCard');
    const link = document.getElementById('trackShortUrl');
    const badge = document.getElementById('trackScanCount');
    const staticBadge = document.getElementById('staticBadge');
    if (!card || !link || !badge) return;
    link.textContent = short.short_url;
    link.href = short.short_url;
    badge.textContent = '… scan';
    staticBadge?.classList.add('hidden');
    card.classList.remove('hidden');
    setTrackStatus('');
    refreshTrackCount(false);
    startPolling();
}

function showStaticBadge() {
    trackedShort = null;
    stopPolling();
    document.getElementById('trackCard')?.classList.add('hidden');
    document.getElementById('staticBadge')?.classList.remove('hidden');
}

function hideTrackBlocks() {
    trackedShort = null;
    stopPolling();
    document.getElementById('trackCard')?.classList.add('hidden');
    document.getElementById('staticBadge')?.classList.add('hidden');
}

async function refreshTrackCount(manual) {
    if (!trackedShort || statsFetching) return;
    statsFetching = true;
    if (statsAbort) statsAbort.abort();
    statsAbort = new AbortController();
    const timer = setTimeout(() => statsAbort.abort(), 8000);
    try {
        const stats = await fetchStats(trackedShort.short_id, statsAbort.signal);
        document.getElementById('trackScanCount').textContent = pluralScans(stats.scan_count);
        if (manual) setTrackStatus(`Actualisé : ${pluralScans(stats.scan_count)}.`);
        else setTrackStatus('');
    } catch (e) {
        if (e.name !== 'AbortError') setTrackStatus('Actualisation impossible (hors ligne ?). Dernière valeur conservée.', true);
    } finally {
        clearTimeout(timer);
        statsFetching = false;
    }
}

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
        if (document.hidden || !trackedShort) return;
        refreshTrackCount(false);
    }, POLL_MS);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (statsAbort) { statsAbort.abort(); statsAbort = null; }
    statsFetching = false;
}

// Historique local (survit au rechargement)
function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function saveHistory(list) {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
    } catch (e) { /* quota/privé : on reste en session seule */ }
}

function historyKey(e) {
    return e.short_id || ('static:' + (e.kind || '') + ':' + (e.label || ''));
}

function addToHistory(entry) {
    const k = historyKey(entry);
    const list = loadHistory().filter(e => historyKey(e) !== k);
    list.unshift({ ...entry, createdAt: new Date().toISOString() });
    saveHistory(list);
    renderHistory();
}

function historyFilterValue() {
    return document.getElementById('historyFilterCat')?.value || 'all';
}

function renderHistory() {
    const section = document.getElementById('historySection');
    const listEl = document.getElementById('historyList');
    const filterEl = document.getElementById('historyFilterCat');
    if (!section || !listEl) return;
    const list = loadHistory();
    // Options du filtre local (catégories présentes dans l'historique).
    if (filterEl) {
        const current = filterEl.value || 'all';
        const cats = [...new Set(list.map(e => e.category).filter(Boolean))].sort();
        filterEl.innerHTML = '';
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'Toutes catégories';
        filterEl.appendChild(optAll);
        for (const c of cats) {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            filterEl.appendChild(o);
        }
        const optNone = document.createElement('option');
        optNone.value = 'none';
        optNone.textContent = 'Sans catégorie';
        filterEl.appendChild(optNone);
        filterEl.value = [...filterEl.options].some(o => o.value === current) ? current : 'all';
    }
    const f = historyFilterValue();
    const visible = list.filter(e => f === 'all' ? true : f === 'none' ? !e.category : e.category === f);
    listEl.innerHTML = '';
    if (!list.length) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    if (!visible.length) {
        listEl.innerHTML = '<li class="text-sm text-gray-500">Rien dans cette catégorie.</li>';
        return;
    }
    for (const entry of visible) {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200 text-sm';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'flex-1 text-left text-[var(--primary-color)] underline break-all';
        if (entry.short_id) {
            btn.textContent = entry.title ? `${entry.title} — ${entry.short_url}` : entry.short_url;
            btn.setAttribute('aria-label', `Recharger le suivi de ${entry.short_url}`);
            btn.addEventListener('click', () => {
                currentShort = { target: entry.target, short_id: entry.short_id, short_url: entry.short_url, category: entry.category || null };
                const useShort = document.getElementById('useShortUrl');
                if (useShort) useShort.checked = true;
                if (qrCategoryInput && entry.category) qrCategoryInput.value = entry.category;
                renderShortZone();
                showTrackCard(currentShort);
            });
        } else {
            btn.textContent = `[${entry.kind || 'statique'}] ${entry.label || ''}`;
            btn.setAttribute('aria-label', `Reprendre la catégorie de ce QR statique`);
            btn.addEventListener('click', () => {
                if (qrCategoryInput && entry.category) qrCategoryInput.value = entry.category;
                setCategoryStatus(entry.category ? `Catégorie « ${entry.category} » reprise.` : 'Ce QR statique n’avait pas de catégorie.');
            });
        }
        if (entry.category) {
            const badge = document.createElement('span');
            badge.className = 'text-xs bg-[#f3e8ff] text-[#6b21a8] rounded-full px-2 py-0.5 whitespace-nowrap';
            badge.textContent = entry.category;
            li.appendChild(badge);
        }
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text-red-600 hover:text-red-800 px-2';
        del.textContent = '✕';
        del.setAttribute('aria-label', `Supprimer cette entrée de l'historique`);
        del.addEventListener('click', () => {
            const k = historyKey(entry);
            saveHistory(loadHistory().filter(e => historyKey(e) !== k));
            renderHistory();
        });
        li.appendChild(btn);
        li.appendChild(del);
        listEl.appendChild(li);
    }
}

// Vue stats intégrée (modale)
async function openStatsModal(shortId) {
    const modal = document.getElementById('statsModal');
    if (!modal) return;
    lastStatsFocus = document.activeElement;
    document.getElementById('statsShortId').textContent = shortId;
    document.getElementById('statsCount').textContent = 'Chargement…';
    document.getElementById('statsLast').textContent = '';
    document.getElementById('statsRows').innerHTML = '';
    document.getElementById('statsBars').innerHTML = '';
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('statsClose')?.focus();
    try {
        const stats = await fetchStats(shortId);
        document.getElementById('statsCount').textContent = pluralScans(stats.scan_count);
        document.getElementById('statsLast').textContent = stats.last_scanned_at
            ? 'dernier : ' + new Date(stats.last_scanned_at).toLocaleString('fr-FR')
            : 'jamais scanné';
        const rows = document.getElementById('statsRows');
        const bars = document.getElementById('statsBars');
        const max = Math.max(1, ...stats.per_day.map(d => d.count));
        for (const day of stats.per_day.slice(-14)) {
            const tr = document.createElement('tr');
            const tdD = document.createElement('td');
            tdD.className = 'py-1';
            tdD.textContent = day.day;
            const tdC = document.createElement('td');
            tdC.className = 'text-right py-1';
            tdC.textContent = day.count;
            tr.appendChild(tdD);
            tr.appendChild(tdC);
            rows.appendChild(tr);
            const bar = document.createElement('div');
            bar.className = 'h-2 rounded bg-[var(--accent-color)]';
            bar.style.width = `${Math.round((day.count / max) * 100)}%`;
            bar.setAttribute('role', 'img');
            bar.setAttribute('aria-label', `${day.day} : ${day.count} scans`);
            bars.appendChild(bar);
        }
        if (!stats.per_day.length) {
            rows.innerHTML = '<tr><td colspan="2" class="py-1 text-gray-500">Aucun scan pour le moment.</td></tr>';
        }
    } catch (e) {
        document.getElementById('statsCount').textContent = 'Stats injoignables (hors ligne ?).';
    }
}

function closeStatsModal() {
    document.getElementById('statsModal')?.classList.remove('active');
    if (!fullscreenModal.classList.contains('active')) document.body.style.overflow = '';
    if (lastStatsFocus?.focus) lastStatsFocus.focus();
}

document.getElementById('trackRefresh')?.addEventListener('click', () => refreshTrackCount(true));
document.getElementById('trackCopy')?.addEventListener('click', async () => {
    if (!trackedShort) return;
    try {
        await navigator.clipboard.writeText(trackedShort.short_url);
        setTrackStatus('Lien court copié !');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = trackedShort.short_url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setTrackStatus('Lien court copié !');
    }
});
document.getElementById('trackStatsBtn')?.addEventListener('click', () => {
    if (trackedShort) openStatsModal(trackedShort.short_id);
});
document.getElementById('shortStatsLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentShort) openStatsModal(currentShort.short_id);
});
document.getElementById('statsClose')?.addEventListener('click', closeStatsModal);
document.getElementById('statsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'statsModal') closeStatsModal();
});
document.getElementById('historyClear')?.addEventListener('click', () => {
    saveHistory([]);
    renderHistory();
});

// Fonction debounce
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialisation
window.addEventListener('load', () => {
    // Synchroniser les valeurs initiales des color pickers avec gradientConfig
    if (foregroundColor) {
        gradientConfig.dot.start = foregroundColor.value;
    }
    if (cornersSquareColor) {
        gradientConfig.cornersSquare.start = cornersSquareColor.value;
    }
    if (cornersDotColor) {
        gradientConfig.cornersDot.start = cornersDotColor.value;
    }
    
    // Configuration des contrôles de dégradé
    setupGradientControls('dot', 'dot');
    setupGradientControls('cornersSquare', 'cornersSquare');
    setupGradientControls('cornersDot', 'cornersDot');
    
    // Génération automatique si du contenu est présent
    updateUrlCounter();
    renderHistory();
    loadCategories();
    setupCategoryCombo();
    document.getElementById('historyFilterCat')?.addEventListener('change', renderHistory);
    if (hasValidContent()) {
        requestAutoGenerate();
    }
});

// Gestion du clavier pour les modales
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fullscreenModal.classList.contains('active')) {
        closeFullscreen();
    }
    if (e.key === 'Escape' && document.getElementById('statsModal')?.classList.contains('active')) {
        closeStatsModal();
    }
});
