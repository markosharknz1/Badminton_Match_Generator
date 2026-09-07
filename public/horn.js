// Round-end horn, shared by the Display screen and the Rounds page (same
// idiom as events.js/branding.js). Synthesised with the Web Audio API - no
// audio file to bundle, nothing to download.
//
// Which screen actually sounds it: the Display screen owns the horn (it's
// the players' screen, where "Time! Come off court" already shows). The
// Rounds page only sounds it when no Display window is alive on this same
// machine - Display windows heartbeat over a BroadcastChannel (same origin,
// same browser profile - true for both the pywebview app and a browser), so
// a laptop running both screens gets exactly one horn, and a laptop running
// only the Rounds page still gets one.
//
// Browsers won't start audio until the user has interacted with the page
// (the launcher lifts that for the .exe via an autoplay flag). When audio is
// blocked, a small "sound off" pill appears; any click on the page unlocks it.

const HORN_CHANNEL_NAME = 'game-scheduler-horn';
const HORN_HEARTBEAT_MS = 2000;
const HORN_OWNER_TIMEOUT_MS = 6000;

let hornCtx = null;
let hornChannel = null;
let lastDisplayHornSeen = 0;

function hornContext() {
    if (!hornCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        hornCtx = new AC();
    }
    return hornCtx;
}

function hornUnlocked() {
    const ctx = hornContext();
    return !!ctx && ctx.state === 'running';
}

async function unlockHorn() {
    const ctx = hornContext();
    if (!ctx) return false;
    if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch (err) { /* still blocked - pill stays up */ }
    }
    return ctx.state === 'running';
}

// A stadium-style two-tone blast (a minor third, like an air horn), ~1.4s.
function playHorn() {
    const ctx = hornContext();
    if (!ctx || ctx.state !== 'running') return false;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.7, now + 0.04);
    master.gain.setValueAtTime(0.7, now + 1.15);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    master.connect(filter);
    filter.connect(ctx.destination);
    for (const freq of [392, 466]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.linearRampToValueAtTime(freq * 0.97, now + 1.4);
        osc.connect(master);
        osc.start(now);
        osc.stop(now + 1.45);
    }
    return true;
}

function hornBroadcastChannel() {
    if (hornChannel === null && 'BroadcastChannel' in window) {
        hornChannel = new BroadcastChannel(HORN_CHANNEL_NAME);
        hornChannel.onmessage = (e) => {
            if (e.data && e.data.type === 'display-horn-ready') lastDisplayHornSeen = Date.now();
        };
    }
    return hornChannel;
}

// Display screen: call once; keeps telling other screens "I've got the horn"
// for as long as this window is open AND audio is actually unlocked here -
// a Display window that can't make a sound shouldn't silence the Rounds page.
function startDisplayHornHeartbeat() {
    const channel = hornBroadcastChannel();
    if (!channel) return;
    setInterval(() => {
        if (hornUnlocked()) channel.postMessage({ type: 'display-horn-ready', at: Date.now() });
    }, HORN_HEARTBEAT_MS);
}

// Rounds page: true while a Display window on this machine is sounding horns.
function displayScreenHandlesHorn() {
    hornBroadcastChannel();
    return Date.now() - lastDisplayHornSeen < HORN_OWNER_TIMEOUT_MS;
}

// Shows pillEl while audio is blocked; any click on the page (or the pill
// itself) tries to unlock, and the pill goes away once it succeeds.
function wireHornUnlockPill(pillEl) {
    const refresh = async () => {
        await unlockHorn();
        pillEl.style.display = hornUnlocked() ? 'none' : '';
    };
    document.addEventListener('click', refresh, true);
    document.addEventListener('keydown', refresh, true);
    refresh();
    // Some browsers flip to running a moment after load without a gesture
    // (e.g. with the autoplay flag) - re-check once so the pill doesn't
    // linger for no reason.
    setTimeout(refresh, 1500);
}
