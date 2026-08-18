// Shared across every page: registers the service worker and wires up the
// header's "+ Install app" button (if the page has one) to the browser's
// native PWA install prompt. Pages with no #install-app-btn (the Display
// kiosk screen) just get the service worker registration.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed:', err));
    });
}

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const btn = document.getElementById('install-app-btn');
    if (btn && !isStandalone()) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('install-app-btn');
    if (btn) btn.style.display = 'none';
});

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('install-app-btn');
    if (!btn || isStandalone()) return;
    btn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
        btn.style.display = 'none';
    });
});

// Inside the pywebview native app shell (launcher.py), route the Display nav
// link through pywebview's own window-creation API instead of its plain
// target="_blank". Left alone, WebView2 falls through to opening target="_blank"
// links in an actual separate Edge browser window (address bar, tabs and
// all) - exactly what the native app shell is meant to avoid. Regular
// browser tabs (e.g. the installed PWA) never get window.pywebview, so this
// is a no-op there and target="_blank" keeps working normally.
window.addEventListener('pywebviewready', () => {
    const displayLink = document.querySelector('a[href="/display.html"]');
    if (displayLink && window.pywebview?.api?.open_display) {
        displayLink.addEventListener('click', (event) => {
            event.preventDefault();
            window.pywebview.api.open_display();
        });
    }
});
