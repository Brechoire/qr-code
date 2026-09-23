// Éléments DOM
const qrForm = document.getElementById('qrForm');
const urlInput = document.getElementById('urlInput');
const generateBtn = document.getElementById('generateBtn');
const btnLoader = document.getElementById('btnLoader');
const qrCard = document.getElementById('qrCard');
const qrCanvas = document.getElementById('qrCanvas');
const downloadBtn = document.getElementById('downloadBtn');
const messageContainer = document.getElementById('messageContainer');

// État de l'application
let currentQRCodeDataURL = null;

// Initialisation - Attendre que QRCode soit chargé
function initializeApp() {
    // Vérifier que QRCode est disponible
    if (typeof QRCode === 'undefined') {
        console.error('QRCode library is not loaded');
        showMessage('Erreur: La bibliothèque QRCode n\'est pas chargée. Veuillez recharger la page.', 'error');
        return;
    }
    
    // Auto-focus sur le champ URL
    if (urlInput) urlInput.focus();
    
    // Validation en temps réel
    if (urlInput) urlInput.addEventListener('input', validateURL);
    
    // Soumission du formulaire
    if (qrForm) qrForm.addEventListener('submit', handleFormSubmit);
    
    // Téléchargement du QR-code
    if (downloadBtn) downloadBtn.addEventListener('click', handleDownload);
    
    // Support de la touche Entrée
    if (urlInput) {
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !generateBtn.disabled) {
                e.preventDefault();
                handleFormSubmit(e);
            }
        });
    }
}

// Attendre que le DOM et QRCode soient prêts
// Note: script.js est maintenant chargé dynamiquement après QRCode, donc QRCode devrait être disponible
function waitForQRCodeAndInit() {
    if (typeof QRCode !== 'undefined') {
        // QRCode est disponible, initialiser l'app
        initializeApp();
    } else {
        // Attendre un peu et réessayer
        setTimeout(waitForQRCodeAndInit, 50);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForQRCodeAndInit);
} else {
    waitForQRCodeAndInit();
}

// Vérifier aussi au chargement complet de la page
window.addEventListener('load', () => {
    if (typeof QRCode === 'undefined') {
        console.error('QRCode library still not loaded after page load');
    }
});

// Validation de l'URL en temps réel
function validateURL() {
    const url = urlInput.value.trim();
    const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
    
    if (url === '') {
        clearMessage();
        urlInput.classList.remove('valid', 'invalid');
        return false;
    }
    
    if (urlPattern.test(url) || url.startsWith('http://') || url.startsWith('https://')) {
        urlInput.classList.add('valid');
        urlInput.classList.remove('invalid');
        return true;
    } else {
        urlInput.classList.add('invalid');
        urlInput.classList.remove('valid');
        return false;
    }
}

// Gestion de la soumission du formulaire
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const url = urlInput.value.trim();
    
    // Validation
    if (!url) {
        showMessage('Veuillez entrer une URL', 'error');
        urlInput.focus();
        return;
    }
    
    // Normaliser l'URL (ajouter https:// si absent)
    const normalizedURL = normalizeURL(url);
    
    if (!normalizedURL) {
        showMessage('URL invalide. Veuillez entrer une URL valide (ex: https://example.com)', 'error');
        urlInput.focus();
        return;
    }
    
    // Désactiver le bouton et afficher le loader
    setLoadingState(true);
    clearMessage();
    
    try {
        // Générer le QR-code
        await generateQRCode(normalizedURL);
        
        // Afficher le message de succès
        showMessage('QR-code généré avec succès !', 'success');
        
        // Afficher la card avec animation
        showQRCard();
        
    } catch (error) {
        console.error('Erreur lors de la génération du QR-code:', error);
        showMessage('Une erreur est survenue lors de la génération du QR-code. Veuillez réessayer.', 'error');
        hideQRCard();
    } finally {
        setLoadingState(false);
    }
}

// Normaliser l'URL
function normalizeURL(url) {
    url = url.trim();
    
    // Si l'URL commence déjà par http:// ou https://, la retourner telle quelle
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    
    // Sinon, ajouter https://
    try {
        const urlObj = new URL(`https://${url}`);
        return urlObj.href;
    } catch (e) {
        return null;
    }
}

// Générer le QR-code
function generateQRCode(url) {
    return new Promise((resolve, reject) => {
        // Vérifier que QRCode est disponible
        if (typeof QRCode === 'undefined') {
            reject(new Error('La bibliothèque QRCode n\'est pas chargée. Veuillez recharger la page.'));
            return;
        }
        
        // Options pour le QR-code
        const options = {
            width: 400,
            margin: 2,
            color: {
                dark: '#1a1a2e',
                light: '#ffffff'
            },
            errorCorrectionLevel: 'H' // Haute correction d'erreur
        };
        
        // Générer le QR-code
        QRCode.toCanvas(qrCanvas, url, options, (error) => {
            if (error) {
                reject(error);
            } else {
                // Sauvegarder le data URL pour le téléchargement
                currentQRCodeDataURL = qrCanvas.toDataURL('image/png');
                resolve();
            }
        });
    });
}

// Afficher la card QR-code avec animation
function showQRCard() {
    qrCard.classList.remove('hidden');
    qrCard.style.animation = 'fadeInScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    // Scroll doux vers la card
    setTimeout(() => {
        qrCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// Masquer la card QR-code
function hideQRCard() {
    qrCard.classList.add('hidden');
}

// Gérer l'état de chargement
function setLoadingState(isLoading) {
    if (isLoading) {
        generateBtn.disabled = true;
        generateBtn.classList.add('loading');
        urlInput.disabled = true;
    } else {
        generateBtn.disabled = false;
        generateBtn.classList.remove('loading');
        urlInput.disabled = false;
    }
}

// Afficher un message
function showMessage(text, type = 'info') {
    // Supprimer les messages existants
    clearMessage();
    
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    message.setAttribute('role', 'alert');
    message.setAttribute('aria-live', 'polite');
    
    messageContainer.appendChild(message);
    
    // Auto-suppression après 5 secondes pour les messages de succès
    if (type === 'success') {
        setTimeout(() => {
            if (message.parentNode) {
                message.style.animation = 'slideInDown 0.4s ease-out reverse';
                setTimeout(() => {
                    if (message.parentNode) {
                        message.remove();
                    }
                }, 400);
            }
        }, 5000);
    }
}

// Effacer les messages
function clearMessage() {
    messageContainer.innerHTML = '';
}

// Gérer le téléchargement
function handleDownload() {
    if (!currentQRCodeDataURL) {
        showMessage('Aucun QR-code à télécharger', 'error');
        return;
    }
    
    try {
        // Créer un lien de téléchargement
        const link = document.createElement('a');
        link.download = generateFileName();
        link.href = currentQRCodeDataURL;
        
        // Déclencher le téléchargement
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Feedback visuel
        downloadBtn.style.transform = 'scale(0.95)';
        setTimeout(() => {
            downloadBtn.style.transform = '';
        }, 200);
        
        showMessage('Téléchargement démarré !', 'success');
        
    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        showMessage('Erreur lors du téléchargement. Veuillez réessayer.', 'error');
    }
}

// Générer un nom de fichier intelligent
function generateFileName() {
    const url = urlInput.value.trim();
    const normalizedURL = normalizeURL(url) || url;
    
    try {
        const urlObj = new URL(normalizedURL);
        const hostname = urlObj.hostname.replace(/^www\./, '');
        const cleanHostname = hostname.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const timestamp = new Date().toISOString().split('T')[0];
        return `qr-code-${cleanHostname}-${timestamp}.png`;
    } catch (e) {
        const timestamp = new Date().toISOString().split('T')[0];
        return `qr-code-${timestamp}.png`;
    }
}

// Gestion des erreurs globales
window.addEventListener('error', (e) => {
    console.error('Erreur globale:', e);
    if (messageContainer.children.length === 0) {
        showMessage('Une erreur inattendue est survenue', 'error');
    }
});

// Amélioration de l'accessibilité : annoncer les changements
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            const addedNode = mutation.addedNodes[0];
            if (addedNode.nodeType === 1 && addedNode.classList.contains('message')) {
                // Le message est déjà annoncé via aria-live
            }
        }
    });
});

observer.observe(messageContainer, {
    childList: true,
    subtree: true
});

